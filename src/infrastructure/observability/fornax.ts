import { FornaxCallbackHandler } from "@next-ai/fornax-langchain";

import type { AppConfig } from "../config/app-config.js";

export function createObservabilityCallbacks(config: AppConfig) {
  if (!config.observability.fornaxAk || !config.observability.fornaxSk) {
    return [];
  }

  return [
    new FornaxCallbackHandler({
      spanExporter: {
        ak: config.observability.fornaxAk,
        sk: config.observability.fornaxSk,
      },
    }),
  ];
}
