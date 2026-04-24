import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import { createTelemetryWriter } from "../../infrastructure/observability/create-telemetry-writer.js";
import { createEventId } from "../../infrastructure/observability/event-tree.js";
import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import { AgentRuntime } from "../../platform/runtime/agent-runtime.js";
import { SkillRegistry } from "../../platform/runtime/skill.js";
import { SkillRouter } from "../../platform/runtime/skill-router.js";
import type { AgentTurnMode, AgentSessionState } from "./types.js";
import { createEmptyAgentSessionState } from "./types.js";
import { AgentTurnClassifier } from "./turn-classifier.js";

type SkillExecutionMetadata = {
  status?: "answered" | "clarify" | "reject";
  updatedSkillState?: Record<string, unknown>;
  keepActive?: boolean;
  wantsReroute?: boolean;
};

export class AgentChatService {
  private state: AgentSessionState = createEmptyAgentSessionState();
  private loggerPromise: Promise<TelemetryWriter> | null = null;
  private sessionRootEventId: string | null = null;
  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
    private readonly registry: SkillRegistry,
    private readonly router: SkillRouter,
  ) {}

  async respond(input: string): Promise<string> {
    const logger = await this.getLogger();
    // session root_id，启动一次 cli 为一个 session，如果不存在，创建一个 root_id 并上报 session_started 事件
    const sessionRootEventId = await this.ensureSessionRoot(logger);
    // run root_id，每次对话创建一个 run_id
    const runRootEventId = createEventId();

    await logger.runStarted({
      type: "run_started",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: runRootEventId,
      parentEventId: sessionRootEventId,
      input,
      phase: "session_turn",
      stateBeforeTurn: snapshotAgentState(this.state),
    });

    // 轮次澄清，创建一个 event_id 记录
    const turnModeEventId = createEventId();
    // 轮次澄清可能会调用模型，将 event_id 传递进去当作模型调用的 parentEventId
    const turnMode = await new AgentTurnClassifier(this.provider, logger).classify(
      input,
      {
        history: this.state.history,
        activeSkillId: this.state.activeSkillId,
        lastAgentQuestion: this.state.lastAgentQuestion,
      },
      turnModeEventId,
    );

    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: turnModeEventId,
      parentEventId: runRootEventId,
      event: "turn_mode_resolved",
      input,
      turnMode,
      stateBeforeTurn: snapshotAgentState(this.state),
    });

    const resolved = await this.resolveSkill(input, turnMode, logger, runRootEventId);
    const answer = resolved.output;

    this.state.history = appendHistory(this.state.history, input, answer);
    this.state.lastAgentQuestion = resolved.status === "clarify" ? answer : null;
    this.state.pendingSkillSwitch = false;
    this.state.activeSkillId = resolved.keepActive ? resolved.skillId : null;

    if (resolved.skillId && resolved.updatedSkillState) {
      this.state.skillStateById[resolved.skillId] = resolved.updatedSkillState;
    }

    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: createEventId(),
      parentEventId: runRootEventId,
      event: "conversation_state_updated",
      input,
      answer,
      stateAfterTurn: snapshotAgentState(this.state),
    });

    await logger.runCompleted({
      type: "run_completed",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: createEventId(),
      parentEventId: runRootEventId,
      finalAnswer: answer,
      finalState: snapshotAgentState(this.state),
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
        finalState: snapshotAgentState(this.state),
        phase: "session_lifecycle",
      });
      this.sessionRootEventId = null;
    }

    await logger.flush?.();
    await logger.shutdown?.();
  }

  /**
   * 解析用户输入，匹配skill，并调用skill执行
   */
  private async resolveSkill(
    input: string,
    turnMode: AgentTurnMode,
    logger: TelemetryWriter,
    runRootEventId: string,
  ): Promise<{
    output: string;
    status: "answered" | "clarify" | "reject";
    skillId: string | null;
    keepActive: boolean;
    updatedSkillState?: Record<string, unknown>;
  }> {
    // 当前轮次不是一个“新问题”，并且已经有激活的skill，直接执行当前skill的逻辑
    if (turnMode === "supplement" && this.state.activeSkillId) {
      const result = await this.executeSkill(this.state.activeSkillId, input, turnMode, logger, runRootEventId, true);
      if (!result.wantsReroute) {
        return result;
      }
    }

    const routeEventId = createEventId();
    // 根据用户用户输入上下文和注册skill描述，路由到合适的skill（本地正则匹配）
    const decision = this.router.route(
      input,
      // 当前注册所有 skill 的描述信息
      this.registry.listDescriptors(),
      {
        history: this.state.history,
        metadata: {
          activeSkillId: this.state.activeSkillId,
          turnMode,
        },
      }
    );

    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: routeEventId,
      parentEventId: runRootEventId,
      event: "skill_routed",
      input,
      turnMode,
      routeDecision: decision,
    });

    // 匹配不到合适的skill，返回错误信息
    if (decision.kind !== "route") {
      return {
        output: decision.message,
        status: decision.kind === "clarify" ? "clarify" : "reject",
        skillId: null,
        keepActive: false,
      };
    }

    return this.executeSkill(decision.skillId, input, turnMode, logger, runRootEventId, false);
  }

  /**
   * 执行skill，返回执行结果
   */
  private async executeSkill(
    skillId: string,
    input: string,
    turnMode: AgentTurnMode,
    logger: TelemetryWriter,
    runRootEventId: string,
    isActiveSkill: boolean,
  ): Promise<{
    output: string;
    status: "answered" | "clarify" | "reject";
    skillId: string;
    keepActive: boolean;
    wantsReroute: boolean;
    updatedSkillState?: Record<string, unknown>;
  }> {
    const graphSessionEventId = createEventId();
    await logger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId: graphSessionEventId,
      parentEventId: runRootEventId,
      event: "graph_execution",
      input,
      stateBeforeGraph: snapshotAgentState(this.state),
      context: {
        skillId,
        turnMode,
        isActiveSkill,
      },
    });

    const runtime = new AgentRuntime(this.registry, this.router, undefined, undefined, logger);
    const result = await runtime.executeSkill(skillId, input, {
      history: this.state.history,
      metadata: {
        turnMode,
        isActiveSkill,
        skillState: this.state.skillStateById[skillId],
        graphParentEventId: graphSessionEventId,
        telemetryLogger: logger,
      },
    });

    const metadata = (result.metadata ?? {}) as SkillExecutionMetadata;
    return {
      output: result.output,
      status: metadata.status ?? "answered",
      skillId,
      keepActive: metadata.keepActive ?? false,
      wantsReroute: metadata.wantsReroute ?? false,
      updatedSkillState: metadata.updatedSkillState,
    };
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
      stateBeforeTurn: snapshotAgentState(this.state),
    });
    this.sessionRootEventId = sessionRootEventId;
    return sessionRootEventId;
  }
}

function snapshotAgentState(state: AgentSessionState) {
  return {
    activeSkillId: state.activeSkillId,
    pendingSkillSwitch: state.pendingSkillSwitch,
    lastAgentQuestion: state.lastAgentQuestion,
    historyLength: state.history.length,
    skillStateIds: Object.keys(state.skillStateById),
  };
}

function appendHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  input: string,
  answer: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return [
    ...history,
    { role: "user", content: input },
    { role: "assistant", content: answer },
  ];
}
