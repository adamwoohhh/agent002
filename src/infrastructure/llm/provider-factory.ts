import type { AppConfig } from "../config/app-config.js";
import type { MathModelProvider } from "./types.js";
import { HttpChatCompletionsProvider } from "./http-provider.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";

export function createMathModelProvider(config: AppConfig): MathModelProvider {
  switch (config.provider.type) {
    case "openai":
      return new OpenAIResponsesProvider(config);
    case "http":
      return new HttpChatCompletionsProvider(config);
    default:
      throw new Error(`不支持的 AGX_PROVIDER: ${config.provider.type}。当前支持: openai, http`);
  }
}
