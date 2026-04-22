import type { Operation } from "../../../domain/math/types.js";

export const TOOL_NAME_TO_OPERATION: Record<Operation, Operation> = {
  add: "add",
  subtract: "subtract",
  multiply: "multiply",
  divide: "divide",
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
