import * as z from "zod";

export type Operation = "add" | "subtract" | "multiply" | "divide";

export const BinaryOperationArgsSchema = z.object({
  left: z.number(),
  right: z.number(),
});

export const TOOL_NAME_TO_OPERATION: Record<Operation, Operation> = {
  add: "add",
  subtract: "subtract",
  multiply: "multiply",
  divide: "divide",
};

export const TOOL_SYMBOL_MAP: Record<Operation, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

export const toolParameterSchema = {
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

export function createMathTools() {
  return [
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
}

export type MathToolDecision =
  | {
      kind: "solve";
      operation: Operation;
      operands: [number, number];
    }
  | {
      kind: "clarify";
      question: string;
    }
  | {
      kind: "reject";
      reason: string;
    };

export const mathToolSystemPrompt = [
  "你是一个数学计算助手。",
  "你只支持两个数字的一次加减乘除。",
  "用户的输入可能带有生活情境，你需要先从情境中提取参与计算的两个数字和对应操作，再决定是否调用工具。",
  "例如“冰箱里有 3 个苹果，早上我吃了 1 个，还剩下几个苹果”应该调用 subtract(left=3, right=1)。",
  "你支持多轮对话，可以结合历史对话理解“再加 5”“用上一次结果乘 2”“继续算”等追问。",
  "如果用户引用了上一轮结果、之前提到的数字或代词，你需要优先基于对话历史补全本轮缺失的操作数。",
  "当用户的问题可以通过工具完成时，必须调用且只调用一个工具。",
  "不要自己心算，不要直接输出答案。",
  "传参时必须严格保持用户表达中的数字顺序，绝对不能交换左右参数。",
  "例如“10 减 3”必须传 subtract(left=10, right=3)；“10 除以 2”必须传 divide(left=10, right=2)。",
  "如果用户说“结果再加 5”，应该把上一轮结果作为 left，把 5 作为 right。",
  "如果信息不足，不能猜，不能调用工具，必须只输出一行：CLARIFY: <你要追问的问题>。",
  "例如“冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果”必须输出类似：CLARIFY: 你早上吃了几个苹果？",
  "如果问题不属于两个数字的一次加减乘除，不能调用工具，必须只输出一行：UNSUPPORTED: <简短原因>。",
].join(" ");

export function normalizeInput(input: string): string {
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

export function add(left: number, right: number): number {
  return left + right;
}

export function subtract(left: number, right: number): number {
  return left - right;
}

export function multiply(left: number, right: number): number {
  return left * right;
}

export function divide(left: number, right: number): number {
  if (right === 0) {
    throw new Error("除数不能为 0");
  }

  return left / right;
}

export const toolImplementations: Record<Operation, (left: number, right: number) => number> = {
  add,
  subtract,
  multiply,
  divide,
};
