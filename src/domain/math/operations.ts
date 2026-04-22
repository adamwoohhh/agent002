import type { Operation } from "./types.js";

export class DivideByZeroError extends Error {
  constructor() {
    super("除数不能为 0");
    this.name = "DivideByZeroError";
  }
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
    throw new DivideByZeroError();
  }

  return left / right;
}

export const operationSymbolMap: Record<Operation, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

export const mathOperations: Record<Operation, (left: number, right: number) => number> = {
  add,
  subtract,
  multiply,
  divide,
};

export function normalizeMathInput(input: string): string {
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
