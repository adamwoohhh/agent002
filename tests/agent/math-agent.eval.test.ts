import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MathChatSession, runMathAgent } from "../../src/agent.js";
import type { MathToolDecision } from "../../src/math.js";
import type {
  ConversationMessage,
  MathModelProvider,
  ModelMessage,
  ModelResponse,
  ModelTool,
} from "../../src/llm/types.js";

class StubProvider implements MathModelProvider {
  constructor(
    private readonly respond: (params: {
      messages: ModelMessage[];
      tools?: ModelTool[];
    }) => Promise<ModelResponse> | ModelResponse,
  ) {}

  async generate(params: {
    messages: ModelMessage[];
    tools?: ModelTool[];
  }): Promise<ModelResponse> {
    return this.respond(params);
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
      decision: { kind: "solve", operation: "add", operands: [12, 8] },
      expected: "12 + 8 = 20",
    },
    {
      name: "subtract",
      input: "50 减 6",
      decision: { kind: "solve", operation: "subtract", operands: [50, 6] },
      expected: "50 - 6 = 44",
    },
    {
      name: "multiply",
      input: "7 乘 9",
      decision: { kind: "solve", operation: "multiply", operands: [7, 9] },
      expected: "7 * 9 = 63",
    },
    {
      name: "divide",
      input: "20 除以 5",
      decision: { kind: "solve", operation: "divide", operands: [20, 5] },
      expected: "20 / 5 = 4",
    },
    {
      name: "normalize english input before provider sees it",
      input: "12 plus 8",
      decision: { kind: "solve", operation: "add", operands: [12, 8] },
      expected: "12 + 8 = 20",
      expectedProviderInput: "12 加 8",
    },
    {
      name: "unsupported request stays guarded",
      input: "帮我算 12 加 8 再乘以 2",
      decision: { kind: "reject", reason: "只支持一次运算" },
      expected: "暂时只支持两个数字的一次加减乘除，例如：`12 加 8`、`50 减 6`、`7 乘 9`、`20 除以 5`。",
    },
    {
      name: "divide by zero surfaces tool error",
      input: "10 除以 0",
      decision: { kind: "solve", operation: "divide", operands: [10, 0] },
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
      const provider = new StubProvider(async ({ messages, tools }) => {
        const userMessage = messages.at(-1);
        if (tools) {
          seenInput = userMessage?.content ?? "";
        }

        if ("error" in item && item.error && tools) {
          throw item.error;
        }
        if ("decision" in item && tools) {
          if (item.decision.kind === "solve") {
            return {
              text: "",
              toolCall: {
                name: item.decision.operation,
                arguments: JSON.stringify({
                  left: item.decision.operands[0],
                  right: item.decision.operands[1],
                }),
              },
            };
          }

          if (item.decision.kind === "clarify") {
            return {
              text: `CLARIFY: ${item.decision.question}`,
            };
          }

          return {
            text: `UNSUPPORTED: ${item.decision.reason}`,
          };
        }

        const finalUserPrompt = userMessage?.content ?? "";
        const resultMatch = finalUserPrompt.match(/计算结果：(.+)$/m);
        const operationMatch = finalUserPrompt.match(/计算操作：(.+)$/m);
        const paramsMatch = finalUserPrompt.match(/计算参数：(.+), (.+)$/m);

        if (resultMatch && operationMatch && paramsMatch) {
          const operatorMap = {
            add: "+",
            subtract: "-",
            multiply: "*",
            divide: "/",
          } as const;

          const operation = operationMatch[1] as keyof typeof operatorMap;
          return {
            text: `${paramsMatch[1]} ${operatorMap[operation]} ${paramsMatch[2]} = ${resultMatch[1]}`,
          };
        }

        throw new Error("测试用例缺少 mock 返回值");
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
  const provider = new StubProvider(({ messages, tools }) => {
    const userMessage = messages.at(-1)?.content ?? "";
    const history = parseHistoryFromPrompt(userMessage);

    if (tools) {
      seenHistories.push(history);
    }

    if (tools && userMessage === "12 加 8") {
      return {
        text: "",
        toolCall: {
          name: "add",
          arguments: JSON.stringify({ left: 12, right: 8 }),
        },
      };
    }

    if (tools && userMessage.includes("本轮用户问题：结果再乘 2")) {
      return {
        text: "",
        toolCall: {
          name: "multiply",
          arguments: JSON.stringify({ left: 20, right: 2 }),
        },
      };
    }

    if (!tools) {
      const resultMatch = userMessage.match(/计算结果：(.+)$/m);
      const operationMatch = userMessage.match(/计算操作：(.+)$/m);
      const paramsMatch = userMessage.match(/计算参数：(.+), (.+)$/m);
      if (resultMatch && operationMatch && paramsMatch) {
        const operatorMap = {
          add: "+",
          subtract: "-",
          multiply: "*",
          divide: "/",
        } as const;

        return {
          text: `${paramsMatch[1]} ${operatorMap[operationMatch[1] as keyof typeof operatorMap]} ${paramsMatch[2]} = ${resultMatch[1]}`,
        };
      }
    }

    throw new Error(`unexpected input: ${userMessage}`);
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

test("agent answers with scenario-aware natural language", async () => {
  const provider = new StubProvider(({ messages, tools }) => {
    if (tools) {
      return {
        text: "",
        toolCall: {
          name: "subtract",
          arguments: JSON.stringify({ left: 3, right: 1 }),
        },
      };
    }

    return {
      text: "还剩下 2 个苹果。",
    };
  });

  const result = await runMathAgent(
    "冰箱里有 3 个苹果，早上我吃了 1 个，还剩下几个苹果",
    provider,
  );

  assert.equal(result, "还剩下 2 个苹果。");
});

test("chat session asks for clarification and uses the follow-up answer", async () => {
  const provider = new StubProvider(({ messages, tools }) => {
    const userMessage = messages.at(-1)?.content ?? "";

    if (tools && userMessage === "冰箱里有 3 个苹果,早上我吃了苹果,还剩下几个苹果") {
      return {
        text: "CLARIFY: 你早上吃了几个苹果？",
      };
    }

    if (tools && userMessage.includes("本轮用户问题：1个")) {
      assert.deepEqual(parseHistoryFromPrompt(userMessage), [
        {
          role: "user",
          content: "冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果",
        },
        {
          role: "assistant",
          content: "你早上吃了几个苹果？",
        },
      ]);

      return {
        text: "",
        toolCall: {
          name: "subtract",
          arguments: JSON.stringify({ left: 3, right: 1 }),
        },
      };
    }

    if (!tools) {
      return {
        text: "还剩下 2 个苹果。",
      };
    }

    throw new Error(`unexpected input: ${userMessage}`);
  });

  const session = new MathChatSession(provider);

  const clarification = await session.respond("冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果");
  const finalAnswer = await session.respond("1个");

  assert.equal(clarification, "你早上吃了几个苹果？");
  assert.equal(finalAnswer, "还剩下 2 个苹果。");
  assert.deepEqual(session.getHistory(), [
    {
      role: "user",
      content: "冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果",
    },
    {
      role: "assistant",
      content: "你早上吃了几个苹果？",
    },
    {
      role: "user",
      content: "1个",
    },
    {
      role: "assistant",
      content: "还剩下 2 个苹果。",
    },
  ]);
});

test("agent writes node execution details to one jsonl file per run", async () => {
  const logDir = await mkdtemp(path.join(os.tmpdir(), "agent002-run-logs-"));

  await withEnv(
    {
      AGX_LOG_DIR: logDir,
    },
    async () => {
      const provider = new StubProvider(({ tools }) => {
        if (tools) {
          return {
            text: "",
            toolCall: {
              name: "add",
              arguments: JSON.stringify({ left: 12, right: 8 }),
            },
          };
        }

        return {
          text: "12 + 8 = 20",
        };
      });

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

function parseHistoryFromPrompt(prompt: string): ConversationMessage[] {
  if (!prompt.includes("以下是之前的对话历史")) {
    return [];
  }

  const historyBlock = prompt
    .slice(prompt.indexOf("\n") + 1, prompt.lastIndexOf("\n\n本轮用户问题："))
    .trim();

  if (!historyBlock) {
    return [];
  }

  return historyBlock.split("\n").map((line) => {
    const [speaker, ...rest] = line.split(": ");
    return {
      role: speaker === "用户" ? "user" : "assistant",
      content: rest.join(": "),
    };
  });
}
