# Bill Skill Participant Confirmation Design

## Goal

Refactor the bill skill so participant identity is confirmed before any payment event is recorded, new names are never silently added, completed payment events are stored as validated structured JSON, and settlement requires a second confirmation after showing all structured data.

## Current Behavior

The bill skill currently merges any parsed participant names into `participants` during `BillSkillStateManager.beginTurn`. It also appends complete parsed records to `records` as soon as payer, amount, and beneficiaries are present. When the user requests settlement, `BillSkill.handle` computes and prints the settlement result immediately.

This is convenient, but it allows three unsafe behaviors:

- First-turn participant candidates can be accepted without user confirmation.
- Names that appear later can be treated as participants implicitly.
- Settlement can run before the user sees the exact structured ledger that will be used.

## Desired Conversation Flow

When the bill skill is first activated, it must identify candidate participants and ask the user to confirm them before formal recording starts. If the first user message contains both participants and a payment event, the payment event is temporarily held until the participants are confirmed.

If the candidate list includes `我`, the confirmation question must explicitly ask whether `我` means the user themself and whether the user participates in the split. The default candidate behavior is:

- Include `我` in the candidate participant list when the input implies the user is involved.
- Do not write `我` to the confirmed `participants` list until the user confirms.
- After confirmation, treat later `我` references as the confirmed user participant.

After participants are confirmed, each payment event must be recorded only when these fields are complete:

- `payer`
- `amount`
- `beneficiaries`

Once those fields are complete, the model-facing extraction contract must return JSON that validates against the existing bill schemas before the event is committed to state.

If a later turn mentions a name that is not already in confirmed `participants`, the skill must not ignore it and must not add it automatically. It should enter a pending participant review state and ask whether the detected person should be added to this bill. Any payment event involving that person remains pending until the user confirms or rejects the addition.

When the user asks to settle, the skill must not compute immediately. It must first print all structured data that will be used for settlement and ask for confirmation. Only after the user confirms the printed ledger should the skill call local settlement computation and render the final transfer suggestions.

## State Model

Extend `BillSkillState` with explicit workflow state:

- `participantConfirmation`: pending initial participant candidates and any held first-turn records or drafts.
- `pendingParticipantReview`: a later unknown name plus the payment record or draft blocked on that name.
- `pendingSettlementConfirmation`: the structured ledger shown to the user before final settlement.

The existing `participants` field remains the confirmed participant list only. The existing `records` field remains the committed ledger only. Candidate participants and blocked records must not be mixed into those confirmed fields.

## Parsing and Normalization

The LLM prompt should continue to require JSON-only responses. It should be tightened so complete payment events are returned as structured JSON, not prose, and so participant candidates are separate from confirmed state.

Normalization in `state-manager.ts` remains the defensive layer:

- Merge names only into candidate state until initial confirmation is complete.
- Validate every record with `BillFactRecordSchema`.
- Reject or block records whose payer or beneficiaries include names outside the confirmed participant list.
- Preserve blocked information in pending state so it can be resolved after confirmation.

Fallback parsing should follow the same rules as LLM parsing so tests do not depend on provider behavior.

## User-Facing Messages

Initial confirmation should look like:

```text
我识别到参与人：我、小明、小花。这里的“我”是否代表你本人，并且你也参与本次分摊？请确认参与人名单是否正确。
```

Unknown later participant confirmation should look like:

```text
我识别到“李雷”不在当前参与人中。是否要把他加入本次账单参与人？确认后我再记录这笔账单。
```

Settlement confirmation should include JSON-like structured data:

```json
{
  "participants": ["我", "小明", "小花"],
  "records": [
    {
      "payer": "我",
      "amount": 30,
      "beneficiaries": ["我", "小明", "小花"],
      "description": "早饭",
      "sourceText": "早上我给我们三个人买了早饭，花了30元"
    }
  ]
}
```

The prompt after the data should ask the user to confirm whether to proceed with settlement.

## Error Handling

If the first activation lacks clear participants, ask the user to list all participants before recording expenses.

If the user rejects the candidate participant list, ask them to provide the corrected full list. Do not attempt to patch the list silently.

If the user rejects a later unknown participant, keep the payment event unresolved and ask for corrected payer or beneficiaries if needed.

If settlement confirmation is rejected, keep the skill active and ask what should be corrected.

## Testing Strategy

Update the bill agent evaluation tests and add unit coverage around state transitions.

Required behavior tests:

- First message with participants and a complete payment event asks for participant confirmation before recording the payment.
- Confirming the initial participant list records the held first payment event.
- Initial candidate list containing `我` asks whether `我` represents the user and participates in the split.
- A later unknown name triggers confirmation and does not update confirmed participants or committed records before user approval.
- A complete payment event is committed only after it validates as structured JSON.
- Settlement request prints participants and records as structured data and asks for confirmation instead of settling immediately.
- Settlement confirmation then produces the computed settlement result.

## Out of Scope

This change does not introduce editing or deleting already committed records beyond the settlement confirmation rejection path asking the user what to correct. It also does not change the local settlement algorithm.
