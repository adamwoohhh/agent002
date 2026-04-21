import {
  BinaryOperationArgsSchema,
  createMathTools,
  mathToolSystemPrompt,
  TOOL_NAME_TO_OPERATION,
  type MathToolDecision,
  type Operation,
} from "../math.js";
import type { ConversationMessage, MathModelProvider } from "./types.js";

export async function chooseMathTool(
  provider: MathModelProvider,
  input: string,
  history: ConversationMessage[] = [],
): Promise<MathToolDecision> {
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: mathToolSystemPrompt,
      },
      {
        role: "user",
        content: buildConversationPrompt(input, history),
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
    history?: ConversationMessage[];
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

export function buildConversationPrompt(input: string, history: ConversationMessage[] = []): string {
  if (history.length === 0) {
    return input;
  }

  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
    .join("\n");

  return [
    "以下是之前的对话历史，请你结合上下文理解本轮问题：",
    transcript,
    "",
    `本轮用户问题：${input}`,
  ].join("\n");
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

function buildFormatAnswerUserPrompt(params: {
  input: string;
  history?: ConversationMessage[];
  operation: string;
  operands: [number, number];
  result: number;
}): string {
  return [
    `用户问题：${buildConversationPrompt(params.input, params.history ?? [])}`,
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
