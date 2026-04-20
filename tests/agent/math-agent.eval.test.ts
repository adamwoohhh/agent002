import test from "node:test";
import assert from "node:assert/strict";

import { runMathAgent } from "../../src/agent.js";
import type { MathModelProvider } from "../../src/llm/types.js";
import type { MathToolDecision } from "../../src/math.js";

class StubProvider implements MathModelProvider {
  constructor(
    private readonly decide: (input: string) => Promise<MathToolDecision> | MathToolDecision,
  ) {}

  async chooseMathTool(input: string): Promise<MathToolDecision> {
    return this.decide(input);
  }
}

type AgentEvalCase =
  | {
      name: string;
      input: string;
      decision: MathToolDecision;
      expected: string;
      expectedProviderInput?: string;
    }
  | {
      name: string;
      input: string;
      expected: string;
      error: Error;
      expectedProviderInput?: string;
    };

test("agent evals: core math capabilities stay stable", async (t) => {
  const cases: AgentEvalCase[] = [
    {
      name: "add",
      input: "请帮我算一下 12 加 8",
      decision: { canSolve: true, operation: "add", operands: [12, 8] },
      expected: "12 + 8 = 20",
    },
    {
      name: "subtract",
      input: "50 减 6",
      decision: { canSolve: true, operation: "subtract", operands: [50, 6] },
      expected: "50 - 6 = 44",
    },
    {
      name: "multiply",
      input: "7 乘 9",
      decision: { canSolve: true, operation: "multiply", operands: [7, 9] },
      expected: "7 * 9 = 63",
    },
    {
      name: "divide",
      input: "20 除以 5",
      decision: { canSolve: true, operation: "divide", operands: [20, 5] },
      expected: "20 / 5 = 4",
    },
    {
      name: "normalize english input before provider sees it",
      input: "12 plus 8",
      decision: { canSolve: true, operation: "add", operands: [12, 8] },
      expected: "12 + 8 = 20",
      expectedProviderInput: "12 加 8",
    },
    {
      name: "unsupported request stays guarded",
      input: "帮我算 12 加 8 再乘以 2",
      decision: { canSolve: false, reason: "只支持一次运算" },
      expected: "暂时只支持两个数字的一次加减乘除，例如：`12 加 8`、`50 减 6`、`7 乘 9`、`20 除以 5`。",
    },
    {
      name: "divide by zero surfaces tool error",
      input: "10 除以 0",
      decision: { canSolve: true, operation: "divide", operands: [10, 0] },
      expected: "除数不能为 0",
    },
    {
      name: "provider failure surfaces clearly",
      input: "12 加 8",
      expected: "provider boom",
      error: new Error("provider boom"),
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let seenInput = "";
      const provider = new StubProvider(async (input) => {
        seenInput = input;
        if ("error" in item && item.error) {
          throw item.error;
        }
        if ("decision" in item) {
          return item.decision;
        }

        throw new Error("测试用例缺少 decision");
      });

      const actual = await runMathAgent(item.input, provider);
      assert.equal(actual, item.expected);

      if ("expectedProviderInput" in item && item.expectedProviderInput) {
        assert.equal(seenInput, item.expectedProviderInput);
      }
    });
  }
});
