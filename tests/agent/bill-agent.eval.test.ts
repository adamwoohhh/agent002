import test from "node:test";
import assert from "node:assert/strict";

import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../../src/infrastructure/llm/types.js";
import { MathChatSession } from "../helpers/math-agent-test-helpers.js";

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

test("bill chat session settles a multi-turn group bill using local computation", async () => {
  let billAnalysisCalls = 0;
  const provider = new StubProvider(({ messages, tools }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";

    if (systemMessage.includes("对话路由助手")) {
      const input = extractCurrentInput(userMessage);
      return {
        text:
          input === "早上我给我们三个人买了早饭，花了30元" ||
          input === "中午小明给我买了午饭，花了30元，小花自己买的午饭，花了20元" ||
          input === "晚饭我们三个人一起吃的，小花先付了100元" ||
          input === "没有其他支付事件了，开始结算吧" ||
          input === "确认，里面的我就是我本人，也参与分摊" ||
          input === "确认无误，开始结算"
            ? "SUPPLEMENT"
            : "NEW_REQUEST",
      };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      assert.match(systemMessage, /完整支付事件必须以 JSON records 返回/);
      assert.match(systemMessage, /不要把未确认的新名字默认加入参与人/);
      billAnalysisCalls += 1;
      const input = extractCurrentInput(userMessage);

      if (input.includes("出去玩")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "计算本次聚会账单结算结果",
            participants: ["我", "小明", "小花"],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input.includes("早饭")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "计算本次聚会账单结算结果",
            participants: [],
            records: [
              {
                payer: "我",
                amount: 30,
                beneficiaries: ["我", "小明", "小花"],
                description: "早饭",
                sourceText: input,
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input.includes("中午小明")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "计算本次聚会账单结算结果",
            participants: [],
            records: [
              {
                payer: "小明",
                amount: 30,
                beneficiaries: ["我"],
                description: "午饭",
                sourceText: "中午小明给我买了午饭，花了30元",
              },
              {
                payer: "小花",
                amount: 20,
                beneficiaries: ["小花"],
                description: "午饭",
                sourceText: "小花自己买的午饭，花了20元",
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input.includes("晚饭")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "计算本次聚会账单结算结果",
            participants: [],
            records: [
              {
                payer: "小花",
                amount: 100,
                beneficiaries: ["我", "小明", "小花"],
                description: "晚饭",
                sourceText: input,
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input.includes("没有其他支付事件了")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "计算本次聚会账单结算结果",
            participants: [],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: true,
            clarificationQuestion: null,
          }),
        };
      }
    }

    if (tools) {
      if (systemMessage.includes("math skill")) {
        return {
          text: "",
          toolCall: {
            name: "add",
            arguments: JSON.stringify({ left: 12, right: 8 }),
          },
        };
      }
    }

    if (!tools && userMessage.includes("计算结果：20")) {
      return {
        text: "12 + 8 = 20",
      };
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);

  assert.match(await session.respond("上周末我和小明、小花出去玩了，我们都花了一些钱，现在要算一下帐"), /我识别到参与人：我、小明、小花/);
  assert.match(await session.respond("确认，里面的我就是我本人，也参与分摊"), /已确认参与人：我、小明、小花/);
  assert.match(await session.respond("早上我给我们三个人买了早饭，花了30元"), /还有其他人付了钱吗/);
  assert.match(await session.respond("中午小明给我买了午饭，花了30元，小花自己买的午饭，花了20元"), /当前共有3笔/);
  assert.match(await session.respond("晚饭我们三个人一起吃的，小花先付了100元"), /当前共有4笔/);

  const preview = await session.respond("没有其他支付事件了，开始结算吧");
  assert.match(preview, /请确认以下结构化账单数据/);
  assert.match(preview, /"participants": \[/);
  assert.match(preview, /"records": \[/);
  assert.match(preview, /"payer": "我"/);
  assert.doesNotMatch(preview, /我给小花43\.34元/);

  const finalAnswer = await session.respond("确认无误，开始结算");
  assert.match(finalAnswer, /账本明细：/);
  assert.match(finalAnswer, /我：实付30元，应付73\.34元，净额-43\.34元/);
  assert.match(finalAnswer, /小明：实付30元，应付43\.33元，净额-13\.33元/);
  assert.match(finalAnswer, /小花：实付120元，应付63\.33元，净额\+56\.67元/);
  assert.match(finalAnswer, /我给小花43\.34元/);
  assert.match(finalAnswer, /小明给小花13\.33元/);
  assert.equal(billAnalysisCalls, 7);
});

test("bill chat confirms initial participants before recording first complete payment", async () => {
  const provider = new StubProvider(({ messages }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";
    const input = extractCurrentInput(userMessage);

    if (systemMessage.includes("对话路由助手")) {
      return { text: input === "确认，里面的我就是我本人，也参与分摊" ? "SUPPLEMENT" : "NEW_REQUEST" };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      if (input.includes("早饭")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "小明", "小花"],
            records: [
              {
                payer: "我",
                amount: 30,
                beneficiaries: ["我", "小明", "小花"],
                description: "早饭",
                sourceText: input,
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      return {
        text: JSON.stringify({
          pendingQuestion: "记录并整理本次聚会账单",
          participants: [],
          records: [],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }),
      };
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);
  const first = await session.respond("早上我和小明、小花一起出去玩，我给我们三个人买了早饭，花了30元");
  assert.match(first, /我识别到参与人：我、小明、小花/);
  assert.match(first, /这里的“我”是否代表你本人/);
  assert.doesNotMatch(first, /已记下1笔账单/);

  const second = await session.respond("确认，里面的我就是我本人，也参与分摊");
  assert.match(second, /已确认参与人：我、小明、小花/);
  assert.match(second, /已记下1笔账单/);
});

test("bill chat asks before adding a later unknown participant", async () => {
  const provider = new StubProvider(({ messages }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";
    const input = extractCurrentInput(userMessage);

    if (systemMessage.includes("对话路由助手")) {
      return {
        text:
          input === "确认，里面的我就是我本人，也参与分摊" ||
          input === "李雷买了奶茶，花了60元，我们三个人分摊"
            ? "SUPPLEMENT"
            : "NEW_REQUEST",
      };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      if (input === "我和小明准备算账单") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "小明"],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input === "李雷买了奶茶，花了60元，我们三个人分摊") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: [],
            records: [
              {
                payer: "李雷",
                amount: 60,
                beneficiaries: ["我", "小明", "李雷"],
                description: "奶茶",
                sourceText: input,
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      return {
        text: JSON.stringify({
          pendingQuestion: "记录并整理本次聚会账单",
          participants: [],
          records: [],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }),
      };
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);
  await session.respond("我和小明准备算账单");
  await session.respond("确认，里面的我就是我本人，也参与分摊");
  const answer = await session.respond("李雷买了奶茶，花了60元，我们三个人分摊");

  assert.match(answer, /我识别到“李雷”不在当前参与人中/);
  assert.match(answer, /是否要把他加入本次账单参与人/);
  assert.doesNotMatch(answer, /已记下1笔账单/);
});

test("bill chat session asks for missing beneficiaries before recording a payment", async () => {
  const provider = new StubProvider(({ messages }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";

    if (systemMessage.includes("对话路由助手")) {
      const input = extractCurrentInput(userMessage);
      return {
        text:
          input === "确认，里面的我就是我本人，也参与分摊" ||
          input === "我付了100元" ||
          input === "我们三个人一起吃的"
            ? "SUPPLEMENT"
            : "NEW_REQUEST",
      };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      const input = extractCurrentInput(userMessage);
      if (input === "我和小明、小花一起吃饭") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "小明", "小花"],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input === "我付了100元") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: [],
            records: [],
            pendingExpenseDraft: {
              payer: "我",
              amount: 100,
              beneficiaries: [],
              description: "吃饭",
              sourceText: "我付了100元",
              missingFields: ["beneficiaries"],
            },
            settlementRequested: false,
            clarificationQuestion: "这笔钱是给谁花的？请说明具体由哪些人分摊。",
          }),
        };
      }

      if (input === "我们三个人一起吃的") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: [],
            records: [
              {
                payer: "我",
                amount: 100,
                beneficiaries: ["我", "小明", "小花"],
                description: "吃饭",
                sourceText: "我付了100元；我们三个人一起吃的",
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);
  assert.match(await session.respond("我和小明、小花一起吃饭"), /我识别到参与人：我、小明、小花/);
  assert.match(await session.respond("确认，里面的我就是我本人，也参与分摊"), /已确认参与人：我、小明、小花/);
  const clarification = await session.respond("我付了100元");
  const acknowledgement = await session.respond("我们三个人一起吃的");

  assert.equal(clarification, "这笔钱是给谁花的？请说明具体由哪些人分摊。");
  assert.match(acknowledgement, /还有其他人付了钱吗/);
});

test("bill chat session keeps arbitrary clarification replies on the active bill skill", async () => {
  const provider = new StubProvider(({ messages }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";

    if (systemMessage.includes("对话路由助手")) {
      const input = extractCurrentInput(userMessage);
      return {
        text:
          input === "确认，里面的我就是我本人，也参与分摊" ||
          input === "付了100元" ||
          input === "张三"
            ? "SUPPLEMENT"
            : "NEW_REQUEST",
      };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      const input = extractCurrentInput(userMessage);
      if (input === "我们一起吃饭") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "张三"],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }

      if (input === "付了100元") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: [],
            records: [],
            pendingExpenseDraft: {
              payer: null,
              amount: 100,
              beneficiaries: ["我", "张三"],
              description: "吃饭",
              sourceText: "付了100元",
              missingFields: ["payer"],
            },
            settlementRequested: false,
            clarificationQuestion: "这笔钱是谁付的？",
          }),
        };
      }

      if (input === "张三") {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: [],
            records: [
              {
                payer: "张三",
                amount: 100,
                beneficiaries: ["我", "张三"],
                description: "吃饭",
                sourceText: "张三付了100元",
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: null,
          }),
        };
      }
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);
  assert.match(await session.respond("我们一起吃饭"), /我识别到参与人：我、张三/);
  assert.match(await session.respond("确认，里面的我就是我本人，也参与分摊"), /已确认参与人：我、张三/);
  const clarification = await session.respond("付了100元");
  const acknowledgement = await session.respond("张三");

  assert.equal(clarification, "这笔钱是谁付的？");
  assert.match(acknowledgement, /张三/);
  assert.match(acknowledgement, /还有其他人付了钱吗/);
});

test("bill chat session can reroute to math for a new standalone request", async () => {
  const provider = new StubProvider(({ messages, tools }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";

    if (systemMessage.includes("对话路由助手")) {
      const input = extractCurrentInput(userMessage);
      return {
        text: input === "12 加 8" ? "NEW_REQUEST" : "NEW_REQUEST",
      };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      return {
        text: JSON.stringify({
          pendingQuestion: "记录并整理本次聚会账单",
          participants: ["我", "小明"],
          records: [],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }),
      };
    }

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

  const session = new MathChatSession(provider);
  await session.respond("我和小明准备记账");
  const answer = await session.respond("12 加 8");
  assert.equal(answer, "12 + 8 = 20");
});

test("currency arithmetic still routes to math instead of bill", async () => {
  const provider = new StubProvider(({ messages, tools }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";

    if (tools) {
      assert.match(systemMessage, /math skill/);
      return {
        text: "",
        toolCall: {
          name: "add",
          arguments: JSON.stringify({ left: 100, right: 20 }),
        },
      };
    }

    return {
      text: userMessage.includes("计算结果：120") ? "100 + 20 = 120" : "NEW_REQUEST",
    };
  });

  const session = new MathChatSession(provider);
  const answer = await session.respond("100元加20元等于多少");
  assert.equal(answer, "100 + 20 = 120");
});

function extractCurrentInput(prompt: string): string {
  const match = prompt.match(/本轮用户输入：([\s\S]+)$/);
  return match?.[1]?.trim() ?? prompt.trim();
}
