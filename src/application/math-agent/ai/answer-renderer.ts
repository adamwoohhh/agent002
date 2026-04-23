import { operationSymbolMap } from "../../../domain/math/operations.js";
import type { MathModelProvider } from "../../../infrastructure/llm/types.js";
import type { RunLogger } from "../../../infrastructure/observability/run-logger.js";
import { generateWithLogging } from "../../../infrastructure/observability/model-call-logger.js";
import type { MathConversationContext } from "../types.js";
import { buildFormatAnswerSystemPrompt, buildFormatAnswerUserPrompt } from "../prompts/math-prompts.js";

export class MathAnswerRenderer {
  constructor(
    private readonly provider: MathModelProvider,
    private readonly logger?: RunLogger,
  ) {}

  async formatMathAnswer(params: {
    input: string;
    context?: MathConversationContext;
    operation: string;
    operands: [number, number];
    result: number;
  }, parentEventId?: string): Promise<string> {
    const response = await generateWithLogging({
      provider: this.provider,
      logger: this.logger,
      parentEventId,
      purpose: "format_math_answer",
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

  buildFallbackAnswer(operation: keyof typeof operationSymbolMap, operands: [number, number], result: number): string {
    return `${operands[0]} ${operationSymbolMap[operation]} ${operands[1]} = ${result}`;
  }
}
