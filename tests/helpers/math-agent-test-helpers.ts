import { AgentChatService } from "../../src/application/agent/agent-chat-service.js";
import { MathSkill } from "../../src/application/math-agent/math-skill.js";
import type { MathConversationContext } from "../../src/application/math-agent/types.js";
import { resolveAppConfig, type AppConfig } from "../../src/infrastructure/config/app-config.js";
import { createEventId } from "../../src/infrastructure/observability/event-tree.js";
import { createTelemetryWriter } from "../../src/infrastructure/observability/create-telemetry-writer.js";
import type { TelemetryWriter } from "../../src/infrastructure/observability/telemetry-writer.js";
import type { ConversationMessage, MathModelProvider } from "../../src/infrastructure/llm/types.js";
import { SkillRegistry } from "../../src/platform/runtime/skill.js";
import { SkillRouter } from "../../src/platform/runtime/skill-router.js";

export async function runMathAgent(
  input: string,
  provider: MathModelProvider,
  history: ConversationMessage[] = [],
  logger?: TelemetryWriter,
  conversationContext: MathConversationContext = {},
): Promise<string> {
  const config = resolveAppConfig();
  const activeLogger =
    logger ??
    (await createTelemetryWriter("agx-run", config));
  const skill = new MathSkill(config, provider, activeLogger);
  const initialContext = {
    ...conversationContext,
    history,
  };
  const runRootEventId = createEventId();

  await activeLogger.runStarted({
    type: "run_started",
    timestamp: new Date().toISOString(),
    runId: activeLogger.runId,
    eventId: runRootEventId,
    input,
    phase: "direct_run",
    initialContext,
  });

  try {
    const graphSessionEventId = createEventId();
    await activeLogger.sessionEvent({
      type: "session_event",
      timestamp: new Date().toISOString(),
      runId: activeLogger.runId,
      eventId: graphSessionEventId,
      parentEventId: runRootEventId,
      event: "graph_execution",
      input,
      phase: "direct_run",
      context: initialContext,
    });

    const result = await skill.handle(input, {
      history: initialContext.history,
      metadata: {
        turnMode: initialContext.turnMode,
        skillState: {
          pendingQuestion: initialContext.pendingQuestion,
          factMemory: initialContext.factMemory,
          lastClarificationQuestion: initialContext.lastClarificationQuestion,
          lastResolvedOperation: initialContext.lastResolvedOperation,
          lastResolvedOperands: initialContext.lastResolvedOperands,
          lastResult: initialContext.lastResult,
        },
        graphParentEventId: graphSessionEventId,
        telemetryLogger: activeLogger,
      },
    });
    const finalAnswer = result.output;
    await activeLogger.runCompleted({
      type: "run_completed",
      timestamp: new Date().toISOString(),
      runId: activeLogger.runId,
      eventId: createEventId(),
      parentEventId: runRootEventId,
      finalAnswer,
      phase: "direct_run",
    });
    await activeLogger.flush?.();
    return finalAnswer;
  } catch (error) {
    await activeLogger.runFailed({
      type: "run_failed",
      timestamp: new Date().toISOString(),
      runId: activeLogger.runId,
      eventId: createEventId(),
      parentEventId: runRootEventId,
      error,
      phase: "direct_run",
    });
    await activeLogger.flush?.();
    throw error;
  }
}

export class MathChatSession {
  private readonly service: AgentChatService;

  constructor(provider: MathModelProvider, config: AppConfig = resolveAppConfig()) {
    const registry = new SkillRegistry();
    registry.register(new MathSkill(config, provider));
    this.service = new AgentChatService(config, provider, registry, new SkillRouter());
  }

  async respond(input: string): Promise<string> {
    return this.service.respond(input);
  }

  getHistory(): ConversationMessage[] {
    return this.service.getHistory();
  }

  async close(): Promise<void> {
    await this.service.close();
  }
}
