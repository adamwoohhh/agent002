import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeConversationInput,
  ConversationStateManager,
  createEmptyConversationState,
  fallbackResolveTurnMode,
} from "../../src/application/math-agent/conversation/state-manager.js";
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

test("conversation state manager carries pending question and fact memory across supplement turns", async () => {
  const manager = new ConversationStateManager(
    new StubProvider(({ messages }) => {
      const input = messages.at(-1)?.content ?? "";

      if (input.includes("小明今天 10 岁")) {
        return {
          text: JSON.stringify({
            pendingQuestion: "小明爸爸今年多少岁",
            facts: ["小明今天 10 岁"],
          }),
        };
      }

      return {
        text: JSON.stringify({
          pendingQuestion: "小明爸爸今年多少岁",
          facts: ["小明出生时他妈妈 25 岁"],
        }),
      };
    }),
  );
  let state = createEmptyConversationState();

  state = await manager.beginTurn(state, "小明今天 10 岁，小明爸爸今年多少岁？", "new_question");
  assert.equal(state.pendingQuestion, "小明爸爸今年多少岁");
  assert.deepEqual(state.factMemory, ["小明今天 10 岁"]);

  state = manager.completeTurn(
    state,
    "小明今天 10 岁，小明爸爸今年多少岁？",
    "你还需要补充和爸爸年龄相关的信息吗？",
  );
  assert.equal(state.lastClarificationQuestion, "你还需要补充和爸爸年龄相关的信息吗？");

  state = await manager.beginTurn(state, "小明出生时他妈妈 25 岁。", "supplement");
  assert.deepEqual(state.factMemory, ["小明今天 10 岁", "小明出生时他妈妈 25 岁"]);
});

test("conversation state manager clears pending question after final answer", async () => {
  const manager = new ConversationStateManager(
    new StubProvider(() => ({
      text: JSON.stringify({
        pendingQuestion: "还剩下几个苹果",
        facts: ["冰箱里有 3 个苹果", "早上我吃了苹果"],
      }),
    })),
  );
  let state = createEmptyConversationState();

  state = await manager.beginTurn(state, "冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果？", "new_question");
  state = manager.completeTurn(state, "冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果？", "你早上吃了几个苹果？");
  state = await manager.beginTurn(state, "1个", "supplement");
  state = manager.completeTurn(state, "1个", "还剩下 2 个苹果。");

  assert.equal(state.pendingQuestion, null);
  assert.equal(state.lastClarificationQuestion, null);
});

test("analyzeConversationInput prefers llm extraction over regex", async () => {
  const provider = new StubProvider(() => ({
    text: JSON.stringify({
      pendingQuestion: "爸爸现在多少岁",
      facts: ["小明今天 10 岁", "小明出生时他妈妈 25 岁"],
    }),
  }));

  const analysis = await analyzeConversationInput(
    provider,
    "小明今天 10 岁，小明出生时他妈妈 25 岁，小明爸爸现在多少岁？",
    "new_question",
  );

  assert.equal(analysis.pendingQuestion, "爸爸现在多少岁");
  assert.deepEqual(analysis.facts, ["小明今天 10 岁", "小明出生时他妈妈 25 岁"]);
});

test("analyzeConversationInput falls back to regex when llm output is invalid", async () => {
  const provider = new StubProvider(() => ({
    text: "not-json",
  }));

  const analysis = await analyzeConversationInput(
    provider,
    "小明今天 10 岁，小明爸爸今年多少岁？",
    "new_question",
  );

  assert.equal(analysis.pendingQuestion, "小明爸爸今年多少岁");
  assert.deepEqual(analysis.facts, ["小明今天 10 岁"]);
});

test("fallbackResolveTurnMode defaults to supplement while clarification is active", () => {
  assert.equal(fallbackResolveTurnMode("1个", "你早上吃了几个苹果", "你早上吃了几个苹果？"), "supplement");
  assert.equal(fallbackResolveTurnMode("新的问题是什么？", null, null), "new_question");
});
