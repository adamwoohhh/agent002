import type { ConversationMessage } from "../../infrastructure/llm/types.js";
import type { MathExecutionResult, Operation } from "../../domain/math/types.js";

export type TurnMode = "new_question" | "supplement";

export type MathConversationContext = {
  history?: ConversationMessage[];
  pendingQuestion?: string | null;
  factMemory?: string[];
  turnMode?: TurnMode;
  lastClarificationQuestion?: string | null;
};

export type ConversationState = {
  history: ConversationMessage[];
  pendingQuestion: string | null;
  factMemory: string[];
  lastClarificationQuestion: string | null;
};

export type MathAgentState = {
  messages: unknown[];
  userInput: string;
  normalizedInput: string;
  operation: Operation | null;
  operands: number[];
  result: number | null;
  clarificationQuestion: string;
  finalAnswer: string;
};

export type MathAgentResult =
  | {
      kind: "clarify";
      answer: string;
    }
  | {
      kind: "reject";
      answer: string;
    }
  | {
      kind: "solve";
      answer: string;
      execution: MathExecutionResult;
    };
