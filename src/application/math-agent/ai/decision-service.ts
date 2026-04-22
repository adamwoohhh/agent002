import { BinaryOperationArgsSchema, type MathToolDecision, type Operation } from "../../../domain/math/types.js";
import type { MathModelProvider } from "../../../infrastructure/llm/types.js";
import type { MathConversationContext } from "../types.js";
import { buildConversationPrompt, buildTurnModePrompt, mathToolSystemPrompt } from "../prompts/math-prompts.js";
import { createMathTools, TOOL_NAME_TO_OPERATION } from "../tools/math-tools.js";

export class MathDecisionService {
  constructor(private readonly provider: MathModelProvider) {}

  async classifyTurnMode(
    input: string,
    context: MathConversationContext = {},
  ): Promise<"new_question" | "supplement"> {
    if (!context.pendingQuestion) {
      return "new_question";
    }

    const response = await this.provider.generate({
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

  async chooseMathTool(input: string, context: MathConversationContext = {}): Promise<MathToolDecision> {
    const response = await this.provider.generate({
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
