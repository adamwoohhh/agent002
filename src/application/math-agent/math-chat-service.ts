import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import { JsonlRunLogger } from "../../infrastructure/observability/jsonl-run-logger.js";
import { AgentRuntime } from "../../platform/runtime/agent-runtime.js";
import { CapabilityRegistry } from "../../platform/runtime/capability.js";
import { MathCapability } from "./math-capability.js";
import { ConversationStateManager, createEmptyConversationState, fallbackResolveTurnMode } from "./conversation/state-manager.js";
import type { ConversationState } from "./types.js";

export class MathChatService {
  private state: ConversationState = createEmptyConversationState();
  private loggerPromise: Promise<JsonlRunLogger> | null = null;
  private readonly conversationStateManager: ConversationStateManager;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
  ) {
    this.conversationStateManager = new ConversationStateManager(provider);
  }

  async respond(input: string): Promise<string> {
    const logger = await this.getLogger();
    const capability = new MathCapability(this.config, this.provider, logger);
    const stateBeforeTurn = snapshotConversationState(this.state);

    await logger.write({
      type: "run_started",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      input,
      phase: "session_turn",
      stateBeforeTurn,
    });

    // 轮次识别，判断会话中本次用户的输入是否是个新问题 or 当前问题的补充信息
    const turnMode = await this.resolveTurnMode(input, capability);
    await logger.write({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      event: "turn_mode_resolved",
      input,
      turnMode,
      stateBeforeTurn,
    });

    // 提取出本次用户输入中的问题和事实信息
    const turnPreparation = await this.conversationStateManager.beginTurn(this.state, input, turnMode);
    this.state = turnPreparation.state;

    await logger.write({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      event: "conversation_input_analyzed",
      input,
      turnMode,
      analysis: turnPreparation.analysis,
      stateAfterPreparation: snapshotConversationState(this.state),
    });

    const registry = new CapabilityRegistry();
    registry.register(capability);

    const runtime = new AgentRuntime(registry, undefined, undefined, logger);
    const result = await runtime.execute("math", input, {
      history: this.state.history,
      metadata: {
        pendingQuestion: this.state.pendingQuestion,
        factMemory: this.state.factMemory,
        turnMode,
        lastClarificationQuestion: this.state.lastClarificationQuestion,
      },
    });

    const answer = result.output;
    this.state = this.conversationStateManager.completeTurn(this.state, input, answer);

    await logger.write({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      event: "conversation_state_updated",
      input,
      answer,
      stateAfterTurn: snapshotConversationState(this.state),
    });
    await logger.write({
      type: "run_completed",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      finalAnswer: answer,
      finalState: snapshotConversationState(this.state),
      phase: "session_turn",
    });

    return answer;
  }

  getHistory() {
    return [...this.state.history];
  }

  private getLogger(): Promise<JsonlRunLogger> {
    this.loggerPromise ??= JsonlRunLogger.create("agx-chat", {
      logDirectory: this.config.logging.directory,
    });
    return this.loggerPromise;
  }

  private async resolveTurnMode(input: string, capability: MathCapability): Promise<"new_question" | "supplement"> {
    if (!this.state.pendingQuestion) {
      return "new_question";
    }

    try {
      return await capability.getDecisionService().classifyTurnMode(input, {
        history: this.state.history,
        pendingQuestion: this.state.pendingQuestion,
        factMemory: this.state.factMemory,
        lastClarificationQuestion: this.state.lastClarificationQuestion,
      });
    } catch {
      return fallbackResolveTurnMode(
        input,
        this.state.pendingQuestion,
        this.state.lastClarificationQuestion,
      );
    }
  }
}

function snapshotConversationState(state: ConversationState) {
  return {
    pendingQuestion: state.pendingQuestion,
    factMemory: [...state.factMemory],
    lastClarificationQuestion: state.lastClarificationQuestion,
    historyLength: state.history.length,
  };
}
