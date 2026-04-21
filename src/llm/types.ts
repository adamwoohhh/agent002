import type { MathToolDecision } from "../math.js";

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export function buildConversationPrompt(input: string, history: ConversationMessage[] = []): string {
  if (history.length === 0) {
    return input;
  }

  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
    .join("\n");

  return [
    "以下是之前的对话历史，请你结合上下文理解本轮问题：",
    transcript,
    "",
    `本轮用户问题：${input}`,
  ].join("\n");
}

export interface MathModelProvider {
  chooseMathTool(input: string, history?: ConversationMessage[]): Promise<MathToolDecision>;
}
