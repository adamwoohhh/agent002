import test from "node:test";
import assert from "node:assert/strict";

import { buildMathAgentGraph, executeMathGraph } from "../../src/application/math-agent/graph/math-agent-graph.js";
import { MathDecisionService } from "../../src/application/math-agent/ai/decision-service.js";
import { MathAnswerRenderer } from "../../src/application/math-agent/ai/answer-renderer.js";
import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../../src/infrastructure/llm/types.js";
import { resolveAppConfig } from "../../src/infrastructure/config/app-config.js";

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

test("math agent graph exposes the normalized graph nodes for base flow", () => {
  const provider = new StubProvider(() => ({ text: "UNSUPPORTED: nope" }));
  const graph = buildMathAgentGraph({
    config: resolveAppConfig(),
    decisionService: new MathDecisionService(provider),
    answerRenderer: new MathAnswerRenderer(provider),
  });

  assert.ok(graph);
});

test("executeMathGraph preserves explicit conversation context in final state", async () => {
  const provider = new StubProvider(({ tools, messages }) => {
    if (tools) {
      assert.match(messages.at(-1)?.content ?? "", /当前待解决问题：小明爸爸今年多少岁/);
      return {
        text: "",
        toolCall: {
          name: "add",
          arguments: JSON.stringify({ left: 28, right: 7 }),
        },
      };
    }

    return {
      text: "小明爸爸今年 35 岁。",
    };
  });

  const logger = {
    runId: "test-run",
    async runStarted() {},
    async runCompleted() {},
    async runFailed() {},
    async sessionEvent() {},
    async graphEvent() {},
    async modelCall() {},
    async policyRejected() {},
    async runtimeTaskCompleted() {},
  };

  const result = await executeMathGraph({
    config: resolveAppConfig(),
    logger,
    decisionService: new MathDecisionService(provider),
    answerRenderer: new MathAnswerRenderer(provider),
    input: "小明出生三年后小明妹妹小美出生了，小美的爸爸当时是 28 岁。",
    context: {
      history: [
        { role: "user", content: "小明今天 10 岁，小明爸爸今年多少岁？" },
        { role: "assistant", content: "请继续补充和爸爸年龄相关的信息。" },
      ],
      pendingQuestion: "小明爸爸今年多少岁",
      factMemory: ["小明今天 10 岁", "小明出生时他妈妈 25 岁"],
      turnMode: "supplement",
      lastClarificationQuestion: "请继续补充和爸爸年龄相关的信息。",
    },
  });

  assert.equal(result.finalAnswer, "小明爸爸今年 35 岁。");
  assert.equal(result.finalState.turnMode, "supplement");
  assert.deepEqual(result.finalState.factMemory, ["小明今天 10 岁", "小明出生时他妈妈 25 岁"]);
});
