import type { BillConversationContext } from "../types.js";

export function buildBillAnalysisSystemPrompt(): string {
  return [
    "你是账单对话解析助手，只负责从用户输入和已有上下文中提取结构化记账信息。",
    "你不能计算任何最终金额，不能推导谁该转给谁多少钱。",
    "请只输出 JSON，不要输出任何额外解释。",
    'JSON 格式必须是：{"pendingQuestion":"","participants":[],"records":[],"pendingExpenseDraft":null,"settlementRequested":false,"clarificationQuestion":null}',
    "records 中每条记录必须包含 payer、amount、beneficiaries、description、sourceText。",
    "完整支付事件必须以 JSON records 返回，不能用自然语言描述替代 records。",
    "pendingExpenseDraft 用于当前轮提到了一笔消费，但缺少 payer、amount 或 beneficiaries 中的至少一项；missingFields 只能包含这三个字段名。",
    "如果当前轮没有不完整账单，pendingExpenseDraft 返回 null。",
    "只有在用户明确表示没有其他支付事件了、确认开始结算，或明确要求现在就结算时，settlementRequested 才返回 true，否则 false。",
    "clarificationQuestion 只有在当前轮明确暴露缺失字段时才填写具体追问，否则返回 null。",
    "对“我们/大家/三个人”等群体指代，优先映射到上下文里已有的 participants；如果上下文不足，不要猜。",
    "不要把未确认的新名字默认加入参与人；如果名字不在上下文参与人中，也仍要在 records 或 pendingExpenseDraft 中保留原始名字，交给状态机确认。",
    "如果上下文说明参与人尚未确认，只提取候选 participants 和 records，不要声明已经记录完成。",
    "如果当前轮是在回答上一轮补充问题，应结合已有 pendingExpenseDraft 补全成完整 record；若仍不完整，继续输出 pendingExpenseDraft。",
    "如果本轮刚补充完整一笔支付事件，但用户没有确认“没有更多支付事件”，settlementRequested 必须保持 false。",
  ].join("\n");
}

export function buildBillAnalysisUserPrompt(input: string, context: BillConversationContext = {}): string {
  const sections: string[] = [];

  if (context.pendingQuestion) {
    sections.push(`当前待处理问题：${context.pendingQuestion}`);
  }

  if ((context.participants ?? []).length > 0) {
    sections.push(`当前参与人：${context.participants?.join("、")}`);
  }

  if ((context.records ?? []).length > 0) {
    sections.push(
      [
        "已记录账单：",
        ...(context.records ?? []).map(
          (record, index) =>
            `${index + 1}. payer=${record.payer}; amount=${record.amount}; beneficiaries=${record.beneficiaries.join("|")}; description=${record.description}`,
        ),
      ].join("\n"),
    );
  }

  if (context.participantConfirmation) {
    sections.push(`待确认参与人：${context.participantConfirmation.candidates.join("、")}`);
  }

  if (context.pendingParticipantReview) {
    sections.push(`待确认新参与人：${context.pendingParticipantReview.name}`);
  }

  if (context.pendingSettlementConfirmation) {
    sections.push("当前状态：正在等待用户确认结构化账单数据后再结算。");
  }

  if (context.pendingExpenseDraft) {
    sections.push(
      [
        "待补充账单：",
        `payer=${context.pendingExpenseDraft.payer ?? "null"}`,
        `amount=${context.pendingExpenseDraft.amount ?? "null"}`,
        `beneficiaries=${
          context.pendingExpenseDraft.beneficiaries.length > 0 ? context.pendingExpenseDraft.beneficiaries.join("|") : "null"
        }`,
        `missingFields=${context.pendingExpenseDraft.missingFields.join("|")}`,
        `description=${context.pendingExpenseDraft.description}`,
      ].join("\n"),
    );
  }

  if (context.awaitingSettlementConfirmation) {
    sections.push("当前状态：上一轮已经记下完整支付事件，正在确认是否还有其他支付事件。");
  }

  if (context.lastClarificationQuestion) {
    sections.push(`上一轮追问：${context.lastClarificationQuestion}`);
  }

  if ((context.history ?? []).length > 0) {
    sections.push(
      [
        "对话历史：",
        ...(context.history ?? []).map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`),
      ].join("\n"),
    );
  }

  sections.push(`本轮输入类型：${context.turnMode === "supplement" ? "补充信息" : "新请求"}`);
  sections.push(`本轮用户输入：${input}`);

  return sections.join("\n\n");
}
