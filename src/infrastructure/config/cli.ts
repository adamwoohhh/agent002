const CLI_ENV_MAPPINGS = {
  "--provider": "AGX_PROVIDER",
  "--api-key": "AGX_API_KEY",
  "--model": "AGX_MODEL",
  "--base-url": "AGX_BASE_URL",
  "--http-url": "AGX_HTTP_URL",
  "--http-api-key": "AGX_HTTP_API_KEY",
  "--http-model": "AGX_HTTP_MODEL",
  "--http-timeout-ms": "AGX_HTTP_TIMEOUT_MS",
} as const;

export type SupportedCliFlag = keyof typeof CLI_ENV_MAPPINGS;

export type CliOptions = {
  input: string;
  overrides: Partial<Record<(typeof CLI_ENV_MAPPINGS)[SupportedCliFlag], string>>;
};

export function parseCliOptions(argv: string[]): CliOptions {
  const remainingArgs: string[] = [];
  const overrides: CliOptions["overrides"] = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      remainingArgs.push(current);
      continue;
    }

    const [flag, inlineValue] = splitInlineFlag(current);
    if (!(flag in CLI_ENV_MAPPINGS)) {
      throw new Error(`不支持的 CLI 参数: ${flag}`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`CLI 参数 ${flag} 缺少值`);
    }

    overrides[CLI_ENV_MAPPINGS[flag as SupportedCliFlag]] = value;

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return {
    input: remainingArgs.join(" ").trim(),
    overrides,
  };
}

function splitInlineFlag(arg: string): [string, string | undefined] {
  const equalIndex = arg.indexOf("=");
  if (equalIndex === -1) {
    return [arg, undefined];
  }

  return [arg.slice(0, equalIndex), arg.slice(equalIndex + 1)];
}
