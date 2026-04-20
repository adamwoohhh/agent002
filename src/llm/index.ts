import { HttpChatCompletionsProvider } from "./http-provider.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";
import type { MathModelProvider } from "./types.js";

export function createMathModelProvider(): MathModelProvider {
  const provider = process.env.AGX_PROVIDER?.trim().toLowerCase() ?? "openai";

  switch (provider) {
    case "openai":
      return new OpenAIResponsesProvider();
    case "http":
      return new HttpChatCompletionsProvider();
    default:
      throw new Error(`不支持的 AGX_PROVIDER: ${provider}。当前支持: openai, http`);
  }
}
