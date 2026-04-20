import test from "node:test";
import assert from "node:assert/strict";

import { createMathModelProvider } from "../../src/llm/index.js";
import { runMathAgent } from "../../src/agent.js";

const shouldRun = process.env.AGX_ENABLE_LLM_EVALS === "1";
const llmTest = shouldRun ? test : test.skip;

llmTest("real llm evals: active provider preserves current agent capability", async (t) => {
  const provider = createMathModelProvider();

  const cases = [
    { input: "请帮我算一下 12 加 8", expected: "12 + 8 = 20" },
    { input: "50 减 6", expected: "50 - 6 = 44" },
    { input: "7 乘 9", expected: "7 * 9 = 63" },
    { input: "20 除以 5", expected: "20 / 5 = 4" },
  ];

  for (const item of cases) {
    await t.test(item.input, async () => {
      const actual = await runMathAgent(item.input, provider);
      assert.equal(actual, item.expected);
    });
  }
});
