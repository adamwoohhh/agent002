import test from "node:test";
import assert from "node:assert/strict";

import { AgentRuntime } from "../../src/platform/runtime/agent-runtime.js";
import { CapabilityRegistry, type Capability } from "../../src/platform/runtime/capability.js";
import type { ExecutionPolicy } from "../../src/platform/runtime/policy.js";

test("agent runtime executes registered capability through task lifecycle", async () => {
  const registry = new CapabilityRegistry();
  const capability: Capability = {
    name: "math",
    async handle(input) {
      return {
        output: `handled:${input}`,
      };
    },
  };
  registry.register(capability);

  const runtime = new AgentRuntime(registry);
  const result = await runtime.execute("math", "12 加 8");

  assert.equal(result.output, "handled:12 加 8");
  assert.equal(result.run.steps[0]?.status, "completed");
  assert.equal(result.run.outcome?.status, "completed");
});

test("agent runtime respects execution policy rejection", async () => {
  const registry = new CapabilityRegistry();
  registry.register({
    name: "math",
    async handle() {
      throw new Error("should not execute");
    },
  });

  const policy: ExecutionPolicy = {
    authorize() {
      return {
        allowed: false,
        reason: "policy denied",
      };
    },
  };

  const runtime = new AgentRuntime(registry, undefined, policy);
  const result = await runtime.execute("math", "12 加 8");

  assert.equal(result.output, "policy denied");
  assert.equal(result.run.outcome?.status, "rejected");
});
