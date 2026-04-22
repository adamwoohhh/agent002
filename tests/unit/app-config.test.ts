import test from "node:test";
import assert from "node:assert/strict";

import { resolveAppConfig } from "../../src/infrastructure/config/app-config.js";
import { parseCliOptions } from "../../src/infrastructure/config/cli.js";

test("parseCliOptions collects overrides without mutating process env", () => {
  const originalProvider = process.env.AGX_PROVIDER;

  const parsed = parseCliOptions(["--provider=http", "--model", "demo-model", "12", "加", "8"]);

  assert.equal(parsed.input, "12 加 8");
  assert.deepEqual(parsed.overrides, {
    AGX_PROVIDER: "http",
    AGX_MODEL: "demo-model",
  });
  assert.equal(process.env.AGX_PROVIDER, originalProvider);
});

test("resolveAppConfig applies cli override precedence on top of env", () => {
  const config = resolveAppConfig(
    {
      AGX_PROVIDER: "openai",
      AGX_MODEL: "env-model",
      AGX_HTTP_TIMEOUT_MS: "456",
    },
    {
      overrides: {
        AGX_PROVIDER: "http",
        AGX_MODEL: "cli-model",
      },
    },
  );

  assert.equal(config.provider.type, "http");
  assert.equal(config.provider.model, "cli-model");
  assert.equal(config.provider.httpTimeoutMs, 456);
});
