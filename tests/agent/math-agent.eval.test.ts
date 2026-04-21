import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MathChatSession, runMathAgent } from "../../src/agent.js";
import type { ConversationMessage, MathModelProvider } from "../../src/llm/types.js";
import type { MathToolDecision } from "../../src/math.js";

class StubProvider implements MathModelProvider {
  constructor(
    private readonly decide: (
      input: string,
      history: ConversationMessage[],
    ) => Promise<MathToolDecision> | MathToolDecision,
  ) {}

  async chooseMathTool(input: string, history: ConversationMessage[] = []): Promise<MathToolDecision> {
    return this.decide(input, history);
  }
}

type EnvSnapshot = NodeJS.ProcessEnv;

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const originalEnv: EnvSnapshot = { ...process.env };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = originalEnv;
    });
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

test("chat session carries history across turns for follow-up calculations", async () => {
  const seenHistories: ConversationMessage[][] = [];
  const provider = new StubProvider((input, history) => {
    seenHistories.push(history.map((message) => ({ ...message })));

    if (input === "12 加 8") {
      return { canSolve: true, operation: "add", operands: [12, 8] };
    }

    if (input === "结果再乘 2") {
      return { canSolve: true, operation: "multiply", operands: [20, 2] };
    }

    throw new Error(`unexpected input: ${input}`);
  });

  const session = new MathChatSession(provider);

  const firstReply = await session.respond("12 加 8");
  const secondReply = await session.respond("结果再乘 2");

  assert.equal(firstReply, "12 + 8 = 20");
  assert.equal(secondReply, "20 * 2 = 40");
  assert.deepEqual(seenHistories[0], []);
  assert.deepEqual(seenHistories[1], [
    { role: "user", content: "12 加 8" },
    { role: "assistant", content: "12 + 8 = 20" },
  ]);
  assert.deepEqual(session.getHistory(), [
    { role: "user", content: "12 加 8" },
    { role: "assistant", content: "12 + 8 = 20" },
    { role: "user", content: "结果再乘 2" },
    { role: "assistant", content: "20 * 2 = 40" },
  ]);
});

test("agent writes node execution details to one jsonl file per run", async () => {
  const logDir = await mkdtemp(path.join(os.tmpdir(), "agent002-run-logs-"));

  await withEnv(
    {
      AGX_LOG_DIR: logDir,
    },
    async () => {
      const provider = new StubProvider(() => ({
        canSolve: true,
        operation: "add",
        operands: [12, 8],
      }));

      const result = await runMathAgent("请帮我算一下 12 加 8", provider);
      assert.equal(result, "12 + 8 = 20");

      const files = await readdir(logDir);
      assert.equal(files.length, 1);
      assert.match(files[0], /^math-agent-run-.*\.jsonl$/);

      const logFilePath = path.join(logDir, files[0]);
      const logLines = (await readFile(logFilePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      assert.equal(logLines[0].type, "run_started");
      assert.equal(logLines.at(-1)?.type, "run_completed");
      assert.ok(logLines.some((line) => line.type === "graph_event" && line.mode === "tasks"));
      assert.ok(logLines.some((line) => line.type === "graph_event" && line.mode === "debug"));
      assert.ok(logLines.some((line) => line.type === "graph_event" && line.mode === "values"));
    },
  );
});
