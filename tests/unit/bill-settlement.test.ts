import test from "node:test";
import assert from "node:assert/strict";

import { computeBillSettlement, formatBillSettlement } from "../../src/domain/bill/settlement.js";
import {
  analyzeBillConversationInput,
  BillSkillStateManager,
  createEmptyBillConversationState,
} from "../../src/application/bill-agent/conversation/state-manager.js";
import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../../src/infrastructure/llm/types.js";

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

test("computeBillSettlement calculates paid owed net and transfers locally", () => {
  const summary = computeBillSettlement(
    [
      {
        payer: "我",
        amount: 30,
        beneficiaries: ["我", "小明", "小花"],
        description: "早饭",
        sourceText: "早上我给我们三个人买了早饭，花了30元",
      },
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
      {
        payer: "小花",
        amount: 100,
        beneficiaries: ["我", "小明", "小花"],
        description: "晚饭",
        sourceText: "晚饭我们三个人一起吃的，小花先付了100元",
      },
    ],
    ["我", "小明", "小花"],
  );

  assert.deepEqual(summary.perPerson, [
    { participant: "我", paid: 30, owed: 73.34, net: -43.34 },
    { participant: "小明", paid: 30, owed: 43.33, net: -13.33 },
    { participant: "小花", paid: 120, owed: 63.33, net: 56.67 },
  ]);
  assert.deepEqual(summary.transfers, [
    { from: "我", to: "小花", amount: 43.34 },
    { from: "小明", to: "小花", amount: 13.33 },
  ]);

  assert.match(formatBillSettlement(summary), /我给小花43\.34元/);
  assert.match(formatBillSettlement(summary), /小明给小花13\.33元/);
});

test("bill conversation state manager accumulates participants and records", async () => {
  const manager = new BillSkillStateManager(
    new StubProvider(({ messages }) => {
      const input = messages.at(-1)?.content ?? "";
      if (input.includes("本轮用户输入：我和小明、小花出去玩")) {
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
              sourceText: "早上我给我们三个人买了早饭，花了30元",
            },
          ],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }),
      };
    }),
  );

  let state = createEmptyBillConversationState();
  ({ state } = await manager.beginTurn(state, "我和小明、小花出去玩了，我们都花了一些钱，现在要算一下帐", "new_request"));
  assert.deepEqual(state.participants, ["我", "小明", "小花"]);

  ({ state } = await manager.beginTurn(state, "早上我给我们三个人买了早饭，花了30元", "supplement"));
  assert.equal(state.records.length, 1);
  assert.deepEqual(state.records[0]?.beneficiaries, ["我", "小明", "小花"]);
});

test("analyzeBillConversationInput asks for beneficiaries when amount is present but scope is missing", async () => {
  const provider = new StubProvider(() => ({
    text: "not-json",
  }));

  const analysis = await analyzeBillConversationInput(provider, "我付了100元", {
    participants: ["我", "小明", "小花"],
    records: [],
    pendingQuestion: "记录并整理本次聚会账单",
  });

  assert.equal(analysis.records.length, 0);
  assert.equal(analysis.pendingExpenseDraft?.payer, "我");
  assert.deepEqual(analysis.pendingExpenseDraft?.missingFields, ["beneficiaries"]);
  assert.equal(analysis.clarificationQuestion, "这笔钱是给谁花的？请说明具体由哪些人分摊。");
});

test("analyzeBillConversationInput fallback parses documented time-prefixed bill phrasing", async () => {
  const provider = new StubProvider(() => ({
    text: "not-json",
  }));

  const analysis = await analyzeBillConversationInput(provider, "早上我给我们三个人买了早饭，花了30元", {
    participants: ["我", "小明", "小花"],
    records: [],
    pendingQuestion: "记录并整理本次聚会账单",
  });

  assert.equal(analysis.records.length, 1);
  assert.equal(analysis.records[0]?.payer, "我");
  assert.deepEqual(analysis.records[0]?.beneficiaries, ["我", "小明", "小花"]);
  assert.equal(analysis.records[0]?.amount, 30);
});

test("analyzeBillConversationInput asks for amount when payer and beneficiaries are known", async () => {
  const provider = new StubProvider(() => ({
    text: "not-json",
  }));

  const analysis = await analyzeBillConversationInput(provider, "小明为我们大家买了早饭", {
    participants: ["我", "小明", "小花"],
    records: [],
    pendingQuestion: "记录并整理本次聚会账单",
  });

  assert.equal(analysis.records.length, 0);
  assert.equal(analysis.pendingExpenseDraft?.payer, "小明");
  assert.deepEqual(analysis.pendingExpenseDraft?.beneficiaries, ["我", "小明", "小花"]);
  assert.deepEqual(analysis.pendingExpenseDraft?.missingFields, ["amount"]);
  assert.equal(analysis.clarificationQuestion, "这笔钱具体花了多少钱？");
});

test("bill state manager normalizes noisy model-extracted participants and payer names", async () => {
  const manager = new BillSkillStateManager(
    new StubProvider(({ messages }) => {
      const input = messages.at(-1)?.content ?? "";
      if (input.includes("昨天我和朋友们出去玩了一天")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "朋友们"],
            records: [],
            pendingExpenseDraft: null,
            settlementRequested: false,
            clarificationQuestion: "请先补充账单事实",
          }),
        };
      }

      return {
        text: JSON.stringify({
          pendingQuestion: "记录并整理本次聚会账单",
          participants: ["我", "朋友们", "小花一起吃了早饭"],
          records: [
            {
              payer: "我",
              amount: 20,
              beneficiaries: ["我", "朋友们", "小花一起吃了早饭"],
              description: "早饭",
              sourceText: "早上我和小花一起吃了早饭，我付了20元",
            },
          ],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }),
      };
    }),
  );

  let state = createEmptyBillConversationState();
  ({ state } = await manager.beginTurn(state, "昨天我和朋友们出去玩了一天，现在要算下账单。", "new_request"));
  ({ state } = await manager.beginTurn(state, "早上我和小花一起吃了早饭，我付了20元", "supplement"));

  assert.deepEqual(state.participants, ["我", "小花"]);
  assert.equal(state.records.length, 1);
  assert.deepEqual(state.records[0]?.beneficiaries, ["我", "小花"]);
});

test("settlement confirmation turn does not duplicate existing records", async () => {
  const manager = new BillSkillStateManager(
    new StubProvider(({ messages }) => {
      const input = messages.at(-1)?.content ?? "";
      if (input.includes("没有其他支付事件了")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "记录并整理本次聚会账单",
            participants: ["我", "小花", "小明"],
            records: [
              {
                payer: "我",
                amount: 20,
                beneficiaries: ["我", "小花"],
                description: "早饭",
                sourceText: "早上我和小花一起吃了早饭，我付了20元",
              },
              {
                payer: "小明",
                amount: 300,
                beneficiaries: ["我", "小花", "小明"],
                description: "午饭",
                sourceText: "中午小明加入了我们，我们一起吃了午饭，小明支付了300元",
              },
            ],
            pendingExpenseDraft: null,
            settlementRequested: true,
            clarificationQuestion: null,
          }),
        };
      }

      throw new Error(`unexpected input: ${input}`);
    }),
  );

  const existingState = {
    ...createEmptyBillConversationState(),
    participants: ["我", "小花", "小明"],
    records: [
      {
        payer: "我",
        amount: 20,
        beneficiaries: ["我", "小花"],
        description: "早饭",
        sourceText: "早上我和小花一起吃了早饭，我付了20元",
      },
      {
        payer: "小明",
        amount: 300,
        beneficiaries: ["我", "小花", "小明"],
        description: "午饭",
        sourceText: "中午小明加入了我们，我们一起吃了午饭，小明支付了300元",
      },
    ],
    awaitingSettlementConfirmation: true,
  };

  const { state } = await manager.beginTurn(existingState, "没有其他支付事件了", "supplement");
  assert.equal(state.records.length, 2);
  assert.deepEqual(state.records, existingState.records);
});
