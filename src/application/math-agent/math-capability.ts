import { MathAnswerRenderer } from "./ai/answer-renderer.js";
import { MathDecisionService } from "./ai/decision-service.js";
import { executeMathGraph } from "./graph/math-agent-graph.js";
import type { MathConversationContext } from "./types.js";
import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import type { RunLogger } from "../../infrastructure/observability/run-logger.js";
import type { Capability, CapabilityResult } from "../../platform/runtime/capability.js";
import type { RunContext } from "../../platform/runtime/types.js";

export class MathCapability implements Capability {
  readonly name = "math";
  private readonly decisionService: MathDecisionService;
  private readonly answerRenderer: MathAnswerRenderer;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
    private readonly logger: RunLogger,
  ) {
    this.decisionService = new MathDecisionService(provider, logger);
    this.answerRenderer = new MathAnswerRenderer(provider, logger);
  }

  async handle(input: string, context?: RunContext): Promise<CapabilityResult> {
    const metadataContext = (context?.metadata ?? {}) as Partial<MathConversationContext>;
    const conversationContext: MathConversationContext = {
      history: context?.history,
      pendingQuestion: metadataContext.pendingQuestion,
      factMemory: metadataContext.factMemory,
      turnMode: metadataContext.turnMode,
      lastClarificationQuestion: metadataContext.lastClarificationQuestion,
    };

    const result = await executeMathGraph({
      config: this.config,
      logger: this.logger,
      decisionService: this.decisionService,
      answerRenderer: this.answerRenderer,
      input,
      context: conversationContext,
      parentEventId:
        typeof context?.metadata?.graphParentEventId === "string"
          ? context.metadata.graphParentEventId
          : undefined,
    });

    return {
      output: result.finalAnswer,
      metadata: {
        capability: this.name,
        finalState: result.finalState,
      },
    };
  }

  getDecisionService(): MathDecisionService {
    return this.decisionService;
  }
}
