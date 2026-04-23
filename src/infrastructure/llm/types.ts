export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type ModelToolCall = {
  name: string;
  arguments: string;
};

export type ModelResponse = {
  text: string;
  toolCall?: ModelToolCall;
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens?: number | null;
    totalTokens: number | null;
  };
  provider?: string;
  model?: string;
  raw?: unknown;
};

export interface MathModelProvider {
  generate(params: {
    messages: ModelMessage[];
    tools?: ModelTool[];
  }): Promise<ModelResponse>;
}
