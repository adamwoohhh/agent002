import type { MathConversationContext } from "../types.js";

export const mathToolSystemPrompt = [
  "你是一个数学计算助手。",
  "你只支持两个数字的一次加减乘除。",
  "用户的输入可能带有生活情境，你需要先从情境中提取参与计算的两个数字和对应操作，再决定是否调用工具。",
  "例如“冰箱里有 3 个苹果，早上我吃了 1 个，还剩下几个苹果”应该调用 subtract(left=3, right=1)。",
  "你支持多轮对话，可以结合历史对话理解“再加 5”“用上一次结果乘 2”“继续算”等追问。",
  "如果用户引用了上一轮结果、之前提到的数字或代词，你需要优先基于对话历史补全本轮缺失的操作数。",
  "当用户的问题可以通过工具完成时，必须调用且只调用一个工具。",
  "不要自己心算，不要直接输出答案。",
  "传参时必须严格保持用户表达中的数字顺序，绝对不能交换左右参数。",
  "例如“10 减 3”必须传 subtract(left=10, right=3)；“10 除以 2”必须传 divide(left=10, right=2)。",
  "如果用户说“结果再加 5”，应该把上一轮结果作为 left，把 5 作为 right。",
  "如果信息不足，不能猜，不能调用工具，必须只输出一行：CLARIFY: <你要追问的问题>。",
  "例如“冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果”必须输出类似：CLARIFY: 你早上吃了几个苹果？",
  "如果问题不属于两个数字的一次加减乘除，不能调用工具，必须只输出一行：UNSUPPORTED: <简短原因>。",
].join(" ");

export function buildConversationPrompt(input: string, context: MathConversationContext = {}): string {
  const history = context.history ?? [];
  const pendingQuestion = context.pendingQuestion?.trim();
  const factMemory = (context.factMemory ?? []).map((fact) => fact.trim()).filter(Boolean);
  const turnMode = context.turnMode ?? "new_question";
  const lastClarificationQuestion = context.lastClarificationQuestion?.trim();

  if (!pendingQuestion && factMemory.length === 0 && !lastClarificationQuestion && history.length === 0) {
    return input;
  }

  const transcript = history
    .map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
    .join("\n");

  const sections = [
    "请优先围绕“当前待解决问题”来理解本轮输入。",
    "如果本轮输入被标记为“补充信息”，它是在补充当前待解决问题的条件，不是一个全新的问题。",
    "如果你需要继续澄清，请明确说明你当前要计算的目标是什么，以及还缺哪条关键信息。",
  ];

  if (pendingQuestion) {
    sections.push(`当前待解决问题：${pendingQuestion}`);
  }

  if (factMemory.length > 0) {
    sections.push(["已知事实：", ...factMemory.map((fact, index) => `${index + 1}. ${fact}`)].join("\n"));
  }

  if (lastClarificationQuestion) {
    sections.push(`上一轮澄清问题：${lastClarificationQuestion}`);
  }

  sections.push(`本轮输入类型：${turnMode === "supplement" ? "补充信息" : "新问题"}`);

  if (transcript) {
    sections.push(["对话历史：", transcript].join("\n"));
  }

  sections.push(`本轮用户输入：${input}`);

  return sections.join("\n\n");
}

export function buildTurnModePrompt(input: string, context: MathConversationContext): string {
  const history = context.history ?? [];
  const pendingQuestion = context.pendingQuestion?.trim();
  const factMemory = (context.factMemory ?? []).map((fact) => fact.trim()).filter(Boolean);
  const lastClarificationQuestion = context.lastClarificationQuestion?.trim();

  const sections = [];

  if (pendingQuestion) {
    sections.push(`当前待解决问题：${pendingQuestion}`);
  }

  if (factMemory.length > 0) {
    sections.push(["已知事实：", ...factMemory.map((fact, index) => `${index + 1}. ${fact}`)].join("\n"));
  }

  if (lastClarificationQuestion) {
    sections.push(`上一轮澄清问题：${lastClarificationQuestion}`);
  }

  if (history.length > 0) {
    sections.push(
      [
        "对话历史：",
        ...history.map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`),
      ].join("\n"),
    );
  }

  sections.push(`本轮用户输入：${input}`);
  return sections.join("\n\n");
}

export function buildFormatAnswerSystemPrompt(): string {
  return [
    "你是一个数学结果表达助手。",
    "请基于用户问题和计算结果，用中文给出一句简洁自然的回答。",
    "如果用户提供了生活情境，要沿用原来的情境名词作答，例如“还剩下 2 个苹果”。",
    "如果用户只是直接问算式，可以直接回答公式和结果，例如“12 + 8 = 20”。",
    "不要编造新信息，不要输出多句话。",
  ].join("\n");
}

export function buildFormatAnswerUserPrompt(params: {
  input: string;
  context?: MathConversationContext;
  operation: string;
  operands: [number, number];
  result: number;
}): string {
  return [
    `用户问题：${buildConversationPrompt(params.input, params.context ?? {})}`,
    `计算操作：${params.operation}`,
    `计算参数：${params.operands[0]}, ${params.operands[1]}`,
    `计算结果：${params.result}`,
  ].join("\n");
}
