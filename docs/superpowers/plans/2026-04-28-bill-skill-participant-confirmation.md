# Bill Skill Participant Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bill skill confirm participants before recording expenses, block unknown later names until confirmation, store complete payment events as validated JSON, and require settlement confirmation after printing the structured ledger.

**Architecture:** Add explicit workflow state to `BillSkillState`, keep `participants` and `records` as confirmed-only data, and route all candidate participants, blocked records, and settlement previews through pending state. `BillSkillStateManager` remains responsible for parsing, normalization, and safe state transitions; `BillSkill.handle` remains responsible for user-facing responses and settlement execution.

**Tech Stack:** TypeScript, Node `node:test`, Zod schemas, existing local bill settlement domain functions.

---

## File Structure

- Modify `src/application/bill-agent/types.ts`: add pending confirmation state types to `BillSkillState`.
- Modify `src/domain/bill/types.ts`: add reusable structured ledger schema if useful for settlement preview validation.
- Modify `src/application/bill-agent/conversation/state-manager.ts`: implement participant confirmation, unknown participant blocking, record validation, and confirmation intent helpers.
- Modify `src/application/bill-agent/bill-skill.ts`: render participant confirmation prompts, unknown participant prompts, structured settlement preview, and final settlement after confirmation.
- Modify `src/application/bill-agent/prompts/bill-prompts.ts`: tighten JSON extraction rules and context fields.
- Modify `tests/agent/bill-agent.eval.test.ts`: update existing bill flow expectations and add conversation-level regression tests.
- Add `tests/unit/bill-conversation-state.test.ts`: focused state-manager tests for candidate participants, held records, unknown names, and settlement preview state.

---

### Task 1: Add State Types and Empty State Fields

**Files:**
- Modify: `src/application/bill-agent/types.ts`
- Modify: `src/application/bill-agent/conversation/state-manager.ts`
- Test: `tests/unit/bill-conversation-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/bill-conversation-state.test.ts` with a test that asserts first-turn participants and records are held in pending confirmation state, not committed.

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { BillSkillStateManager, createEmptyBillConversationState } from "../../src/application/bill-agent/conversation/state-manager.js";
import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../../src/infrastructure/llm/types.js";

class StubProvider implements MathModelProvider {
  constructor(private readonly text: string) {}

  async generate(_params: { messages: ModelMessage[]; tools?: ModelTool[] }): Promise<ModelResponse> {
    return { text: this.text };
  }
}

test("first bill turn holds participants and complete records until participants are confirmed", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: ["我", "小明", "小花"],
    records: [{
      payer: "我",
      amount: 30,
      beneficiaries: ["我", "小明", "小花"],
      description: "早饭",
      sourceText: "早上我给我们三个人买了早饭，花了30元",
    }],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);

  const result = await manager.beginTurn(
    createEmptyBillConversationState(),
    "早上我和小明、小花一起出去玩，我给我们三个人买了早饭，花了30元",
    "new_request",
  );

  assert.deepEqual(result.state.participants, []);
  assert.deepEqual(result.state.records, []);
  assert.deepEqual(result.state.participantConfirmation?.candidates, ["我", "小明", "小花"]);
  assert.equal(result.state.participantConfirmation?.heldRecords.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bill-conversation-state.test.ts`

Expected: FAIL because `participantConfirmation` does not exist on `BillSkillState`.

- [ ] **Step 3: Add minimal state types and empty fields**

Update `src/application/bill-agent/types.ts`:

```typescript
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
```

Add these fields to `BillSkillState`:

```typescript
participantConfirmation: BillParticipantConfirmation | null;
pendingParticipantReview: BillPendingParticipantReview | null;
pendingSettlementConfirmation: BillPendingSettlementConfirmation | null;
```

Update `createEmptyBillConversationState()` in `state-manager.ts` to initialize all three fields to `null`.

- [ ] **Step 4: Implement first-turn holding logic**

In `BillSkillStateManager.beginTurn`, before merging participants or records into confirmed state:

```typescript
if (state.participants.length === 0 && analysis.participants.length > 0) {
  return {
    analysis,
    state: {
      ...state,
      pendingQuestion: analysis.pendingQuestion || state.pendingQuestion,
      participantConfirmation: {
        candidates: analysis.participants,
        heldRecords: analysis.records,
        heldDraft: analysis.pendingExpenseDraft,
        sourceText: input,
      },
      pendingExpenseDraft: null,
    },
  };
}
```

Keep this minimal; later tasks will add confirmation resolution and unknown-name handling.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/bill-conversation-state.test.ts`

Expected: PASS.

---

### Task 2: Confirm Initial Participants and Commit Held First Record

**Files:**
- Modify: `src/application/bill-agent/conversation/state-manager.ts`
- Modify: `src/application/bill-agent/bill-skill.ts`
- Test: `tests/agent/bill-agent.eval.test.ts`

- [ ] **Step 1: Write the failing conversation test**

Add a test to `tests/agent/bill-agent.eval.test.ts`:

```typescript
test("bill chat confirms initial participants before recording first complete payment", async () => {
  const provider = new StubProvider(({ messages }) => {
    const systemMessage = messages[0]?.content ?? "";
    const userMessage = messages.at(-1)?.content ?? "";
    const input = extractCurrentInput(userMessage);

    if (systemMessage.includes("对话路由助手")) {
      return { text: input === "确认，里面的我就是我本人，也参与分摊" ? "SUPPLEMENT" : "NEW_REQUEST" };
    }

    if (systemMessage.includes("账单对话解析助手")) {
      if (input.includes("早饭")) {
        return { text: JSON.stringify({
          pendingQuestion: "记录并整理本次聚会账单",
          participants: ["我", "小明", "小花"],
          records: [{
            payer: "我",
            amount: 30,
            beneficiaries: ["我", "小明", "小花"],
            description: "早饭",
            sourceText: input,
          }],
          pendingExpenseDraft: null,
          settlementRequested: false,
          clarificationQuestion: null,
        }) };
      }
      return { text: JSON.stringify({
        pendingQuestion: "记录并整理本次聚会账单",
        participants: [],
        records: [],
        pendingExpenseDraft: null,
        settlementRequested: false,
        clarificationQuestion: null,
      }) };
    }

    throw new Error(`unexpected provider input: ${systemMessage}\n${userMessage}`);
  });

  const session = new MathChatSession(provider);
  const first = await session.respond("早上我和小明、小花一起出去玩，我给我们三个人买了早饭，花了30元");
  assert.match(first, /我识别到参与人：我、小明、小花/);
  assert.match(first, /这里的“我”是否代表你本人/);
  assert.doesNotMatch(first, /已记下1笔账单/);

  const second = await session.respond("确认，里面的我就是我本人，也参与分摊");
  assert.match(second, /已确认参与人：我、小明、小花/);
  assert.match(second, /已记下1笔账单/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent/bill-agent.eval.test.ts --test-name-pattern "confirms initial participants"`

Expected: FAIL because the first response records the payment immediately or does not render participant confirmation.

- [ ] **Step 3: Add confirmation intent helper**

In `state-manager.ts`, add a local helper:

```typescript
function isAffirmativeConfirmation(input: string): boolean {
  return /(确认|对|是的|没错|正确|可以|是我本人|我本人|参与分摊)/.test(input) && !/(不对|不是|否|别|不要)/.test(input);
}
```

In `beginTurn`, handle pending initial confirmation before analyzing new records:

```typescript
if (state.participantConfirmation) {
  if (isAffirmativeConfirmation(input)) {
    return {
      analysis,
      state: {
        ...state,
        participants: state.participantConfirmation.candidates,
        records: mergeRecords(state.records, state.participantConfirmation.heldRecords),
        pendingExpenseDraft: state.participantConfirmation.heldDraft,
        participantConfirmation: null,
      },
    };
  }
}
```

- [ ] **Step 4: Render participant confirmation and confirmation acknowledgement**

In `bill-skill.ts`, before the existing `analysis.clarificationQuestion` branch:

```typescript
if (preparedState.participantConfirmation) {
  const names = preparedState.participantConfirmation.candidates.join("、");
  const includesSelf = preparedState.participantConfirmation.candidates.includes("我");
  output = includesSelf
    ? `我识别到参与人：${names}。这里的“我”是否代表你本人，并且你也参与本次分摊？请确认参与人名单是否正确。`
    : `我识别到参与人：${names}。请确认参与人名单是否正确。`;
  status = "clarify";
  updatedState = { ...preparedState, awaitingSettlementConfirmation: false };
} else if (currentState.participantConfirmation && !preparedState.participantConfirmation) {
  const committedCount = preparedState.records.length - currentState.records.length;
  output = `已确认参与人：${preparedState.participants.join("、")}。${committedCount > 0 ? `已记下${committedCount}笔账单。` : "请继续告诉我每笔谁付了多少钱、这笔钱由哪些人分摊。"}`;
  status = "clarify";
  updatedState = { ...preparedState, awaitingSettlementConfirmation: committedCount > 0 };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/agent/bill-agent.eval.test.ts --test-name-pattern "confirms initial participants"`

Expected: PASS.

---

### Task 3: Block Later Unknown Participants

**Files:**
- Modify: `src/application/bill-agent/conversation/state-manager.ts`
- Modify: `src/application/bill-agent/bill-skill.ts`
- Test: `tests/unit/bill-conversation-state.test.ts`
- Test: `tests/agent/bill-agent.eval.test.ts`

- [ ] **Step 1: Write failing state-manager test**

Add to `tests/unit/bill-conversation-state.test.ts`:

```typescript
test("later unknown participant is held for review instead of committed", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: [],
    records: [{
      payer: "李雷",
      amount: 60,
      beneficiaries: ["我", "小明", "李雷"],
      description: "奶茶",
      sourceText: "李雷买了奶茶，花了60元，我们三个人分摊",
    }],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);
  const state = {
    ...createEmptyBillConversationState(),
    participants: ["我", "小明"],
  };

  const result = await manager.beginTurn(state, "李雷买了奶茶，花了60元，我们三个人分摊", "supplement");

  assert.deepEqual(result.state.participants, ["我", "小明"]);
  assert.deepEqual(result.state.records, []);
  assert.equal(result.state.pendingParticipantReview?.name, "李雷");
  assert.equal(result.state.pendingParticipantReview?.heldRecords.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bill-conversation-state.test.ts --test-name-pattern "unknown participant"`

Expected: FAIL because the record is currently committed and `李雷` may be merged.

- [ ] **Step 3: Implement unknown participant detection**

Add helpers in `state-manager.ts`:

```typescript
function findUnknownParticipant(record: BillFactRecord, confirmedParticipants: string[]): string | null {
  const confirmed = new Set(confirmedParticipants);
  const names = [record.payer, ...record.beneficiaries];
  return names.find((name) => !confirmed.has(name)) ?? null;
}

function splitRecordsByKnownParticipants(records: BillFactRecord[], confirmedParticipants: string[]) {
  const safe: BillFactRecord[] = [];
  const blocked: BillFactRecord[] = [];
  let unknownName: string | null = null;

  for (const record of records) {
    const unknown = findUnknownParticipant(record, confirmedParticipants);
    if (unknown) {
      unknownName ??= unknown;
      blocked.push(record);
    } else {
      safe.push(record);
    }
  }

  return { safe, blocked, unknownName };
}
```

Use it before `mergeRecords` when `state.participants.length > 0`. If blocked records exist, return state with `pendingParticipantReview` and commit only safe records.

- [ ] **Step 4: Render unknown participant prompt**

In `bill-skill.ts`, before normal record acknowledgement:

```typescript
if (preparedState.pendingParticipantReview) {
  output = `我识别到“${preparedState.pendingParticipantReview.name}”不在当前参与人中。是否要把他加入本次账单参与人？确认后我再记录这笔账单。`;
  status = "clarify";
  updatedState = { ...preparedState, awaitingSettlementConfirmation: false };
}
```

- [ ] **Step 5: Add and pass conversation test**

Add a conversation test asserting the prompt appears and no `已记下1笔账单` appears before approval.

Run: `node --import tsx --test tests/agent/bill-agent.eval.test.ts --test-name-pattern "unknown participant"`

Expected: PASS after implementation.

---

### Task 4: Confirm or Reject Later Unknown Participant

**Files:**
- Modify: `src/application/bill-agent/conversation/state-manager.ts`
- Modify: `src/application/bill-agent/bill-skill.ts`
- Test: `tests/unit/bill-conversation-state.test.ts`

- [ ] **Step 1: Write failing confirmation test**

Add to `tests/unit/bill-conversation-state.test.ts`:

```typescript
test("confirming later unknown participant adds participant and commits held record", async () => {
  const provider = new StubProvider(JSON.stringify({
    pendingQuestion: "记录并整理本次聚会账单",
    participants: [],
    records: [],
    pendingExpenseDraft: null,
    settlementRequested: false,
    clarificationQuestion: null,
  }));
  const manager = new BillSkillStateManager(provider);
  const heldRecord = {
    payer: "李雷",
    amount: 60,
    beneficiaries: ["我", "小明", "李雷"],
    description: "奶茶",
    sourceText: "李雷买了奶茶，花了60元",
  };
  const state = {
    ...createEmptyBillConversationState(),
    participants: ["我", "小明"],
    pendingParticipantReview: {
      name: "李雷",
      heldRecords: [heldRecord],
      heldDraft: null,
      sourceText: heldRecord.sourceText,
    },
  };

  const result = await manager.beginTurn(state, "确认加入李雷", "supplement");

  assert.deepEqual(result.state.participants, ["我", "小明", "李雷"]);
  assert.deepEqual(result.state.records, [heldRecord]);
  assert.equal(result.state.pendingParticipantReview, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bill-conversation-state.test.ts --test-name-pattern "confirming later unknown"`

Expected: FAIL because confirmation is not implemented.

- [ ] **Step 3: Implement confirmation and rejection branches**

In `beginTurn`, before normal analysis merge:

```typescript
if (state.pendingParticipantReview) {
  if (isAffirmativeConfirmation(input)) {
    const participants = mergeNames(state.participants, [state.pendingParticipantReview.name]);
    return {
      analysis,
      state: {
        ...state,
        participants,
        records: mergeRecords(state.records, state.pendingParticipantReview.heldRecords),
        pendingExpenseDraft: state.pendingParticipantReview.heldDraft,
        pendingParticipantReview: null,
      },
    };
  }

  if (isNegativeConfirmation(input)) {
    return {
      analysis,
      state: {
        ...state,
        pendingParticipantReview: null,
        pendingExpenseDraft: state.pendingParticipantReview.heldDraft,
      },
    };
  }
}
```

Add:

```typescript
function isNegativeConfirmation(input: string): boolean {
  return /(不对|不是|否|不要|别加|不加入)/.test(input);
}
```

- [ ] **Step 4: Render acknowledgement and rejection messages**

In `bill-skill.ts`, add branches using `currentState.pendingParticipantReview && !preparedState.pendingParticipantReview`:

```typescript
if (currentState.pendingParticipantReview && !preparedState.pendingParticipantReview) {
  const added = preparedState.participants.includes(currentState.pendingParticipantReview.name);
  output = added
    ? `已加入参与人：${currentState.pendingParticipantReview.name}。已记下${preparedState.records.length - currentState.records.length}笔账单。`
    : `好的，未加入${currentState.pendingParticipantReview.name}。请补充这笔账单正确的付款人和分摊人。`;
  status = "clarify";
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --import tsx --test tests/unit/bill-conversation-state.test.ts`

Expected: PASS.

---

### Task 5: Add Settlement Preview and Confirmation Gate

**Files:**
- Modify: `src/application/bill-agent/conversation/state-manager.ts`
- Modify: `src/application/bill-agent/bill-skill.ts`
- Test: `tests/agent/bill-agent.eval.test.ts`

- [ ] **Step 1: Write failing settlement preview test**

Update the existing multi-turn settlement test so `"没有其他支付事件了，开始结算吧"` expects structured data and no final transfer suggestions yet:

```typescript
const preview = await session.respond("没有其他支付事件了，开始结算吧");
assert.match(preview, /请确认以下结构化账单数据/);
assert.match(preview, /"participants": \[/);
assert.match(preview, /"records": \[/);
assert.match(preview, /"payer": "我"/);
assert.doesNotMatch(preview, /我给小花43\.34元/);

const finalAnswer = await session.respond("确认无误，开始结算");
assert.match(finalAnswer, /账本明细：/);
assert.match(finalAnswer, /我给小花43\.34元/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent/bill-agent.eval.test.ts --test-name-pattern "settles a multi-turn"`

Expected: FAIL because settlement currently computes immediately.

- [ ] **Step 3: Store pending settlement confirmation**

When `analysis.settlementRequested` is true and there are records with no pending draft/review, set:

```typescript
pendingSettlementConfirmation: {
  participants: preparedState.participants,
  records: preparedState.records,
}
```

Do not call `computeBillSettlement` in this branch.

- [ ] **Step 4: Render structured preview**

Add helper in `bill-skill.ts`:

```typescript
function formatStructuredLedger(participants: string[], records: BillFactRecord[]): string {
  return JSON.stringify({ participants, records }, null, 2);
}
```

Render:

```typescript
output = [
  "请确认以下结构化账单数据，确认无误后我再开始结算：",
  "```json",
  formatStructuredLedger(preparedState.participants, preparedState.records),
  "```",
  "如果无误，请回复“确认无误，开始结算”；如果需要修改，请告诉我要改哪里。",
].join("\n");
```

- [ ] **Step 5: Compute only after preview confirmation**

Before normal analysis branches, if `currentState.pendingSettlementConfirmation` exists and input is affirmative, call:

```typescript
const summary = computeBillSettlement(
  currentState.pendingSettlementConfirmation.records,
  currentState.pendingSettlementConfirmation.participants,
);
output = formatBillSettlement(summary);
settled = true;
updatedState = {
  ...preparedState,
  pendingSettlementConfirmation: null,
  lastSettlementSummary: summary,
  awaitingSettlementConfirmation: false,
};
```

If input is negative, clear `pendingSettlementConfirmation` and ask what to correct.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test tests/agent/bill-agent.eval.test.ts --test-name-pattern "settles a multi-turn"`

Expected: PASS.

---

### Task 6: Tighten Prompt Contract and Existing Evaluations

**Files:**
- Modify: `src/application/bill-agent/prompts/bill-prompts.ts`
- Modify: `tests/agent/bill-agent.eval.test.ts`

- [ ] **Step 1: Write failing prompt assertion test**

Add an assertion in an existing provider stub when `systemMessage.includes("账单对话解析助手")`:

```typescript
assert.match(systemMessage, /完整支付事件必须以 JSON records 返回/);
assert.match(systemMessage, /不要把未确认的新名字默认加入参与人/);
```

Run the targeted test and confirm it fails because the prompt does not include these rules.

- [ ] **Step 2: Update system prompt**

In `buildBillAnalysisSystemPrompt()`, add explicit lines:

```typescript
"完整支付事件必须以 JSON records 返回，不能用自然语言描述替代 records。",
"不要把未确认的新名字默认加入参与人；如果名字不在上下文参与人中，也仍要在 records 或 pendingExpenseDraft 中保留原始名字，交给状态机确认。",
"如果上下文说明参与人尚未确认，只提取候选 participants 和 records，不要声明已经记录完成。",
```

- [ ] **Step 3: Update prompt context**

In `buildBillAnalysisUserPrompt()`, include current confirmation states:

```typescript
if (context.participantConfirmation) {
  sections.push(`待确认参与人：${context.participantConfirmation.candidates.join("、")}`);
}
if (context.pendingParticipantReview) {
  sections.push(`待确认新参与人：${context.pendingParticipantReview.name}`);
}
if (context.pendingSettlementConfirmation) {
  sections.push("当前状态：正在等待用户确认结构化账单数据后再结算。");
}
```

- [ ] **Step 4: Run agent tests**

Run: `npm run test:agent`

Expected: PASS after updating old expectations for participant and settlement confirmation gates.

---

### Task 7: Typecheck and Full Regression

**Files:**
- No new production files expected.
- Modify tests only if failures expose real expectation mismatches from the new confirmed flow.

- [ ] **Step 1: Run typecheck**

Run: `bunx tsc --noEmit`

Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run: `npm run test:unit`

Expected: PASS.

- [ ] **Step 3: Run agent tests**

Run: `npm run test:agent`

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run: `git diff --stat`

Expected: changes are limited to bill skill state, prompts, tests, and docs.

---

## Self-Review

Spec coverage:

- Initial participant confirmation is covered by Tasks 1 and 2.
- Explicit `我` confirmation is covered by Task 2.
- Later unknown participant blocking is covered by Tasks 3 and 4.
- Structured JSON record commitment is covered by Tasks 1, 3, and 6 through schema-validated records.
- Settlement preview and second confirmation are covered by Task 5.
- Full verification is covered by Task 7.

Placeholder scan:

- The plan contains no TBD/TODO placeholders.
- Each implementation task includes exact files, test commands, and expected outcomes.

Type consistency:

- New state fields are consistently named `participantConfirmation`, `pendingParticipantReview`, and `pendingSettlementConfirmation`.
- Existing `participants`, `records`, and `pendingExpenseDraft` keep their current meanings.
