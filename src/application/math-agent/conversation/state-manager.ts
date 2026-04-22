import type { ConversationMessage } from "../../../infrastructure/llm/types.js";
import type { ConversationState } from "../types.js";

export function createEmptyConversationState(): ConversationState {
  return {
    history: [],
    pendingQuestion: null,
    factMemory: [],
    lastClarificationQuestion: null,
  };
}

export class ConversationStateManager {
  createInitialState(): ConversationState {
    return createEmptyConversationState();
  }

  beginTurn(state: ConversationState, input: string, turnMode: "new_question" | "supplement"): ConversationState {
    const normalizedFacts = extractFactsFromInput(input);

    if (turnMode === "new_question") {
      return {
        ...state,
        pendingQuestion: extractPendingQuestion(input),
        factMemory: normalizedFacts,
      };
    }

    return {
      ...state,
      factMemory: mergeFacts(state.factMemory, normalizedFacts),
    };
  }

  completeTurn(state: ConversationState, input: string, answer: string): ConversationState {
    const history = appendHistory(state.history, input, answer);

    if (answer === state.lastClarificationQuestion) {
      return {
        ...state,
        history,
      };
    }

    if (looksLikeClarification(answer)) {
      return {
        ...state,
        history,
        lastClarificationQuestion: answer,
      };
    }

    return {
      ...state,
      history,
      lastClarificationQuestion: null,
      pendingQuestion: null,
    };
  }
}

export function looksLikeClarification(answer: string): boolean {
  return (
    /[？?]$/.test(answer.trim()) ||
    /(请.*补充|请.*提供|还缺|还需要|缺少|缺失)/.test(answer)
  );
}

export function looksLikeNewQuestion(input: string): boolean {
  const trimmed = input.trim();
  if (/[？?]$/.test(trimmed)) {
    return true;
  }

  return /(多少|几岁|几|什么|为何|为什么|怎么|如何|谁|哪一个)/.test(trimmed);
}

export function fallbackResolveTurnMode(
  input: string,
  pendingQuestion: string | null,
  lastClarificationQuestion: string | null,
): "new_question" | "supplement" {
  if (!pendingQuestion) {
    return "new_question";
  }

  if (lastClarificationQuestion) {
    return "supplement";
  }

  return looksLikeNewQuestion(input) ? "new_question" : "supplement";
}

export function extractPendingQuestion(input: string): string {
  const segments = splitIntoSegments(input);
  const explicitQuestion = segments.find((segment) =>
    /[？?]|(多少|几岁|几|什么|为何|为什么|怎么|如何|谁|哪一个)/.test(segment),
  );
  return explicitQuestion ?? input.trim();
}

export function extractFactsFromInput(input: string): string[] {
  return splitIntoSegments(input).filter((segment) => {
    return !/[？?]/.test(segment) && /(\d|[零一二三四五六七八九十百千万两])/.test(segment);
  });
}

export function splitIntoSegments(input: string): string[] {
  return input
    .split(/[。！？?!；;，,]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function mergeFacts(existingFacts: string[], newFacts: string[]): string[] {
  const merged = [...existingFacts];
  for (const fact of newFacts) {
    if (!merged.includes(fact)) {
      merged.push(fact);
    }
  }

  return merged;
}

function appendHistory(history: ConversationMessage[], input: string, answer: string): ConversationMessage[] {
  return [
    ...history,
    { role: "user", content: input },
    { role: "assistant", content: answer },
  ];
}
