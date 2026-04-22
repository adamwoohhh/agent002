import type { ConversationMessage, MathModelProvider } from "../../../infrastructure/llm/types.js";
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
  constructor(private readonly provider?: MathModelProvider) {}

  createInitialState(): ConversationState {
    return createEmptyConversationState();
  }

  async beginTurn(
    state: ConversationState,
    input: string,
    turnMode: "new_question" | "supplement",
  ): Promise<ConversationState> {
    const analysis = await analyzeConversationInput(this.provider, input, turnMode);

    if (turnMode === "new_question") {
      return {
        ...state,
        pendingQuestion: analysis.pendingQuestion,
        factMemory: analysis.facts,
      };
    }

    return {
      ...state,
      factMemory: mergeFacts(state.factMemory, analysis.facts),
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

export async function analyzeConversationInput(
  provider: MathModelProvider | undefined,
  input: string,
  turnMode: "new_question" | "supplement",
): Promise<{ pendingQuestion: string; facts: string[] }> {
  const fallback = {
    pendingQuestion: extractPendingQuestion(input),
    facts: extractFactsFromInput(input),
  };

  if (!provider) {
    return fallback;
  }

  try {
    const response = await provider.generate({
      messages: [
        {
          role: "system",
          content: [
            "你是一个对话状态分析助手。",
            "请从用户输入中提取两个字段，并只输出 JSON，不要输出任何额外解释。",
            'JSON 格式必须是：{"pendingQuestion":"...","facts":["..."]}。',
            "pendingQuestion 表示当前待解决问题的核心目标，用一句简短中文表述。",
            "如果本轮输入类型是新问题，请抽取该问题真正要计算或回答的目标。",
            "如果本轮输入类型是补充信息，pendingQuestion 可以保留用户输入中的目标句；如果无法判断，返回原输入中最核心的问题表达。",
            "facts 需要列出输入中适合进入记忆的关键事实，按自然顺序拆成短句。",
            "不要编造输入中不存在的信息。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `本轮输入类型：${turnMode === "new_question" ? "新问题" : "补充信息"}\n本轮用户输入：${input}`,
        },
      ],
    });

    const parsed = parseInputAnalysis(response.text);
    if (!parsed) {
      return fallback;
    }

    return {
      pendingQuestion: parsed.pendingQuestion || fallback.pendingQuestion,
      facts: parsed.facts.length > 0 ? parsed.facts : fallback.facts,
    };
  } catch {
    return fallback;
  }
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

function parseInputAnalysis(text: string): { pendingQuestion: string; facts: string[] } | null {
  const trimmed = text.trim();
  const jsonText = extractJsonObject(trimmed);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as {
      pendingQuestion?: unknown;
      facts?: unknown;
    };

    const pendingQuestion =
      typeof parsed.pendingQuestion === "string" ? parsed.pendingQuestion.trim() : "";
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts.filter((fact): fact is string => typeof fact === "string").map((fact) => fact.trim()).filter(Boolean)
      : [];

    return {
      pendingQuestion,
      facts,
    };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function appendHistory(history: ConversationMessage[], input: string, answer: string): ConversationMessage[] {
  return [
    ...history,
    { role: "user", content: input },
    { role: "assistant", content: answer },
  ];
}
