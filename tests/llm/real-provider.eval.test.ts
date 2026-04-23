import test from "node:test";
import assert from "node:assert/strict";

import { createMathModelProvider } from "../../src/llm/index.js";
import { MathChatSession, runMathAgent } from "../helpers/math-agent-test-helpers.js";

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

  await t.test("bad case: keep the original target question across supplemental turns", async () => {
    const session = new MathChatSession(provider);

    const answer1 = await session.respond("小明今天 10 岁，小明爸爸今年多少岁？");
    const answer2 = await session.respond("小明出生时他妈妈 25 岁。");
    const answer3 = await session.respond("小明出生三年后小明妹妹小美出生了，小美的爸爸当时是 28 岁。");

    assert.match(answer1, /小明爸爸|相关信息|补充/);
    assert.match(answer2, /小明爸爸|相关信息|补充/);
    assert.match(answer3, /35/);
  });
});
