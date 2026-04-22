import { MathAnswerRenderer } from "../application/math-agent/ai/answer-renderer.js";
import { MathDecisionService } from "../application/math-agent/ai/decision-service.js";
import { buildConversationPrompt } from "../application/math-agent/prompts/math-prompts.js";
import type { MathConversationContext } from "../application/math-agent/types.js";
import type { MathModelProvider } from "../infrastructure/llm/types.js";

export type { MathConversationContext };

export async function classifyTurnMode(
  provider: MathModelProvider,
  input: string,
  context: MathConversationContext = {},
): Promise<"new_question" | "supplement"> {
  return new MathDecisionService(provider).classifyTurnMode(input, context);
}

export async function chooseMathTool(
  provider: MathModelProvider,
  input: string,
  context: MathConversationContext = {},
) {
  return new MathDecisionService(provider).chooseMathTool(input, context);
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
  return new MathAnswerRenderer(provider).formatMathAnswer(params);
}

export { buildConversationPrompt };
