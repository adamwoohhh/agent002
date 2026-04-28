import type { BillFactRecord, BillPersonSummary, BillSettlementSummary, BillTransferSuggestion } from "./types.js";

const EPSILON = 1e-6;

export function computeBillSettlement(records: BillFactRecord[], participants: string[]): BillSettlementSummary {
  const orderedParticipants = dedupeNames([...participants, ...records.flatMap((record) => [record.payer, ...record.beneficiaries])]);
  const totals = new Map<string, { paidCents: number; owedCents: number }>();

  for (const participant of orderedParticipants) {
    totals.set(participant, { paidCents: 0, owedCents: 0 });
  }

  for (const record of records) {
    if (record.beneficiaries.length === 0) {
      continue;
    }

    const amountCents = toCents(record.amount);
    const shareBase = Math.floor(amountCents / record.beneficiaries.length);
    let remainder = amountCents - shareBase * record.beneficiaries.length;

    ensureParticipant(totals, record.payer);
    totals.get(record.payer)!.paidCents += amountCents;

    for (const beneficiary of record.beneficiaries) {
      ensureParticipant(totals, beneficiary);
      const share = shareBase + (remainder > 0 ? 1 : 0);
      totals.get(beneficiary)!.owedCents += share;
      remainder = Math.max(0, remainder - 1);
    }
  }

  const perPerson: BillPersonSummary[] = [...totals.entries()].map(([participant, total]) => ({
    participant,
    paid: fromCents(total.paidCents),
    owed: fromCents(total.owedCents),
    net: fromCents(total.paidCents - total.owedCents),
  }));

  return {
    participants: orderedParticipants,
    records,
    perPerson,
    transfers: buildTransfers(perPerson),
  };
}

export function formatBillSettlement(summary: BillSettlementSummary): string {
  const lines: string[] = ["账本明细："];

  summary.records.forEach((record, index) => {
    lines.push(
      `${index + 1}. ${record.payer}支付${formatAmount(record.amount)}，由${record.beneficiaries.join("、")}分摊` +
        (record.description ? `（${record.description}）` : ""),
    );
  });

  lines.push("", "每人汇总：");

  for (const item of summary.perPerson) {
    lines.push(
      `${item.participant}：实付${formatAmount(item.paid)}，应付${formatAmount(item.owed)}，净额${formatSignedAmount(item.net)}`,
    );
  }

  lines.push("", "转账建议：");

  if (summary.transfers.length === 0) {
    lines.push("当前已经结清，不需要再转账。");
    return lines.join("\n");
  }

  for (const transfer of summary.transfers) {
    lines.push(`${transfer.from}给${transfer.to}${formatAmount(transfer.amount)}`);
  }

  return lines.join("\n");
}

export function formatAmount(amount: number): string {
  const normalized = normalizeAmount(amount);
  return `${normalized}元`;
}

export function formatSignedAmount(amount: number): string {
  const normalized = normalizeAmount(Math.abs(amount));
  if (Math.abs(amount) < EPSILON) {
    return "0元";
  }

  return `${amount > 0 ? "+" : "-"}${normalized}元`;
}

function buildTransfers(perPerson: BillPersonSummary[]): BillTransferSuggestion[] {
  const debtors = perPerson
    .filter((item) => item.net < -EPSILON)
    .map((item) => ({ participant: item.participant, remaining: toCents(-item.net) }));
  const creditors = perPerson
    .filter((item) => item.net > EPSILON)
    .map((item) => ({ participant: item.participant, remaining: toCents(item.net) }));

  const transfers: BillTransferSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    if (amount > 0) {
      transfers.push({
        from: debtor.participant,
        to: creditor.participant,
        amount: fromCents(amount),
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining === 0) {
      debtorIndex += 1;
    }

    if (creditor.remaining === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
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

function ensureParticipant(totals: Map<string, { paidCents: number; owedCents: number }>, participant: string) {
  if (!totals.has(participant)) {
    totals.set(participant, { paidCents: 0, owedCents: 0 });
  }
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(amount: number): number {
  return amount / 100;
}

function normalizeAmount(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(2).replace(/\.?0+$/, (match) => (match === ".00" ? "" : match));
}
