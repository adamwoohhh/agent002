import { resolveAppConfig } from "../infrastructure/config/app-config.js";
import { createMathModelProvider as createProvider } from "../infrastructure/llm/provider-factory.js";

export function createMathModelProvider() {
  return createProvider(resolveAppConfig());
}
