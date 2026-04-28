import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import type { AgentSkill, SkillDescriptor, SkillResult } from "../../platform/runtime/skill.js";
import type { RunContext } from "../../platform/runtime/types.js";
import type { AgentTurnMode } from "../agent/types.js";
import { computeBillSettlement, formatBillSettlement } from "../../domain/bill/settlement.js";
import { BillSkillStateManager, createEmptyBillConversationState } from "./conversation/state-manager.js";
import { executeBillGraph } from "./graph/bill-agent-graph.js";
import type { BillConversationContext, BillSkillState } from "./types.js";

export class BillSkill implements AgentSkill {
  readonly descriptor: SkillDescriptor = {
    id: "bill",
    title: "Bill",
    description: "处理多人账单记录、缺信息追问和本地结算。",
    examples: ["算一下各自的账单", "算一下我们各自花了多少钱，应该给其他人多少钱"],
    supportsConversation: true,
  };

  private readonly stateManager: BillSkillStateManager;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
    private readonly logger?: TelemetryWriter,
  ) {
    this.stateManager = new BillSkillStateManager(provider, logger);
  }

  async handle(input: string, context?: RunContext): Promise<SkillResult> {
    const metadataContext = (context?.metadata ?? {}) as {
      turnMode?: AgentTurnMode;
      skillState?: Partial<BillSkillState>;
      graphParentEventId?: string;
      telemetryLogger?: TelemetryWriter;
    };
    const activeLogger = metadataContext.telemetryLogger ?? this.logger ?? noopTelemetryWriter;
    const stateManager = this.logger ? this.stateManager : new BillSkillStateManager(this.provider, activeLogger);
    const turnMode = metadataContext.turnMode ?? "new_request";
    const currentState = hydrateBillSkillState(metadataContext.skillState);
    const { state: preparedState, analysis } = await stateManager.beginTurn(
      currentState,
      input.trim(),
      turnMode,
      context?.history,
      typeof metadataContext.graphParentEventId === "string" ? metadataContext.graphParentEventId : undefined,
    );

    const conversationContext: BillConversationContext = {
      history: context?.history,
      turnMode,
      ...preparedState,
    };

    let output = "";
    let status: "answered" | "clarify" | "reject" = "answered";
    let keepActive = true;
    let wantsReroute = false;
    let settled = false;
    let shouldKeepDraft = Boolean(preparedState.pendingExpenseDraft);
    let updatedState: BillSkillState = preparedState;

    if (analysis.clarificationQuestion) {
      output = analysis.clarificationQuestion;
      status = "clarify";
      updatedState = {
        ...preparedState,
        awaitingSettlementConfirmation: false,
      };
    } else if (analysis.settlementRequested) {
      if (preparedState.pendingExpenseDraft) {
        output = "还有一笔账单信息不完整。" + "\n" + "请先补充：" + buildDraftReminder(preparedState.pendingExpenseDraft.missingFields);
        status = "clarify";
        updatedState = {
          ...preparedState,
          awaitingSettlementConfirmation: false,
        };
      } else if (preparedState.records.length === 0) {
        output = "还没有记录到具体账单。请先告诉我谁付了多少钱、这笔钱是给谁花的。";
        status = "clarify";
        updatedState = {
          ...preparedState,
          awaitingSettlementConfirmation: false,
        };
      } else {
        const summary = computeBillSettlement(preparedState.records, preparedState.participants);
        output = formatBillSettlement(summary);
        await executeBillGraph({
          config: this.config,
          logger: activeLogger,
          input,
          analysis: {
            ...analysis,
            participants: preparedState.participants,
            records: preparedState.records,
          },
          context: conversationContext,
        });
        updatedState = {
          ...preparedState,
          awaitingSettlementConfirmation: false,
          lastSettlementSummary: summary,
        };
        settled = true;
        shouldKeepDraft = false;
      }
    } else if (preparedState.records.length > currentState.records.length) {
      const newCount = preparedState.records.length - currentState.records.length;
      output = `已记下${newCount}笔账单。当前共有${preparedState.records.length}笔，参与人：${preparedState.participants.join("、")}。还有其他人付了钱吗？如果都补充完了，请直接告诉我“没有其他支付事件了”或“开始结算”。`;
      status = "clarify";
      shouldKeepDraft = false;
      updatedState = {
        ...preparedState,
        awaitingSettlementConfirmation: true,
      };
    } else if (preparedState.participants.length > currentState.participants.length && preparedState.records.length === 0) {
      output = `参与人已记下：${preparedState.participants.join("、")}。请继续告诉我每笔谁付了多少钱、这笔钱是给谁花的。`;
      status = "clarify";
      updatedState = {
        ...preparedState,
        awaitingSettlementConfirmation: false,
      };
    } else {
      output = "这轮我还没识别到完整账单。请告诉我谁付了多少钱、这笔钱由哪些人分摊。";
      status = "clarify";
      updatedState = {
        ...preparedState,
        awaitingSettlementConfirmation: false,
      };
    }

    const completedState = stateManager.completeTurn(updatedState, {
      status,
      answer: output,
      settled,
      shouldKeepDraft,
    });

    return {
      output,
      metadata: {
        skillId: this.descriptor.id,
        status,
        updatedSkillState: completedState,
        keepActive,
        wantsReroute,
      },
    };
  }
}

function hydrateBillSkillState(skillState?: Partial<BillSkillState>): BillSkillState {
  return {
    ...createEmptyBillConversationState(),
    ...skillState,
    participants: Array.isArray(skillState?.participants) ? skillState.participants : [],
    records: Array.isArray(skillState?.records) ? skillState.records : [],
    awaitingSettlementConfirmation: skillState?.awaitingSettlementConfirmation === true,
  };
}

function buildDraftReminder(missingFields: Array<"payer" | "amount" | "beneficiaries">): string {
  if (missingFields.includes("beneficiaries")) {
    return "这笔钱是给谁花的？请说明具体由哪些人分摊。";
  }

  if (missingFields.includes("payer")) {
    return "这笔钱是谁付的？";
  }

  if (missingFields.includes("amount")) {
    return "这笔钱具体是多少钱？";
  }

  return "请补充这笔账单的关键信息。";
}
const noopTelemetryWriter: TelemetryWriter = {
  runId: "noop-run",
  async runStarted() {},
  async runCompleted() {},
  async runFailed() {},
  async sessionEvent() {},
  async graphEvent() {},
  async modelCall() {},
  async policyRejected() {},
  async runtimeTaskCompleted() {},
};
