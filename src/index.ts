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
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import * as z from "zod";

// 加载环境变量
loadEnv({ path: ".env.local" });

// 初始化 OpenAI 客户端
const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;
const model = process.env.OPENAI_MODEL ?? "gpt-4.1";

const MathAgentState = new StateSchema({
  messages: MessagesValue,
  userInput: z.string(),
  normalizedInput: z.string(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]).nullable(),
  operands: z.array(z.number()),
  result: z.number().nullable(),
  finalAnswer: z.string(),
});

type Operation = "add" | "subtract" | "multiply" | "divide";

const IntentSchema = z.object({
  canSolve: z.boolean(),
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  leftOperand: z.number(),
  rightOperand: z.number(),
  reason: z.string(),
});

function normalizeInput(input: string): string {
  return input
    .trim()
    .replace(/？/g, "?")
    .replace(/，/g, ",")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/加上/g, "加")
    .replace(/减去/g, "减")
    .replace(/乘以/g, "乘")
    .replace(/除以/g, "除")
    .replace(/plus/gi, "加")
    .replace(/minus/gi, "减")
    .replace(/times/gi, "乘")
    .replace(/multiplied by/gi, "乘")
    .replace(/divided by/gi, "除");
}

/**
 * 从用户输入中提取数学计算意图。
 * @param input 用户输入的自然语言
 * @returns 包含意图的结构化结果
 */
async function detectIntentWithLLM(input: string) {
  if (!openai) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI 模型。");
  }

  const response = await openai.responses.parse({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "你是一个数学计算意图识别器。",
              "你的任务是从用户自然语言中提取一次四则运算。",
              "只处理两个数字的一次加减乘除。",
              "如果用户输入不满足要求，也必须返回完整 schema，并把 canSolve 设为 false。",
              "当 canSolve 为 false 时，operation 使用 add，leftOperand 和 rightOperand 使用 0，并在 reason 里解释原因。",
              "不要自己计算最终结果，只做意图识别。",
            ].join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ],
    text: {
      format: zodTextFormat(IntentSchema, "math_intent"),
    },
  });

  if (response.output_parsed) {
    return response.output_parsed;
  }

  throw new Error("模型没有返回可解析的结构化结果。");
}

function calculate(operation: Operation, operands: number[]): number {
  const [left, right] = operands;

  switch (operation) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      if (right === 0) {
        throw new Error("除数不能为 0");
      }
      return left / right;
  }
}

const collectInput: GraphNode<typeof MathAgentState> = (state) => {
  return {
    normalizedInput: normalizeInput(state.userInput),
    messages: [new AIMessage(`收到问题：${state.userInput}`)],
  };
};

const parseIntent: GraphNode<typeof MathAgentState> = async (state) => {
  try {
    const intent = await detectIntentWithLLM(state.normalizedInput);

    if (!intent.canSolve) {
      return {
        operation: null,
        operands: [],
        messages: [new AIMessage(`模型判断当前输入不在支持范围内：${intent.reason}`)],
        finalAnswer:
          "暂时只支持两个数字的一次加减乘除，例如：`12 加 8`、`50 减 6`、`7 乘 9`、`20 除以 5`。",
      };
    }

    return {
      operation: intent.operation,
      operands: [intent.leftOperand, intent.rightOperand],
      messages: [
        new AIMessage(
          `已通过 LLM 识别运算：${intent.operation}，操作数：${intent.leftOperand}, ${intent.rightOperand}`,
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
    const result = calculate(state.operation, state.operands);
    return {
      result,
      messages: [new AIMessage(`计算完成，结果是 ${result}`)],
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
  const symbolMap: Record<Operation, string> = {
    add: "+",
    subtract: "-",
    multiply: "*",
    divide: "/",
  };

  const finalAnswer = `${left} ${symbolMap[state.operation as Operation]} ${right} = ${state.result}`;

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

const cliInput = process.argv.slice(2).join(" ").trim();
if (!cliInput) {
  console.error('请通过命令行传入一个数学问题，例如：npm run dev -- "请帮我算一下 12 加 8"');
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
