import { resolveAppConfig, type AppConfig } from "./infrastructure/config/app-config.js";
import type { MathModelProvider, ConversationMessage } from "./infrastructure/llm/types.js";
import { JsonlRunLogger } from "./infrastructure/observability/jsonl-run-logger.js";
import { MathCapability } from "./application/math-agent/math-capability.js";
import { MathChatService } from "./application/math-agent/math-chat-service.js";
import type { MathConversationContext } from "./application/math-agent/types.js";

export async function runMathAgent(
  input: string,
  provider: MathModelProvider,
  history: ConversationMessage[] = [],
  logger?: JsonlRunLogger,
  conversationContext: MathConversationContext = {},
): Promise<string> {
  const config = resolveAppConfig();
  const activeLogger =
    logger ??
    (await JsonlRunLogger.create("agx-run", {
      logDirectory: config.logging.directory,
    }));
  const capability = new MathCapability(config, provider, activeLogger);
  const initialContext = {
    ...conversationContext,
    history,
  };

  await activeLogger.write({
    type: "run_started",
    timestamp: new Date().toISOString(),
    runId: activeLogger.runId,
    input,
    phase: "direct_run",
    initialContext,
  });

  try {
    const finalAnswer = await capability.run(input, initialContext);
    await activeLogger.write({
      type: "run_completed",
      timestamp: new Date().toISOString(),
      runId: activeLogger.runId,
      finalAnswer,
      phase: "direct_run",
    });
    return finalAnswer;
  } catch (error) {
    await activeLogger.write({
      type: "run_failed",
      timestamp: new Date().toISOString(),
      runId: activeLogger.runId,
      error,
      phase: "direct_run",
    });
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
