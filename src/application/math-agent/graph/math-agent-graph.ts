import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  END,
  GraphNode,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import * as z from "zod";

import { mathOperations, normalizeMathInput } from "../../../domain/math/operations.js";
import { createEventId } from "../../../infrastructure/observability/event-tree.js";
import type { RunLogger } from "../../../infrastructure/observability/run-logger.js";
import { createObservabilityCallbacks } from "../../../infrastructure/observability/fornax.js";
import type { AppConfig } from "../../../infrastructure/config/app-config.js";
import { MathAnswerRenderer } from "../ai/answer-renderer.js";
import { MathDecisionService } from "../ai/decision-service.js";
import type { MathConversationContext } from "../types.js";

export const MathAgentStateSchema = new StateSchema({
  messages: MessagesValue,
  userInput: z.string(),
  normalizedInput: z.string(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]).nullable(),
  operands: z.array(z.number()),
  result: z.number().nullable(),
  clarificationQuestion: z.string(),
  finalAnswer: z.string(),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    }),
  ),
  pendingQuestion: z.string().nullable(),
  factMemory: z.array(z.string()),
  turnMode: z.enum(["new_question", "supplement"]).nullable(),
  lastClarificationQuestion: z.string().nullable(),
  graphParentEventId: z.string().nullable(),
});

export type CompiledMathGraphDeps = {
  config: AppConfig;
  decisionService: MathDecisionService;
  answerRenderer: MathAnswerRenderer;
  logger?: RunLogger;
};

export function buildMathAgentGraph(deps: CompiledMathGraphDeps) {
  const collectInput: GraphNode<typeof MathAgentStateSchema> = createLoggedNode(
    "normalizeInput",
    deps.logger,
    (state) => {
      return {
        normalizedInput: normalizeMathInput(state.userInput),
        messages: [new AIMessage(`收到问题：${state.userInput}`)],
      };
    },
  );

  const decideIntent: GraphNode<typeof MathAgentStateSchema> = createLoggedNode(
    "decideIntent",
    deps.logger,
    async (state, eventId) => {
      try {
        const toolDecision = await deps.decisionService.chooseMathTool(
          state.normalizedInput,
          stateToContext(state),
          eventId,
        );

        if (toolDecision.kind === "clarify") {
          return {
            operation: null,
            operands: [],
            clarificationQuestion: toolDecision.question,
            messages: [new AIMessage(`模型要求补充信息：${toolDecision.question}`)],
            finalAnswer: toolDecision.question,
          };
        }

        if (toolDecision.kind === "reject") {
          return {
            operation: null,
            operands: [],
            messages: [new AIMessage(`模型未调用数学工具：${toolDecision.reason}`)],
            finalAnswer:
              "暂时只支持两个数字的一次加减乘除，例如：`12 加 8`、`50 减 6`、`7 乘 9`、`20 除以 5`。",
          };
        }

        return {
          operation: toolDecision.operation,
          operands: toolDecision.operands,
          messages: [
            new AIMessage(
              `LLM 已选择工具：${toolDecision.operation}，参数：${toolDecision.operands[0]}, ${toolDecision.operands[1]}`,
            ),
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "意图识别失败";
        return {
          operation: null,
          operands: [],
          messages: [new AIMessage(`LLM 意图识别失败：${message}`)],
          finalAnswer: message,
        };
      }
    },
  );

  const executeOperation: GraphNode<typeof MathAgentStateSchema> = createLoggedNode(
    "executeOperation",
    deps.logger,
    (state) => {
      if (!state.operation || state.operands.length < 2) {
        return {};
      }

      try {
        const [left, right] = state.operands;
        const result = mathOperations[state.operation](left, right);
        return {
          result,
          messages: [new AIMessage(`工具 ${state.operation} 执行完成，结果是 ${result}`)],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "计算失败";
        return {
          finalAnswer: message,
          messages: [new AIMessage(message)],
        };
      }
    },
  );

  const renderAnswer: GraphNode<typeof MathAgentStateSchema> = createLoggedNode(
    "renderAnswer",
    deps.logger,
    async (state, eventId) => {
      if (state.finalAnswer || state.clarificationQuestion) {
        return {
          messages: [new AIMessage("结果已整理完成。")],
        };
      }

      if (!state.operation || state.result === null || state.operands.length < 2) {
        return {};
      }

      const [left, right] = state.operands as [number, number];
      const fallbackAnswer = deps.answerRenderer.buildFallbackAnswer(state.operation, [left, right], state.result);

      try {
        const finalAnswer = await deps.answerRenderer.formatMathAnswer({
          input: state.userInput,
          context: stateToContext(state),
          operation: state.operation,
          operands: [left, right],
          result: state.result,
        }, eventId);

        return {
          finalAnswer: finalAnswer.trim() || fallbackAnswer,
          messages: [new AIMessage(`最终答复：${finalAnswer.trim() || fallbackAnswer}`)],
        };
      } catch {
        return {
          finalAnswer: fallbackAnswer,
          messages: [new AIMessage(`最终答复：${fallbackAnswer}`)],
        };
      }
    },
  );

  return new StateGraph(MathAgentStateSchema)
    .addNode("normalizeInput", collectInput)
    .addNode("decideIntent", decideIntent)
    .addNode("executeOperation", executeOperation)
    .addNode("renderAnswer", renderAnswer)
    .addEdge(START, "normalizeInput")
    .addEdge("normalizeInput", "decideIntent")
    .addEdge("decideIntent", "executeOperation")
    .addEdge("executeOperation", "renderAnswer")
    .addEdge("renderAnswer", END)
    .compile();
}

export async function executeMathGraph(params: {
  config: AppConfig;
  logger: RunLogger;
  decisionService: MathDecisionService;
  answerRenderer: MathAnswerRenderer;
  input: string;
  context?: MathConversationContext;
  parentEventId?: string;
}): Promise<{ finalAnswer: string; finalState: MathGraphFinalState }> {
  const graph = buildMathAgentGraph({
    config: params.config,
    decisionService: params.decisionService,
    answerRenderer: params.answerRenderer,
    logger: params.logger,
  });

  const initialState = {
    messages: [new HumanMessage(params.input)],
    userInput: params.input,
    normalizedInput: "",
    operation: null,
    operands: [],
    result: null,
    clarificationQuestion: "",
    finalAnswer: "",
    history: params.context?.history ?? [],
    pendingQuestion: params.context?.pendingQuestion ?? null,
    factMemory: params.context?.factMemory ?? [],
    turnMode: params.context?.turnMode ?? null,
    lastClarificationQuestion: params.context?.lastClarificationQuestion ?? null,
    graphParentEventId: params.parentEventId ?? null,
  };

  try {
    const finalState = (await graph.invoke(initialState, {
      callbacks: createObservabilityCallbacks(params.config),
    })) as MathGraphFinalState;

    return {
      finalAnswer: finalState.finalAnswer,
      finalState,
    };
  } catch (error) {
    throw error;
  }

  throw new Error("LangGraph 未返回最终状态，无法生成结果。");
}

export type MathGraphFinalState = {
  messages: unknown[];
  userInput: string;
  normalizedInput: string;
  operation: "add" | "subtract" | "multiply" | "divide" | null;
  operands: number[];
  result: number | null;
  clarificationQuestion: string;
  finalAnswer: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pendingQuestion: string | null;
  factMemory: string[];
  turnMode: "new_question" | "supplement" | null;
  lastClarificationQuestion: string | null;
  graphParentEventId: string | null;
};

function stateToContext(state: MathGraphFinalState): MathConversationContext {
  return {
    history: state.history,
    pendingQuestion: state.pendingQuestion,
    factMemory: state.factMemory,
    turnMode: state.turnMode ?? undefined,
    lastClarificationQuestion: state.lastClarificationQuestion,
  };
}

function createLoggedNode(
  nodeName: string,
  logger: RunLogger | undefined,
  node: (
    state: Parameters<GraphNode<typeof MathAgentStateSchema>>[0],
    eventId: string,
  ) => ReturnType<GraphNode<typeof MathAgentStateSchema>>,
): GraphNode<typeof MathAgentStateSchema> {
  return async (state) => {
    const eventId = createEventId();
    const input = summarizeGraphState(state as MathGraphFinalState);
    const output = await node(state, eventId);

    await logger?.write({
      type: "graph_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId,
      parentEventId: (state as MathGraphFinalState).graphParentEventId,
      event: "node_execution",
      node: nodeName,
      input,
      output: summarizeNodeUpdate(output),
    });

    return output;
  };
}

function summarizeGraphState(state: MathGraphFinalState) {
  return {
    userInput: state.userInput,
    normalizedInput: state.normalizedInput,
    operation: state.operation,
    operands: state.operands,
    result: state.result,
    clarificationQuestion: state.clarificationQuestion,
    finalAnswer: state.finalAnswer,
    pendingQuestion: state.pendingQuestion,
    factMemory: state.factMemory,
    turnMode: state.turnMode,
    lastClarificationQuestion: state.lastClarificationQuestion,
    historyLength: state.history.length,
  };
}

function summarizeNodeUpdate(update: unknown) {
  if (!update || typeof update !== "object") {
    return update;
  }

  const partial = update as Record<string, unknown>;
  return {
    normalizedInput: partial.normalizedInput,
    operation: partial.operation,
    operands: partial.operands,
    result: partial.result,
    clarificationQuestion: partial.clarificationQuestion,
    finalAnswer: partial.finalAnswer,
    pendingQuestion: partial.pendingQuestion,
    factMemory: partial.factMemory,
    turnMode: partial.turnMode,
    lastClarificationQuestion: partial.lastClarificationQuestion,
    messagesCount: Array.isArray(partial.messages) ? partial.messages.length : undefined,
  };
}
