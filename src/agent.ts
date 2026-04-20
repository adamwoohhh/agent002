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

import type { MathModelProvider } from "./llm/types.js";
import {
  normalizeInput,
  TOOL_SYMBOL_MAP,
  toolImplementations,
  type Operation,
} from "./math.js";

const MathAgentState = new StateSchema({
  messages: MessagesValue,
  userInput: z.string(),
  normalizedInput: z.string(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]).nullable(),
  operands: z.array(z.number()),
  result: z.number().nullable(),
  finalAnswer: z.string(),
});

export async function runMathAgent(input: string, provider: MathModelProvider): Promise<string> {
  const collectInput: GraphNode<typeof MathAgentState> = (state) => {
    return {
      normalizedInput: normalizeInput(state.userInput),
      messages: [new AIMessage(`收到问题：${state.userInput}`)],
    };
  };

  const parseIntent: GraphNode<typeof MathAgentState> = async (state) => {
    try {
      const toolDecision = await provider.chooseMathTool(state.normalizedInput);

      if (!toolDecision.canSolve) {
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
  };

  const runCalculation: GraphNode<typeof MathAgentState> = (state) => {
    if (!state.operation || state.operands.length < 2) {
      return {};
    }

    try {
      const [left, right] = state.operands;
      const result = toolImplementations[state.operation](left, right);
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
  };

  const formatAnswer: GraphNode<typeof MathAgentState> = (state) => {
    if (state.finalAnswer) {
      return {
        messages: [new AIMessage("结果已整理完成。")],
      };
    }

    const [left, right] = state.operands;
    const finalAnswer = `${left} ${TOOL_SYMBOL_MAP[state.operation as Operation]} ${right} = ${state.result}`;

    return {
      finalAnswer,
      messages: [new AIMessage(`最终答复：${finalAnswer}`)],
    };
  };

  const graph = new StateGraph(MathAgentState)
    .addNode("collectInput", collectInput)
    .addNode("parseIntent", parseIntent)
    .addNode("runCalculation", runCalculation)
    .addNode("formatAnswer", formatAnswer)
    .addEdge(START, "collectInput")
    .addEdge("collectInput", "parseIntent")
    .addEdge("parseIntent", "runCalculation")
    .addEdge("runCalculation", "formatAnswer")
    .addEdge("formatAnswer", END)
    .compile();

  const result = await graph.invoke({
    messages: [new HumanMessage(input)],
    userInput: input,
    normalizedInput: "",
    operation: null,
    operands: [],
    result: null,
    finalAnswer: "",
  });

  return result.finalAnswer;
}
