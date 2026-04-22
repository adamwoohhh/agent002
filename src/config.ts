import { parseCliOptions } from "./infrastructure/config/cli.js";

type CliParseResult = {
  input: string;
};

export function applyCliOverrides(argv: string[]): CliParseResult {
  const parsed = parseCliOptions(argv);
  for (const [key, value] of Object.entries(parsed.overrides)) {
    process.env[key] = value;
  }

  return {
    input: parsed.input,
  };
}

export { parseCliOptions };
