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

const BinaryOperationArgsSchema = z.object({
  left: z.number(),
  right: z.number(),
});

const TOOL_NAME_TO_OPERATION: Record<Operation, Operation> = {
  add: "add",
  subtract: "subtract",
  multiply: "multiply",
  divide: "divide",
};

const TOOL_SYMBOL_MAP: Record<Operation, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

// 工具的入参描述
const toolParameterSchema = {
  type: "object",
  properties: {
    left: {
      type: "number",
      description: "按用户原始表达顺序提取的第一个数字，例如“10 除以 2”里的 10",
    },
    right: {
      type: "number",
      description: "按用户原始表达顺序提取的第二个数字，例如“10 除以 2”里的 2",
    },
  },
  required: ["left", "right"],
  additionalProperties: false,
} as const;

// 工具列表，让模型选择使用哪个工具来计算，并传入参数
const mathTools = [
  {
    type: "function" as const,
    name: "add",
    description: "对两个数字做加法",
    parameters: toolParameterSchema,
    strict: true,
  },
  {
    type: "function" as const,
    name: "subtract",
    description: "对两个数字做减法",
    parameters: toolParameterSchema,
    strict: true,
  },
  {
    type: "function" as const,
    name: "multiply",
    description: "对两个数字做乘法",
    parameters: toolParameterSchema,
    strict: true,
  },
  {
    type: "function" as const,
    name: "divide",
    description: "对两个数字做除法",
    parameters: toolParameterSchema,
    strict: true,
  },
];

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

function add(left: number, right: number): number {
  return left + right;
}

function subtract(left: number, right: number): number {
  return left - right;
}

function multiply(left: number, right: number): number {
  return left * right;
}

function divide(left: number, right: number): number {
  if (right === 0) {
    throw new Error("除数不能为 0");
  }

  return left / right;
}

const toolImplementations: Record<Operation, (left: number, right: number) => number> = {
  add,
  subtract,
  multiply,
  divide,
};

type MathToolDecision =
  | {
      canSolve: true;
      operation: Operation;
      operands: [number, number];
    }
  | {
      canSolve: false;
      reason: string;
    };

async function chooseMathToolWithLLM(input: string): Promise<MathToolDecision> {
  if (!openai) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI 模型。");
  }

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "你是一个数学计算助手。",
              "你只支持两个数字的一次加减乘除。",
              "当用户的问题可以通过工具完成时，必须调用且只调用一个工具。",
              "不要自己心算，不要直接输出答案。",
              "传参时必须严格保持用户表达中的数字顺序，绝对不能交换左右参数。",
              "例如“10 减 3”必须传 subtract(left=10, right=3)；“10 除以 2”必须传 divide(left=10, right=2)。",
              "如果问题不属于两个数字的一次加减乘除，就直接用中文简短说明原因。",
            ].join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: input }],
      },
    ],
    tools: mathTools,
  });

  const functionCall = response.output.find((item) => item.type === "function_call");
  if (!functionCall || !("name" in functionCall) || !("arguments" in functionCall)) {
    return {
      canSolve: false,
      reason:
        response.output_text ||
        "暂时只支持两个数字的一次加减乘除，例如：12 加 8、50 减 6、7 乘 9、20 除以 5。",
    };
  }

  const parsedArgs = BinaryOperationArgsSchema.safeParse(JSON.parse(functionCall.arguments));
  if (!parsedArgs.success) {
    return {
      canSolve: false,
      reason: "模型调用工具时传入了无效参数。",
    };
  }

  const operation = TOOL_NAME_TO_OPERATION[functionCall.name as Operation];
  if (!operation) {
    return {
      canSolve: false,
      reason: `模型选择了未知工具：${functionCall.name}`,
    };
  }

  return {
    canSolve: true,
    operation,
    operands: [parsedArgs.data.left, parsedArgs.data.right] as [number, number],
  };
}

const collectInput: GraphNode<typeof MathAgentState> = (state) => {
  return {
    normalizedInput: normalizeInput(state.userInput),
    messages: [new AIMessage(`收到问题：${state.userInput}`)],
  };
};

const parseIntent: GraphNode<typeof MathAgentState> = async (state) => {
  try {
    const toolDecision = await chooseMathToolWithLLM(state.normalizedInput);

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
