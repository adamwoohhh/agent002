import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { END, GraphNode, MessagesValue, START, StateGraph, StateSchema } from "@langchain/langgraph";
import * as z from "zod";

import type { AppConfig } from "../../../infrastructure/config/app-config.js";
import type { TelemetryWriter } from "../../../infrastructure/observability/telemetry-writer.js";
import { createEventId } from "../../../infrastructure/observability/event-tree.js";
import { computeBillSettlement, formatBillSettlement } from "../../../domain/bill/settlement.js";
import type { BillConversationContext } from "../types.js";
import type { BillConversationInputAnalysis } from "../conversation/state-manager.js";

export const BillAgentStateSchema = new StateSchema({
  messages: MessagesValue,
  userInput: z.string(),
  analysis: z.any(),
  finalAnswer: z.string(),
  clarificationQuestion: z.string().nullable(),
  settlementText: z.string().nullable(),
});

export function buildBillAgentGraph(deps: {
  config: AppConfig;
  logger?: TelemetryWriter;
}) {
  const analyzeNode: GraphNode<typeof BillAgentStateSchema> = createLoggedNode("analyzeBill", deps.logger, (state) => ({
    messages: [new AIMessage(`收到账单输入：${state.userInput}`)],
  }));

  const settleNode: GraphNode<typeof BillAgentStateSchema> = createLoggedNode("settleBill", deps.logger, (state) => {
    const analysis = state.analysis as BillConversationInputAnalysis;
    if (!analysis?.settlementRequested || analysis.clarificationQuestion) {
      return {};
    }

    const summary = computeBillSettlement(analysis.records, analysis.participants);
    return {
      settlementText: formatBillSettlement(summary),
      messages: [new AIMessage("本地结算完成。")],
    };
  });

  const renderNode: GraphNode<typeof BillAgentStateSchema> = createLoggedNode("renderBill", deps.logger, (state) => {
    if (state.clarificationQuestion) {
      return {
        finalAnswer: state.clarificationQuestion,
      };
    }

    return {
      finalAnswer: state.settlementText ?? state.finalAnswer,
    };
  });

  return new StateGraph(BillAgentStateSchema)
    .addNode("analyzeBill", analyzeNode)
    .addNode("settleBill", settleNode)
    .addNode("renderBill", renderNode)
    .addEdge(START, "analyzeBill")
    .addEdge("analyzeBill", "settleBill")
    .addEdge("settleBill", "renderBill")
    .addEdge("renderBill", END)
    .compile();
}

export async function executeBillGraph(params: {
  config: AppConfig;
  logger: TelemetryWriter;
  input: string;
  analysis: BillConversationInputAnalysis;
  context?: BillConversationContext;
}): Promise<string> {
  const graph = buildBillAgentGraph({
    config: params.config,
    logger: params.logger,
  });

  const result = await graph.invoke({
    messages: [new HumanMessage(params.input)],
    userInput: params.input,
    analysis: params.analysis,
    finalAnswer: "",
    clarificationQuestion: params.analysis.clarificationQuestion,
    settlementText: null,
  });

  return (result as { finalAnswer: string }).finalAnswer;
}

function createLoggedNode(
  nodeName: string,
  logger: TelemetryWriter | undefined,
  node: (
    state: Parameters<GraphNode<typeof BillAgentStateSchema>>[0],
    eventId: string,
  ) => ReturnType<GraphNode<typeof BillAgentStateSchema>>,
): GraphNode<typeof BillAgentStateSchema> {
  return async (state) => {
    const eventId = createEventId();
    const result = await node(state, eventId);
    await logger?.graphEvent({
      type: "graph_event",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      eventId,
      event: "node_execution",
      node: nodeName,
      input: {
        userInput: state.userInput,
      },
      output: result,
    });
    return result;
  };
}
