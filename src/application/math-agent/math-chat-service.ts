import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import { createEventId } from "../../infrastructure/observability/event-tree.js";
import { createTelemetryWriter } from "../../infrastructure/observability/create-telemetry-writer.js";
import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import { AgentRuntime } from "../../platform/runtime/agent-runtime.js";
import { CapabilityRegistry } from "../../platform/runtime/capability.js";
import { MathCapability } from "./math-capability.js";
import { ConversationStateManager, createEmptyConversationState, fallbackResolveTurnMode } from "./conversation/state-manager.js";
import type { ConversationState } from "./types.js";

export class MathChatService {
  private state: ConversationState = createEmptyConversationState();
  private loggerPromise: Promise<TelemetryWriter> | null = null;
  private sessionRootEventId: string | null = null;
  private conversationStateManager: ConversationStateManager;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
  ) {
    this.conversationStateManager = new ConversationStateManager(provider);
  }

  async respond(input: string): Promise<string> {
    const logger = await this.getLogger();
    const sessionRootEventId = await this.ensureSessionRoot(logger);
    this.conversationStateManager = new ConversationStateManager(this.provider, logger);
    const capability = new MathCapability(this.config, this.provider, logger);
    const stateBeforeTurn = snapshotConversationState(this.state);
    const runRootEventId = createEventId();

    await logger.runStarted({
      type: "run_started",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: runRootEventId,
      parentEventId: sessionRootEventId,
      input,
      phase: "session_turn",
      stateBeforeTurn,
    });

    // 轮次识别，判断会话中本次用户的输入是否是个新问题 or 当前问题的补充信息
    const turnModeEventId = createEventId();
    const turnMode = await this.resolveTurnMode(input, capability, turnModeEventId);
    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: turnModeEventId,
      parentEventId: runRootEventId,
      event: "turn_mode_resolved",
      input,
      turnMode,
      stateBeforeTurn,
    });

    // 提取出本次用户输入中的问题和事实信息
    const analysisEventId = createEventId();
    const turnPreparation = await this.conversationStateManager.beginTurn(
      this.state,
      input,
      turnMode,
      analysisEventId,
    );
    this.state = turnPreparation.state;

    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: analysisEventId,
      parentEventId: runRootEventId,
      event: "conversation_input_analyzed",
      input,
      turnMode,
      analysis: turnPreparation.analysis,
      stateAfterPreparation: snapshotConversationState(this.state),
    });

    const graphSessionEventId = createEventId();
    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: graphSessionEventId,
      parentEventId: runRootEventId,
      event: "graph_execution",
      input,
      stateBeforeGraph: snapshotConversationState(this.state),
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
        graphParentEventId: graphSessionEventId,
      },
    });

    const answer = result.output;
    this.state = this.conversationStateManager.completeTurn(this.state, input, answer);
    const stateUpdatedEventId = createEventId();

    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: stateUpdatedEventId,
      parentEventId: runRootEventId,
      event: "conversation_state_updated",
      input,
      answer,
      stateAfterTurn: snapshotConversationState(this.state),
    });
    await logger.runCompleted({
      type: "run_completed",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: createEventId(),
      parentEventId: runRootEventId,
      finalAnswer: answer,
      finalState: snapshotConversationState(this.state),
      phase: "session_turn",
    });

    return answer;
  }

  getHistory() {
    return [...this.state.history];
  }

  async close(): Promise<void> {
    const logger = await this.loggerPromise;
    if (!logger) {
      return;
    }

    if (this.sessionRootEventId) {
      await logger.runCompleted({
        type: "run_completed",
        timestamp: new Date().toISOString(),
        runId: logger.runId,
        eventId: createEventId(),
        parentEventId: this.sessionRootEventId,
        finalState: snapshotConversationState(this.state),
        phase: "session_lifecycle",
      });
      this.sessionRootEventId = null;
    }

    await logger.flush?.();
    await logger.shutdown?.();
  }

  private getLogger(): Promise<TelemetryWriter> {
    this.loggerPromise ??= createTelemetryWriter("agx-chat", this.config);
    return this.loggerPromise;
  }

  private async ensureSessionRoot(logger: TelemetryWriter): Promise<string> {
    if (this.sessionRootEventId) {
      return this.sessionRootEventId;
    }

    const sessionRootEventId = createEventId();
    await logger.runStarted({
      type: "run_started",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: sessionRootEventId,
      phase: "session_lifecycle",
      stateBeforeTurn: snapshotConversationState(this.state),
    });
    this.sessionRootEventId = sessionRootEventId;
    return sessionRootEventId;
  }

  private async resolveTurnMode(
    input: string,
    capability: MathCapability,
    parentEventId?: string,
  ): Promise<"new_question" | "supplement"> {
    if (!this.state.pendingQuestion) {
      return "new_question";
    }

    try {
      return await capability.getDecisionService().classifyTurnMode(input, {
        history: this.state.history,
        pendingQuestion: this.state.pendingQuestion,
        factMemory: this.state.factMemory,
        lastClarificationQuestion: this.state.lastClarificationQuestion,
      }, parentEventId);
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
