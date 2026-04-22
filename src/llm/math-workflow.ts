import {
  BinaryOperationArgsSchema,
  createMathTools,
  mathToolSystemPrompt,
  TOOL_NAME_TO_OPERATION,
  type MathToolDecision,
  type Operation,
} from "../math.js";
import type { ConversationMessage, MathModelProvider } from "./types.js";

export type MathConversationContext = {
  history?: ConversationMessage[];
  pendingQuestion?: string | null;
  factMemory?: string[];
  turnMode?: "new_question" | "supplement";
  lastClarificationQuestion?: string | null;
};

/**
 * 区分用户输入是在提出一个新问题，还是在补充当前待解决问题的信息
 * -- 
 * 限制模型只能输入 NEW_QUESTION 或 SUPPLEMENT 标签
 * - 如果用户是在回答上一轮澄清、补充条件、补充事实、继续提供上下文，输出 SUPPLEMENT
 * - 如果用户明确切换到新的计算目标或新的问题，输出 NEW_QUESTION
 */
export async function classifyTurnMode(
  provider: MathModelProvider,
  input: string,
  context: MathConversationContext = {},
): Promise<"new_question" | "supplement"> {
  if (!context.pendingQuestion) {
    return "new_question";
  }

  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: [
          "你是一个对话路由助手。",
          "你需要判断本轮用户输入是在提出一个新问题，还是在补充当前待解决问题的信息。",
          "只能输出一个标签：NEW_QUESTION 或 SUPPLEMENT。",
          "如果用户是在回答上一轮澄清、补充条件、补充事实、继续提供上下文，输出 SUPPLEMENT。",
          "如果用户明确切换到新的计算目标或新的问题，输出 NEW_QUESTION。",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildTurnModePrompt(input, context),
      },
    ],
  });

  const normalized = response.text.trim().toUpperCase();
  if (normalized.includes("SUPPLEMENT")) {
    return "supplement";
  }

  if (normalized.includes("NEW_QUESTION")) {
    return "new_question";
  }

  return "supplement";
}

/**
 * 选择数学工具
 */
export async function chooseMathTool(
  provider: MathModelProvider,
  input: string,
  context: MathConversationContext = {},
): Promise<MathToolDecision> {
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: mathToolSystemPrompt,
      },
      {
        role: "user",
        content: buildConversationPrompt(input, context),
      },
    ],
    tools: createMathTools(),
  });

  if (!response.toolCall) {
    return parseTextDecision(
      response.text ||
        "UNSUPPORTED: 暂时只支持两个数字的一次加减乘除，例如：12 加 8、50 减 6、7 乘 9、20 除以 5。",
    );
  }

  const parsedArgs = BinaryOperationArgsSchema.safeParse(JSON.parse(response.toolCall.arguments));
  if (!parsedArgs.success) {
    return {
      kind: "reject",
      reason: "模型调用工具时传入了无效参数。",
    };
  }

  const operation = TOOL_NAME_TO_OPERATION[response.toolCall.name as Operation];
  if (!operation) {
    return {
      kind: "reject",
      reason: `模型选择了未知工具：${response.toolCall.name}`,
    };
  }

  return {
    kind: "solve",
    operation,
    operands: [parsedArgs.data.left, parsedArgs.data.right],
  };
}

export async function formatMathAnswer(
  provider: MathModelProvider,
  params: {
    input: string;
    context?: MathConversationContext;
    operation: string;
    operands: [number, number];
    result: number;
  },
): Promise<string> {
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: buildFormatAnswerSystemPrompt(),
      },
      {
        role: "user",
        content: buildFormatAnswerUserPrompt(params),
      },
    ],
  });

  return response.text.trim() || `${params.operands[0]} ${params.operation} ${params.operands[1]} = ${params.result}`;
}

export function buildConversationPrompt(input: string, context: MathConversationContext = {}): string {
  const history = context.history ?? [];
  const pendingQuestion = context.pendingQuestion?.trim();
  const factMemory = (context.factMemory ?? []).map((fact) => fact.trim()).filter(Boolean);
  const turnMode = context.turnMode ?? "new_question";
  const lastClarificationQuestion = context.lastClarificationQuestion?.trim();

  if (!pendingQuestion && factMemory.length === 0 && !lastClarificationQuestion && history.length === 0) {
    return input;
  }

  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
    .join("\n");

  const sections = [
    "请优先围绕“当前待解决问题”来理解本轮输入。",
    "如果本轮输入被标记为“补充信息”，它是在补充当前待解决问题的条件，不是一个全新的问题。",
    "如果你需要继续澄清，请明确说明你当前要计算的目标是什么，以及还缺哪条关键信息。",
  ];

  if (pendingQuestion) {
    sections.push(`当前待解决问题：${pendingQuestion}`);
  }

  if (factMemory.length > 0) {
    sections.push(["已知事实：", ...factMemory.map((fact, index) => `${index + 1}. ${fact}`)].join("\n"));
  }

  if (lastClarificationQuestion) {
    sections.push(`上一轮澄清问题：${lastClarificationQuestion}`);
  }

  sections.push(`本轮输入类型：${turnMode === "supplement" ? "补充信息" : "新问题"}`);

  if (transcript) {
    sections.push(["对话历史：", transcript].join("\n"));
  }

  sections.push(`本轮用户输入：${input}`);

  return sections.join("\n\n");
}

function buildFormatAnswerSystemPrompt(): string {
  return [
    "你是一个数学结果表达助手。",
    "请基于用户问题和计算结果，用中文给出一句简洁自然的回答。",
    "如果用户提供了生活情境，要沿用原来的情境名词作答，例如“还剩下 2 个苹果”。",
    "如果用户只是直接问算式，可以直接回答公式和结果，例如“12 + 8 = 20”。",
    "不要编造新信息，不要输出多句话。",
  ].join("\n");
}

function buildTurnModePrompt(input: string, context: MathConversationContext): string {
  const history = context.history ?? [];
  const pendingQuestion = context.pendingQuestion?.trim();
  const factMemory = (context.factMemory ?? []).map((fact) => fact.trim()).filter(Boolean);
  const lastClarificationQuestion = context.lastClarificationQuestion?.trim();

  const sections = [];

  if (pendingQuestion) {
    sections.push(`当前待解决问题：${pendingQuestion}`);
  }

  if (factMemory.length > 0) {
    sections.push(["已知事实：", ...factMemory.map((fact, index) => `${index + 1}. ${fact}`)].join("\n"));
  }

  if (lastClarificationQuestion) {
    sections.push(`上一轮澄清问题：${lastClarificationQuestion}`);
  }

  if (history.length > 0) {
    sections.push(
      [
        "对话历史：",
        ...history.map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`),
      ].join("\n"),
    );
  }

  sections.push(`本轮用户输入：${input}`);
  return sections.join("\n\n");
}

function buildFormatAnswerUserPrompt(params: {
  input: string;
  context?: MathConversationContext;
  operation: string;
  operands: [number, number];
  result: number;
}): string {
  return [
    `用户问题：${buildConversationPrompt(params.input, params.context ?? {})}`,
    `计算操作：${params.operation}`,
    `计算参数：${params.operands[0]}, ${params.operands[1]}`,
    `计算结果：${params.result}`,
  ].join("\n");
}

function parseTextDecision(text: string): MathToolDecision {
  const trimmed = text.trim();
  if (trimmed.startsWith("CLARIFY:")) {
    return {
      kind: "clarify",
      question: trimmed.slice("CLARIFY:".length).trim() || "可以再补充一下必要信息吗？",
    };
  }

  const unsupported = trimmed.startsWith("UNSUPPORTED:")
    ? trimmed.slice("UNSUPPORTED:".length).trim()
    : trimmed;

  return {
    kind: "reject",
    reason: unsupported || "暂时只支持两个数字的一次加减乘除。",
  };
}
