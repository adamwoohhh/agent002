import { MathCapability } from "../../src/application/math-agent/math-capability.js";
import { MathChatService } from "../../src/application/math-agent/math-chat-service.js";
import type { MathConversationContext } from "../../src/application/math-agent/types.js";
import { resolveAppConfig, type AppConfig } from "../../src/infrastructure/config/app-config.js";
import { createEventId } from "../../src/infrastructure/observability/event-tree.js";
import { createTelemetryWriter } from "../../src/infrastructure/observability/create-telemetry-writer.js";
import type { TelemetryWriter } from "../../src/infrastructure/observability/telemetry-writer.js";
import type { ConversationMessage, MathModelProvider } from "../../src/infrastructure/llm/types.js";

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
  const capability = new MathCapability(config, provider, activeLogger);
  const initialContext = {
    ...conversationContext,
    history,
  };
  const runRootEventId = createEventId();

  await activeLogger.write({
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
    await activeLogger.write({
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

    const result = await capability.handle(input, {
      history: initialContext.history,
      metadata: {
        pendingQuestion: initialContext.pendingQuestion,
        factMemory: initialContext.factMemory,
        turnMode: initialContext.turnMode,
        lastClarificationQuestion: initialContext.lastClarificationQuestion,
        graphParentEventId: graphSessionEventId,
      },
    });
    const finalAnswer = result.output;
    await activeLogger.write({
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
    await activeLogger.write({
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
  private readonly service: MathChatService;

  constructor(provider: MathModelProvider, config: AppConfig = resolveAppConfig()) {
    this.service = new MathChatService(config, provider);
  }

  async respond(input: string): Promise<string> {
    return this.service.respond(input);
  }

  getHistory(): ConversationMessage[] {
    return this.service.getHistory();
  }
}
