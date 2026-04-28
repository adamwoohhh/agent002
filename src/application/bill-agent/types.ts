import type { ConversationMessage } from "../../infrastructure/llm/types.js";
import type { AgentTurnMode } from "../agent/types.js";
import type { BillFactRecord, BillPendingExpenseDraft, BillSettlementSummary } from "../../domain/bill/types.js";

export type BillParticipantConfirmation = {
  candidates: string[];
  heldRecords: BillFactRecord[];
  heldDraft: BillPendingExpenseDraft | null;
  sourceText: string;
};

export type BillPendingParticipantReview = {
  name: string;
  heldRecords: BillFactRecord[];
  heldDraft: BillPendingExpenseDraft | null;
  sourceText: string;
};

export type BillPendingSettlementConfirmation = {
  participants: string[];
  records: BillFactRecord[];
};

export type BillSkillState = {
  pendingQuestion: string | null;
  participants: string[];
  records: BillFactRecord[];
  pendingExpenseDraft: BillPendingExpenseDraft | null;
  participantConfirmation: BillParticipantConfirmation | null;
  pendingParticipantReview: BillPendingParticipantReview | null;
  pendingSettlementConfirmation: BillPendingSettlementConfirmation | null;
  awaitingSettlementConfirmation: boolean;
  lastClarificationQuestion: string | null;
  lastSettlementSummary: BillSettlementSummary | null;
};

export type BillConversationContext = Partial<BillSkillState> & {
  history?: ConversationMessage[];
  turnMode?: AgentTurnMode;
};
