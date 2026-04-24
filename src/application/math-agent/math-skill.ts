import { normalizeMathInput } from "../../domain/math/operations.js";
import type { AppConfig } from "../../infrastructure/config/app-config.js";
import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import type { AgentSkill, SkillDescriptor, SkillResult } from "../../platform/runtime/skill.js";
import type { RunContext } from "../../platform/runtime/types.js";
import type { AgentTurnMode } from "../agent/types.js";
import { MathAnswerRenderer } from "./ai/answer-renderer.js";
import { MathDecisionService } from "./ai/decision-service.js";
import { MathSkillStateManager, createEmptyConversationState } from "./conversation/state-manager.js";
import { executeMathGraph } from "./graph/math-agent-graph.js";
import type { MathConversationContext, MathSkillState } from "./types.js";

export class MathSkill implements AgentSkill {
  // skill 描述，用于 skill 路由阶段
  readonly descriptor: SkillDescriptor = {
    id: "math",
    title: "Math",
    description: "处理两个数字的一次加减乘除，支持续算、情境抽取和缺信息追问。",
    examples: ["12 加 8", "结果再乘 2", "冰箱里有 3 个苹果，吃了 1 个，还剩几个"],
    supportsConversation: true,
  };
  private readonly decisionService: MathDecisionService;
  private readonly answerRenderer: MathAnswerRenderer;
  private readonly stateManager: MathSkillStateManager;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: MathModelProvider,
    private readonly logger?: TelemetryWriter,
  ) {
    this.decisionService = new MathDecisionService(provider, logger);
    this.answerRenderer = new MathAnswerRenderer(provider, logger);
    this.stateManager = new MathSkillStateManager(provider, logger);
  }

  // skill 执行，内部使用 graph 组织执行流程
  async handle(input: string, context?: RunContext): Promise<SkillResult> {
    const metadataContext = (context?.metadata ?? {}) as {
      turnMode?: AgentTurnMode;
      skillState?: Partial<MathSkillState>;
      graphParentEventId?: string;
      telemetryLogger?: TelemetryWriter;
    };
    const activeLogger = metadataContext.telemetryLogger ?? this.logger ?? noopTelemetryWriter;
    const stateManager = this.logger ? this.stateManager : new MathSkillStateManager(this.provider, activeLogger);
    const decisionService = this.logger ? this.decisionService : new MathDecisionService(this.provider, activeLogger);
    const answerRenderer = this.logger ? this.answerRenderer : new MathAnswerRenderer(this.provider, activeLogger);
    const turnMode = metadataContext.turnMode ?? "new_request";
    const currentState = hydrateMathSkillState(metadataContext.skillState);
    const normalizedSkillInput = normalizeMathInput(input);
    const { state: preparedState } = await stateManager.beginTurn(
      currentState,
      normalizedSkillInput,
      turnMode,
      typeof context?.metadata?.graphParentEventId === "string"
        ? context.metadata.graphParentEventId
        : undefined,
    );

    const conversationContext: MathConversationContext = {
      history: context?.history,
      turnMode,
      ...preparedState,
    };

    const result = await executeMathGraph({
      config: this.config,
      logger: activeLogger,
      decisionService,
      answerRenderer,
      input,
      context: conversationContext,
      parentEventId:
        typeof context?.metadata?.graphParentEventId === "string"
          ? context.metadata.graphParentEventId
          : undefined,
    });

    const status = resolveSkillStatus(result.finalState);
    const updatedSkillState = stateManager.completeTurn(preparedState, {
      status,
      answer: result.finalAnswer,
      execution:
        result.finalState.operation && result.finalState.result !== null && result.finalState.operands.length >= 2
          ? {
              operation: result.finalState.operation,
              operands: [result.finalState.operands[0], result.finalState.operands[1]],
              result: result.finalState.result,
            }
          : undefined,
    });
    const wantsReroute =
      status === "reject" && turnMode === "supplement" && !looksLikeMathContinuation(input);

    return {
      output: result.finalAnswer,
      metadata: {
        skillId: this.descriptor.id,
        status,
        updatedSkillState,
        keepActive: status !== "reject",
        wantsReroute,
        finalState: result.finalState,
      },
    };
  }

  getDecisionService(): MathDecisionService {
    return this.decisionService;
  }
}

function hydrateMathSkillState(skillState?: Partial<MathSkillState>): MathSkillState {
  return {
    ...createEmptyConversationState(),
    ...skillState,
    factMemory: Array.isArray(skillState?.factMemory) ? skillState.factMemory : [],
  };
}

function resolveSkillStatus(
  finalState: Awaited<ReturnType<typeof executeMathGraph>>["finalState"],
): "answered" | "clarify" | "reject" {
  if (finalState.clarificationQuestion) {
    return "clarify";
  }

  if (finalState.operation && finalState.result !== null) {
    return "answered";
  }

  return "reject";
}

function looksLikeMathContinuation(input: string): boolean {
  return /(结果|继续|再加|再减|再乘|再除|上一次结果|\d)/.test(input);
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
