import * as z from "zod";

export type Operation = "add" | "subtract" | "multiply" | "divide";

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

export type MathIntent =
  | {
      kind: "clarify";
      question: string;
    }
  | {
      kind: "reject";
      reason: string;
    }
  | {
      kind: "solve";
      operation: Operation;
      operands: [number, number];
    };

export type MathExecutionResult = {
  operation: Operation;
  operands: [number, number];
  result: number;
};

export const BinaryOperationArgsSchema = z.object({
  left: z.number(),
  right: z.number(),
});
