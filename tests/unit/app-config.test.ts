import test from "node:test";
import assert from "node:assert/strict";

import { resolveAppConfig } from "../../src/infrastructure/config/app-config.js";
import { parseCliOptions } from "../../src/infrastructure/config/cli.js";

test("parseCliOptions collects overrides without mutating process env", () => {
  const originalProvider = process.env.AGX_PROVIDER;

  const parsed = parseCliOptions(["--provider=http", "--model", "sample-model", "12", "加", "8"]);

  assert.equal(parsed.input, "12 加 8");
  assert.deepEqual(parsed.overrides, {
    AGX_PROVIDER: "http",
    AGX_MODEL: "sample-model",
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

test("resolveAppConfig applies fornax defaults and env overrides", () => {
  const config = resolveAppConfig({
    FORNAX_AK: "ak-test",
    FORNAX_SK: "sk-test",
    FORNAX_APP_NAME: "math-master-test",
    FORNAX_PROCESSOR: "simple",
    FORNAX_RECORD_INPUTS: "false",
    FORNAX_RECORD_OUTPUTS: "0",
  });

  assert.equal(config.observability.fornaxAk, "ak-test");
  assert.equal(config.observability.fornaxSk, "sk-test");
  assert.equal(config.observability.fornaxAppName, "math-master-test");
  assert.equal(config.observability.fornaxProcessor, "simple");
  assert.equal(config.observability.fornaxRecordInputs, false);
  assert.equal(config.observability.fornaxRecordOutputs, false);
});

test("resolveAppConfig falls back to safe fornax defaults", () => {
  const config = resolveAppConfig({});

  assert.equal(config.observability.fornaxAppName, "math-master");
  assert.equal(config.observability.fornaxProcessor, "batch");
  assert.equal(config.observability.fornaxRecordInputs, true);
  assert.equal(config.observability.fornaxRecordOutputs, true);
});
