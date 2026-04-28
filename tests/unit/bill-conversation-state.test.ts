import test from "node:test";
import assert from "node:assert/strict";

import { BillSkillStateManager, createEmptyBillConversationState } from "../../src/application/bill-agent/conversation/state-manager.js";
import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../../src/infrastructure/llm/types.js";

class StubProvider implements MathModelProvider {
  constructor(private readonly text: string) {}

  async generate(_params: { messages: ModelMessage[]; tools?: ModelTool[] }): Promise<ModelResponse> {
    return { text: this.text };
  }
}

test("first bill turn holds participants and complete records until participants are confirmed", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: ["我", "小明", "小花"],
    records: [{
      payer: "我",
      amount: 30,
      beneficiaries: ["我", "小明", "小花"],
      description: "早饭",
      sourceText: "早上我给我们三个人买了早饭，花了30元",
    }],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);

  const result = await manager.beginTurn(
    createEmptyBillConversationState(),
    "早上我和小明、小花一起出去玩，我给我们三个人买了早饭，花了30元",
    "new_request",
  );

  assert.deepEqual(result.state.participants, []);
  assert.deepEqual(result.state.records, []);
  assert.deepEqual(result.state.participantConfirmation?.candidates, ["我", "小明", "小花"]);
  assert.equal(result.state.participantConfirmation?.heldRecords.length, 1);
});

test("later unknown participant is held for review instead of committed", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: [],
    records: [{
      payer: "李雷",
      amount: 60,
      beneficiaries: ["我", "小明", "李雷"],
      description: "奶茶",
      sourceText: "李雷买了奶茶，花了60元，我们三个人分摊",
    }],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);
  const state = {
    ...createEmptyBillConversationState(),
    participants: ["我", "小明"],
  };

  const result = await manager.beginTurn(state, "李雷买了奶茶，花了60元，我们三个人分摊", "supplement");

  assert.deepEqual(result.state.participants, ["我", "小明"]);
  assert.deepEqual(result.state.records, []);
  assert.equal(result.state.pendingParticipantReview?.name, "李雷");
  assert.equal(result.state.pendingParticipantReview?.heldRecords.length, 1);
});

test("confirming initial participants commits held first record", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: [],
    records: [],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);
  const heldRecord = {
    payer: "我",
    amount: 30,
    beneficiaries: ["我", "小明"],
    description: "早饭",
    sourceText: "我买了早饭，花了30元",
  };
  const state = {
    ...createEmptyBillConversationState(),
    participantConfirmation: {
      candidates: ["我", "小明"],
      heldRecords: [heldRecord],
      heldDraft: null,
      sourceText: heldRecord.sourceText,
    },
  };

  const result = await manager.beginTurn(state, "确认，里面的我就是我本人，也参与分摊", "supplement");

  assert.deepEqual(result.state.participants, ["我", "小明"]);
  assert.deepEqual(result.state.records, [heldRecord]);
  assert.equal(result.state.participantConfirmation, null);
});

test("confirming later unknown participant adds participant and commits held record", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: [],
    records: [],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);
  const heldRecord = {
    payer: "李雷",
    amount: 60,
    beneficiaries: ["我", "小明", "李雷"],
    description: "奶茶",
    sourceText: "李雷买了奶茶，花了60元",
  };
  const state = {
    ...createEmptyBillConversationState(),
    participants: ["我", "小明"],
    pendingParticipantReview: {
      name: "李雷",
      heldRecords: [heldRecord],
      heldDraft: null,
      sourceText: heldRecord.sourceText,
    },
  };

  const result = await manager.beginTurn(state, "确认加入李雷", "supplement");

  assert.deepEqual(result.state.participants, ["我", "小明", "李雷"]);
  assert.deepEqual(result.state.records, [heldRecord]);
  assert.equal(result.state.pendingParticipantReview, null);
});
