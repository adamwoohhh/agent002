import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  END,
  GraphNode,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { config as loadEnv } from "dotenv";
import * as z from "zod";

import { applyCliOverrides } from "./config.js";
import { createMathModelProvider } from "./llm/index.js";
import {
  normalizeInput,
  TOOL_SYMBOL_MAP,
  toolImplementations,
  type Operation,
} from "./math.js";

// 加载环境变量
loadEnv({ path: ".env.local" });

let cliInput = "";

try {
  const parsed = applyCliOverrides(process.argv.slice(2));
  cliInput = parsed.input;
} catch (error) {
  const message = error instanceof Error ? error.message : "CLI 参数解析失败";
  console.error(message);
  process.exit(1);
}

let mathModelProvider: ReturnType<typeof createMathModelProvider>;

try {
  mathModelProvider = createMathModelProvider();
} catch (error) {
  const message = error instanceof Error ? error.message : "模型 provider 初始化失败";
  console.error(message);
  process.exit(1);
}

const MathAgentState = new StateSchema({
  messages: MessagesValue,
  userInput: z.string(),
  normalizedInput: z.string(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]).nullable(),
  operands: z.array(z.number()),
  result: z.number().nullable(),
  finalAnswer: z.string(),
});

const collectInput: GraphNode<typeof MathAgentState> = (state) => {
  return {
    normalizedInput: normalizeInput(state.userInput),
    messages: [new AIMessage(`收到问题：${state.userInput}`)],
  };
};

const parseIntent: GraphNode<typeof MathAgentState> = async (state) => {
  try {
    const toolDecision = await mathModelProvider.chooseMathTool(state.normalizedInput);

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

if (!cliInput) {
  console.error(
    '请通过命令行传入一个数学问题，例如：npm run dev -- --provider=openai "请帮我算一下 12 加 8"',
  );
  process.exit(1);
}

const result = await graph.invoke({
  messages: [new HumanMessage(cliInput)],
  userInput: cliInput,
  normalizedInput: "",
  operation: null,
  operands: [],
  result: null,
  finalAnswer: "",
});

console.log(`\n=== 输入: ${cliInput} ===`);
console.log(result.finalAnswer);
