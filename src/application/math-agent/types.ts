import type { ConversationMessage } from "../../infrastructure/llm/types.js";
import type { MathExecutionResult, Operation } from "../../domain/math/types.js";
import type { AgentTurnMode } from "../agent/types.js";

export type MathSkillState = {
  pendingQuestion: string | null;
  factMemory: string[];
  lastClarificationQuestion: string | null;
  lastResolvedOperation: Operation | null;
  lastResolvedOperands: [number, number] | null;
  lastResult: number | null;
};

export type MathConversationContext = Partial<MathSkillState> & {
  history?: ConversationMessage[];
  turnMode?: AgentTurnMode;
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
