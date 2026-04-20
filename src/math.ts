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
      canSolve: true;
      operation: Operation;
      operands: [number, number];
    }
  | {
      canSolve: false;
      reason: string;
    };

export const mathToolSystemPrompt = [
  "你是一个数学计算助手。",
  "你只支持两个数字的一次加减乘除。",
  "当用户的问题可以通过工具完成时，必须调用且只调用一个工具。",
  "不要自己心算，不要直接输出答案。",
  "传参时必须严格保持用户表达中的数字顺序，绝对不能交换左右参数。",
  "例如“10 减 3”必须传 subtract(left=10, right=3)；“10 除以 2”必须传 divide(left=10, right=2)。",
  "如果问题不属于两个数字的一次加减乘除，就直接用中文简短说明原因。",
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
