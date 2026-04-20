import test from "node:test";
import assert from "node:assert/strict";

import { applyCliOverrides } from "../../src/config.js";

test("cli flags override AGX env vars without polluting user input", () => {
  const originalEnv = { ...process.env };

  try {
    const parsed = applyCliOverrides([
      "--provider=http",
      "--model",
      "demo-model",
      "--http-timeout-ms=12345",
      "请帮我算一下",
      "18",
      "除以",
      "3",
    ]);

    assert.equal(process.env.AGX_PROVIDER, "http");
    assert.equal(process.env.AGX_MODEL, "demo-model");
    assert.equal(process.env.AGX_HTTP_TIMEOUT_MS, "12345");
    assert.equal(parsed.input, "请帮我算一下 18 除以 3");
  } finally {
    process.env = originalEnv;
  }
});

test("unknown cli flags fail fast", () => {
  assert.throws(() => applyCliOverrides(["--unknown", "value", "12 加 8"]), /不支持的 CLI 参数/);
});

test("missing cli flag value fails fast", () => {
  assert.throws(() => applyCliOverrides(["--provider"]), /缺少值/);
});
