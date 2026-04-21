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
import { FornaxCallbackHandler } from "@next-ai/fornax-langchain";

import { JsonlRunLogger } from "./logging/jsonl-run-logger.js";
import { chooseMathTool, formatMathAnswer } from "./llm/math-workflow.js";
import type { ConversationMessage, MathModelProvider } from "./llm/types.js";
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
  clarificationQuestion: z.string(),
  finalAnswer: z.string(),
});

export async function runMathAgent(
  input: string,
  provider: MathModelProvider,
  history: ConversationMessage[] = [],
): Promise<string> {
  const logger = await JsonlRunLogger.create();
  const callbacks = createCallbacks();

  const collectInput: GraphNode<typeof MathAgentState> = (state) => {
    return {
      normalizedInput: normalizeInput(state.userInput),
      messages: [new AIMessage(`收到问题：${state.userInput}`)],
    };
  };

  const parseIntent: GraphNode<typeof MathAgentState> = async (state) => {
    try {
      const toolDecision = await chooseMathTool(provider, state.normalizedInput, history);

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
    if (state.finalAnswer || state.clarificationQuestion) {
      return {
        messages: [new AIMessage("结果已整理完成。")],
      };
    }

    return {};
  };

  const draftAnswer: GraphNode<typeof MathAgentState> = async (state) => {
    if (state.finalAnswer || !state.operation || state.result === null || state.operands.length < 2) {
      return {};
    }

    const [left, right] = state.operands;
    const fallbackAnswer = `${left} ${TOOL_SYMBOL_MAP[state.operation as Operation]} ${right} = ${state.result}`;

    try {
      const finalAnswer = await formatMathAnswer(provider, {
        input: state.userInput,
        history,
        operation: state.operation,
        operands: [left, right],
        result: state.result,
      });

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
  };

  const graph = new StateGraph(MathAgentState)
    .addNode("collectInput", collectInput)
    .addNode("parseIntent", parseIntent)
    .addNode("runCalculation", runCalculation)
    .addNode("formatAnswer", formatAnswer)
    .addNode("draftAnswer", draftAnswer)
    .addEdge(START, "collectInput")
    .addEdge("collectInput", "parseIntent")
    .addEdge("parseIntent", "runCalculation")
    .addEdge("runCalculation", "formatAnswer")
    .addEdge("formatAnswer", "draftAnswer")
    .addEdge("draftAnswer", END)
    .compile();

  const initialState = {
    messages: [new HumanMessage(input)],
    userInput: input,
    normalizedInput: "",
    operation: null,
    operands: [],
    result: null,
    clarificationQuestion: "",
    finalAnswer: "",
  };

  await logger.write({
    type: "run_started",
    timestamp: new Date().toISOString(),
    runId: logger.runId,
    input,
    initialState,
  });

  let finalState: typeof initialState | null = null;

  try {
    const stream = await graph.stream(initialState, {
      streamMode: ["values", "updates", "tasks", "checkpoints", "debug"],
      debug: true,
      callbacks,
    });

    for await (const chunk of stream) {
      const [mode, payload] = chunk as [string, unknown];

      await logger.write({
        type: "graph_event",
        timestamp: new Date().toISOString(),
        runId: logger.runId,
        mode,
        payload,
      });

      if (mode === "values") {
        finalState = payload as typeof initialState;
      }
    }
  } catch (error) {
    await logger.write({
      type: "run_failed",
      timestamp: new Date().toISOString(),
      runId: logger.runId,
      error,
    });
    throw error;
  }

  if (!finalState) {
    throw new Error("LangGraph 未返回最终状态，无法生成结果。");
  }

  await logger.write({
    type: "run_completed",
    timestamp: new Date().toISOString(),
    runId: logger.runId,
    finalState,
  });

  return finalState.finalAnswer;
}

export class MathChatSession {
  private readonly history: ConversationMessage[] = [];

  constructor(private readonly provider: MathModelProvider) {}

  async respond(input: string): Promise<string> {
    const finalAnswer = await runMathAgent(input, this.provider, this.history);

    this.history.push(
      {
        role: "user",
        content: input,
      },
      {
        role: "assistant",
        content: finalAnswer,
      },
    );

    return finalAnswer;
  }

  getHistory(): ConversationMessage[] {
    return [...this.history];
  }
}

function createCallbacks() {
  const ak = process.env.FORNAX_AK?.trim();
  const sk = process.env.FORNAX_SK?.trim();

  if (!ak || !sk) {
    return [];
  }

  return [
    new FornaxCallbackHandler({
      spanExporter: {
        ak,
        sk,
      },
    }),
  ];
}
