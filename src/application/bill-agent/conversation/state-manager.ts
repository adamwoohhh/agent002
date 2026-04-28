import type { MathModelProvider } from "../../../infrastructure/llm/types.js";
import type { TelemetryWriter } from "../../../infrastructure/observability/telemetry-writer.js";
import { generateWithLogging } from "../../../infrastructure/observability/model-call-logger.js";
import type { AgentTurnMode } from "../../agent/types.js";
import {
  BillFactRecordSchema,
  BillInputAnalysisSchema,
  type BillFactRecord,
  type BillInputAnalysis,
} from "../../../domain/bill/types.js";
import type { BillConversationContext, BillSkillState } from "../types.js";
import { buildBillAnalysisSystemPrompt, buildBillAnalysisUserPrompt } from "../prompts/bill-prompts.js";

export type BillConversationInputAnalysis = BillInputAnalysis & {
  source: "llm" | "fallback";
};

export function createEmptyBillConversationState(): BillSkillState {
  return {
    pendingQuestion: null,
    participants: [],
    records: [],
    pendingExpenseDraft: null,
    awaitingSettlementConfirmation: false,
    lastClarificationQuestion: null,
    lastSettlementSummary: null,
  };
}

export class BillSkillStateManager {
  constructor(
    private readonly provider?: MathModelProvider,
    private readonly logger?: TelemetryWriter,
  ) {}

  async beginTurn(
    state: BillSkillState,
    input: string,
    turnMode: AgentTurnMode,
    history: BillConversationContext["history"] = [],
    parentEventId?: string,
  ): Promise<{ state: BillSkillState; analysis: BillConversationInputAnalysis }> {
    const rawAnalysis = await analyzeBillConversationInput(
      this.provider,
      input,
      {
        ...state,
        history,
        turnMode,
      },
      this.logger,
      parentEventId,
    );
    const analysis = normalizeBillAnalysis(rawAnalysis, {
      ...state,
      history,
      turnMode,
    }, input);

    const shouldFreezeRecords = state.awaitingSettlementConfirmation && analysis.settlementRequested;

    return {
      analysis,
      state: {
        ...state,
        pendingQuestion: analysis.pendingQuestion || state.pendingQuestion,
        participants: mergeNames(state.participants.filter(isConcreteParticipantName), analysis.participants),
        records: shouldFreezeRecords ? state.records : mergeRecords(state.records, analysis.records),
        pendingExpenseDraft: analysis.pendingExpenseDraft,
      },
    };
  }

  completeTurn(
    state: BillSkillState,
    result: {
      status: "answered" | "clarify" | "reject";
      answer: string;
      settled?: boolean;
      shouldKeepDraft?: boolean;
    },
  ): BillSkillState {
    if (result.status === "clarify") {
      return {
        ...state,
        lastClarificationQuestion: result.answer,
      };
    }

    return {
      ...state,
      pendingQuestion: result.settled ? null : state.pendingQuestion,
      pendingExpenseDraft: result.shouldKeepDraft ? state.pendingExpenseDraft : null,
      awaitingSettlementConfirmation: result.settled ? false : state.awaitingSettlementConfirmation,
      lastClarificationQuestion: null,
    };
  }
}

export async function analyzeBillConversationInput(
  provider: MathModelProvider | undefined,
  input: string,
  context: BillConversationContext,
  logger?: TelemetryWriter,
  parentEventId?: string,
): Promise<BillConversationInputAnalysis> {
  const fallbackBase = fallbackAnalyzeBillInput(input, context);
  const fallback: BillConversationInputAnalysis = {
    ...fallbackBase,
    source: "fallback",
  };

  if (!provider) {
    return fallback;
  }

  try {
    const response = await generateWithLogging({
      provider,
      logger,
      parentEventId,
      purpose: "analyze_bill_conversation_input",
      messages: [
        {
          role: "system",
          content: buildBillAnalysisSystemPrompt(),
        },
        {
          role: "user",
          content: buildBillAnalysisUserPrompt(input, context),
        },
      ],
    });
    const parsed = parseBillInputAnalysis(response.text);
    if (!parsed) {
      return fallback;
    }

    return {
      ...parsed,
      pendingQuestion: parsed.pendingQuestion || fallbackBase.pendingQuestion,
      participants: parsed.participants.length > 0 ? parsed.participants : fallbackBase.participants,
      records: parsed.records.length > 0 ? parsed.records : fallbackBase.records,
      source: "llm",
    };
  } catch {
    return fallback;
  }
}

function parseBillInputAnalysis(text: string): BillInputAnalysis | null {
  try {
    const parsed = JSON.parse(text);
    const result = BillInputAnalysisSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function fallbackAnalyzeBillInput(input: string, context: BillConversationContext): BillInputAnalysis {
  const participants = mergeNames(context.participants ?? [], extractParticipants(input, context.participants ?? []));
  const records = extractBillRecords(input, participants);
  const settlementRequested = context.awaitingSettlementConfirmation
    ? /(没有了|没了|就这些|没有其他|没有别的|可以结算|开始结算)/.test(input)
    : false;
  const pendingExpenseDraft = buildPendingDraft(input, participants, records);
  const pendingQuestion = context.pendingQuestion ?? (settlementRequested ? "计算本次聚会账单结算结果" : "记录并整理本次聚会账单");

  return {
    pendingQuestion,
    participants,
    records,
    pendingExpenseDraft,
    settlementRequested,
    clarificationQuestion: pendingExpenseDraft ? buildClarificationQuestion(pendingExpenseDraft.missingFields) : null,
  };
}

function extractParticipants(input: string, existing: string[]): string[] {
  const normalizedInput = normalizeInputForParticipants(input);
  const explicit = [...normalizedInput.matchAll(/(?:^|[和、,，\s])(我|[A-Za-z\u4e00-\u9fa5]{1,8})(?=[和、,，\s]|出去玩|一起|吃饭|准备记账|都|$)/g)]
    .map((match) => cleanParticipantCandidate(match[1]))
    .filter((value) => value && isConcreteParticipantName(value))
    .filter((value): value is string => Boolean(value));

  if (/(我们|大家|三个人|两个人|所有人)/.test(input) && existing.length > 0) {
    return mergeNames(explicit, existing);
  }

  return explicit;
}

function extractBillRecords(input: string, participants: string[]): BillFactRecord[] {
  const records: BillFactRecord[] = [];
  const segments = input.split(/[。；;！？?!]/).map((segment) => segment.trim()).filter(Boolean);

  for (const segment of segments) {
    const amountMatch = segment.match(/(\d+(?:\.\d+)?)\s*元/);
    if (!amountMatch) {
      continue;
    }

    const amount = Number(amountMatch[1]);
    const payer = extractPayer(segment);
    const beneficiaries = inferBeneficiaries(segment, participants, payer);

    if (!payer || beneficiaries.length === 0) {
      continue;
    }

    const recordCandidate = BillFactRecordSchema.safeParse({
      payer,
      amount,
      beneficiaries,
      description: segment.replace(/，/g, ","),
      sourceText: segment,
    });
    if (recordCandidate.success) {
      records.push(recordCandidate.data);
    }
  }

  return records;
}

function inferBeneficiaries(segment: string, participants: string[], payer: string | null): string[] {
  if (!payer) {
    return [];
  }

  if (/(我们|大家|三个人|两个人|一起)/.test(segment) && participants.length > 0) {
    return participants;
  }

  if (segment.includes("自己")) {
    return [payer];
  }

  const explicitTargets = participants.filter((participant) => participant !== payer && segment.includes(participant));
  if (explicitTargets.length > 0) {
    return explicitTargets;
  }

  if (/(给我|帮我|为我)/.test(segment)) {
    return ["我"];
  }

  return [];
}

function buildPendingDraft(
  input: string,
  participants: string[],
  records: BillFactRecord[],
) {
  if (records.length > 0) {
    return null;
  }

  const amountMatch = input.match(/(\d+(?:\.\d+)?)\s*元/);
  const payer = extractPayer(input);
  const beneficiaries = inferBeneficiaries(input, participants, payer);
  const missingFields: Array<"payer" | "amount" | "beneficiaries"> = [];

  if (!payer && /花了|付了|买了|先付/.test(input)) {
    missingFields.push("payer");
  }

  if (!amountMatch && /花了|付了|买了|先付/.test(input)) {
    missingFields.push("amount");
  }

  if (amountMatch && payer && beneficiaries.length === 0) {
    missingFields.push("beneficiaries");
  }

  if (missingFields.length === 0) {
    return null;
  }

  return {
    payer,
    amount: amountMatch ? Number(amountMatch[1]) : null,
    beneficiaries,
    description: input.replace(/，/g, ","),
    sourceText: input,
    missingFields,
  };
}

function extractPayer(input: string): string | null {
  const clauses = input
    .split(/[，,]/)
    .map((clause) => normalizeClauseForPayer(clause))
    .filter(Boolean);

  for (const clause of clauses) {
    const directMatch =
      clause.match(/^(?<payer>我|[A-Za-z\u4e00-\u9fa5]{1,8})(?:给|帮|先付|付了|自己买)/) ??
      clause.match(/^(?<payer>我|[A-Za-z\u4e00-\u9fa5]{1,8})为.+?(?:买了|付了|支付了|垫付了)/) ??
      clause.match(/^(?<payer>我|[A-Za-z\u4e00-\u9fa5]{1,8})买了/) ??
      clause.match(/^(?<payer>我|[A-Za-z\u4e00-\u9fa5]{1,8}).*?花了/);

    if (directMatch?.groups?.payer) {
      return directMatch.groups.payer.trim();
    }
  }

  return null;
}

function normalizeClauseForPayer(clause: string): string {
  return clause
    .trim()
    .replace(/^(今天早上|今天中午|今天晚上|昨天早上|昨天中午|昨天晚上|早上|中午|晚上|早饭|早餐|午饭|晚饭|然后|后来)/, "")
    .trim();
}

function normalizeInputForParticipants(input: string): string {
  return input
    .trim()
    .replace(/^(上周末|这周末|周末|今天早上|今天中午|今天晚上|昨天早上|昨天中午|昨天晚上|早上|中午|晚上|昨晚|今天|昨天)/, "")
    .trim();
}

function cleanParticipantCandidate(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/(一起.*|出去玩.*|准备记账.*|都.*|加入了我们.*|吃了.*|支付了.*|付了.*|花了.*)$/, "")
    .trim();
}

function buildClarificationQuestion(missingFields: Array<"payer" | "amount" | "beneficiaries">): string {
  if (missingFields.includes("beneficiaries")) {
    return "这笔钱是给谁花的？请说明具体由哪些人分摊。";
  }

  if (missingFields.includes("payer")) {
    return "这笔钱是谁付的？";
  }

  if (missingFields.includes("amount")) {
    return "这笔钱具体花了多少钱？";
  }

  return "可以再补充一下这笔账单的关键信息吗？";
}

function mergeNames(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const name of incoming) {
    const normalized = name.trim();
    if (!normalized || merged.includes(normalized)) {
      continue;
    }

    merged.push(normalized);
  }

  return merged;
}

function mergeRecords(existing: BillFactRecord[], incoming: BillFactRecord[]): BillFactRecord[] {
  const merged = [...existing];
  for (const record of incoming) {
    const duplicate = merged.some(
      (item) =>
        item.payer === record.payer &&
        item.amount === record.amount &&
        item.description === record.description &&
        item.beneficiaries.join("|") === record.beneficiaries.join("|"),
    );
    if (!duplicate) {
      merged.push(record);
    }
  }

  return merged;
}

function normalizeBillAnalysis(
  analysis: BillConversationInputAnalysis,
  context: BillConversationContext,
  input: string,
): BillConversationInputAnalysis {
  const knownParticipants = concreteParticipantPool(context, input);
  const normalizedParticipants = mergeNames(
    extractParticipants(input, context.participants ?? []),
    analysis.participants.map((participant) => normalizePersonLikeValue(participant, knownParticipants)).filter(isNonEmptyString),
  );

  const normalizedRecords = analysis.records
    .map((record) => normalizeBillRecord(record, input, normalizedParticipants, context.participants ?? []))
    .filter((record): record is BillFactRecord => record !== null);

  const normalizedDraft = normalizePendingDraft(
    analysis.pendingExpenseDraft,
    input,
    normalizedParticipants,
    context.participants ?? [],
  );

  return {
    ...analysis,
    participants: normalizedParticipants,
    records: normalizedRecords,
    pendingExpenseDraft: normalizedDraft,
    clarificationQuestion:
      normalizedDraft && normalizedDraft.missingFields.length > 0
        ? buildClarificationQuestion(normalizedDraft.missingFields)
        : analysis.clarificationQuestion,
  };
}

function normalizeBillRecord(
  record: BillFactRecord,
  input: string,
  normalizedParticipants: string[],
  existingParticipants: string[],
): BillFactRecord | null {
  const participantPool = concreteParticipantPool(
    {
      participants: mergeNames(existingParticipants, normalizedParticipants),
    },
    record.sourceText || input,
  );
  const payer = normalizePersonLikeValue(record.payer, participantPool) || extractPayer(record.sourceText || input);
  const beneficiaries = normalizeBeneficiaries(
    record.beneficiaries,
    record.sourceText || input,
    mergeNames(normalizedParticipants, existingParticipants),
  );

  if (!payer || beneficiaries.length === 0) {
    return null;
  }

  const parsed = BillFactRecordSchema.safeParse({
    ...record,
    payer,
    beneficiaries,
  });

  return parsed.success ? parsed.data : null;
}

function normalizePendingDraft(
  draft: BillConversationInputAnalysis["pendingExpenseDraft"],
  input: string,
  normalizedParticipants: string[],
  existingParticipants: string[],
) {
  if (!draft) {
    return null;
  }

  const payer = normalizePersonLikeValue(draft.payer, concreteParticipantPool({ participants: existingParticipants }, input))
    || extractPayer(draft.sourceText || input);
  const beneficiaries = normalizeBeneficiaries(
    draft.beneficiaries,
    draft.sourceText || input,
    mergeNames(normalizedParticipants, existingParticipants),
  );
  const missingFields = [...draft.missingFields].filter((field, index, fields) => fields.indexOf(field) === index);

  const finalMissingFields = missingFields.filter((field) => {
    if (field === "payer") {
      return !payer;
    }
    if (field === "beneficiaries") {
      return beneficiaries.length === 0;
    }
    if (field === "amount") {
      return draft.amount === null;
    }
    return true;
  });

  return {
    ...draft,
    payer,
    beneficiaries,
    missingFields: finalMissingFields.length > 0 ? finalMissingFields : draft.missingFields,
  };
}

function normalizeBeneficiaries(rawBeneficiaries: string[], sourceText: string, knownParticipants: string[]): string[] {
  const normalizedRaw = rawBeneficiaries
    .map((beneficiary) => normalizePersonLikeValue(beneficiary, concreteParticipantPool({ participants: knownParticipants }, sourceText)))
    .filter(isNonEmptyString);

  if (normalizedRaw.length > 0) {
    return dedupeNames(normalizedRaw);
  }

  const extracted = inferBeneficiaries(sourceText, knownParticipants, extractPayer(sourceText));
  return dedupeNames(extracted.filter(isConcreteParticipantName));
}

function concreteParticipantPool(context: Pick<BillConversationContext, "participants">, input: string): string[] {
  return mergeNames(
    (context.participants ?? []).filter(isConcreteParticipantName),
    extractParticipants(input, []),
  );
}

function normalizePersonLikeValue(value: string | null | undefined, knownParticipants: string[]): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const exactKnown = knownParticipants.find((participant) => trimmed === participant);
  if (exactKnown) {
    return exactKnown;
  }

  const containedKnown = knownParticipants.find((participant) => trimmed.includes(participant));
  if (containedKnown) {
    return containedKnown;
  }

  return isConcreteParticipantName(trimmed) ? trimmed : null;
}

function isConcreteParticipantName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!/^(我|[A-Za-z\u4e00-\u9fa5]{1,6})$/.test(trimmed)) {
    return false;
  }

  return !/(朋友们|我们|大家|所有人|三个人|两个人|一起|加入|吃|早饭|午饭|晚饭|支付|付钱|付了|花了|出去玩|账单|现在要算)/.test(trimmed);
}

function dedupeNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
