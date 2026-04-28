import * as z from "zod";

export const BillFactRecordSchema = z.object({
  payer: z.string().min(1),
  amount: z.number().positive(),
  beneficiaries: z.array(z.string().min(1)).min(1),
  description: z.string().default(""),
  sourceText: z.string().default(""),
});

export type BillFactRecord = z.infer<typeof BillFactRecordSchema>;

export const BillPendingExpenseDraftSchema = z.object({
  payer: z.string().nullable(),
  amount: z.number().positive().nullable(),
  beneficiaries: z.array(z.string().min(1)),
  description: z.string().default(""),
  sourceText: z.string().default(""),
  missingFields: z.array(z.enum(["payer", "amount", "beneficiaries"])).min(1),
});

export type BillPendingExpenseDraft = z.infer<typeof BillPendingExpenseDraftSchema>;

export const BillInputAnalysisSchema = z.object({
  pendingQuestion: z.string().default(""),
  participants: z.array(z.string().min(1)).default([]),
  records: z.array(BillFactRecordSchema).default([]),
  pendingExpenseDraft: BillPendingExpenseDraftSchema.nullable().default(null),
  settlementRequested: z.boolean().default(false),
  clarificationQuestion: z.string().nullable().default(null),
});

export type BillInputAnalysis = z.infer<typeof BillInputAnalysisSchema>;

export type BillPersonSummary = {
  participant: string;
  paid: number;
  owed: number;
  net: number;
};

export type BillTransferSuggestion = {
  from: string;
  to: string;
  amount: number;
};

export type BillSettlementSummary = {
  participants: string[];
  records: BillFactRecord[];
  perPerson: BillPersonSummary[];
  transfers: BillTransferSuggestion[];
};
