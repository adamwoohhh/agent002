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

  return capability.run(input, {
    ...conversationContext,
    history,
  });
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
