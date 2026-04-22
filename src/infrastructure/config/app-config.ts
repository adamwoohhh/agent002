import type { CliOptions } from "./cli.js";

export type ProviderType = "openai" | "http";

export type AppConfig = {
  provider: {
    type: ProviderType;
    apiKey?: string;
    model: string;
    baseUrl?: string;
    httpUrl?: string;
    httpApiKey?: string;
    httpModel?: string;
    httpTimeoutMs: number;
  };
  logging: {
    directory?: string;
  };
  observability: {
    fornaxAk?: string;
    fornaxSk?: string;
  };
};

export function resolveAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  cliOptions?: Partial<CliOptions>,
): AppConfig {
  const mergedEnv: NodeJS.ProcessEnv = {
    ...env,
    ...(cliOptions?.overrides ?? {}),
  };

  const providerType = (mergedEnv.AGX_PROVIDER?.trim().toLowerCase() ?? "openai") as ProviderType;
  if (!["openai", "http"].includes(providerType)) {
    throw new Error(`不支持的 AGX_PROVIDER: ${providerType}。当前支持: openai, http`);
  }

  return {
    provider: {
      type: providerType,
      apiKey: mergedEnv.AGX_API_KEY?.trim(),
      model: mergedEnv.AGX_MODEL?.trim() || "gpt-4.1",
      baseUrl: mergedEnv.AGX_BASE_URL?.trim() || undefined,
      httpUrl: mergedEnv.AGX_HTTP_URL?.trim() || undefined,
      httpApiKey: mergedEnv.AGX_HTTP_API_KEY?.trim() || undefined,
      httpModel: mergedEnv.AGX_HTTP_MODEL?.trim() || undefined,
      httpTimeoutMs: Number(mergedEnv.AGX_HTTP_TIMEOUT_MS?.trim() || "30000"),
    },
    logging: {
      directory: mergedEnv.AGX_LOG_DIR?.trim() || undefined,
    },
    observability: {
      fornaxAk: mergedEnv.FORNAX_AK?.trim() || undefined,
      fornaxSk: mergedEnv.FORNAX_SK?.trim() || undefined,
    },
  };
}
