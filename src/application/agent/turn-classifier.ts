import type { MathModelProvider } from "../../infrastructure/llm/types.js";
import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import { generateWithLogging } from "../../infrastructure/observability/model-call-logger.js";
import type { AgentTurnMode } from "./types.js";

export type TurnClassifierContext = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  activeSkillId: string | null;
  lastAgentQuestion: string | null;
};

/**
 * 对话路由助手，用于判断本轮用户输入是在提出一个新请求，还是在补充当前正在处理的请求。
 */
export class AgentTurnClassifier {
  constructor(
    private readonly provider: MathModelProvider,
    private readonly logger?: TelemetryWriter,
  ) {}

  async classify(
    input: string,
    context: TurnClassifierContext,
    parentEventId?: string,
  ): Promise<AgentTurnMode> {
    if (!context.activeSkillId) {
      return "new_request";
    }

    try {
      const response = await generateWithLogging({
        provider: this.provider,
        logger: this.logger,
        parentEventId,
        purpose: "classify_turn_mode",
        messages: [
          {
            role: "system",
            content: [
              "你是一个对话路由助手。",
              "你需要判断本轮用户输入是在提出一个新请求，还是在补充当前正在处理的请求。",
              "只能输出一个标签：NEW_REQUEST 或 SUPPLEMENT。",
              "如果用户是在回答上一轮追问、补充条件、补充事实、要求基于上一次结果继续，输出 SUPPLEMENT。",
              "如果上一轮是 agent/skill 的追问，而本轮看起来是在回应这条追问，即使回答里夹杂了无关信息、回答不完整，仍然优先输出 SUPPLEMENT。",
              "如果用户明显切换到一个新的目标、主题或任务，输出 NEW_REQUEST。",
            ].join("\n"),
          },
          {
            role: "user",
            content: buildTurnClassifierPrompt(input, context),
          },
        ],
      });

      const normalized = response.text.trim().toUpperCase();
      if (normalized.includes("SUPPLEMENT")) {
        return "supplement";
      }

      if (normalized.includes("NEW_REQUEST")) {
        if (isLikelyClarificationReply(input, context)) {
          return "supplement";
        }

        return "new_request";
      }
    } catch {
      // Fall through to deterministic heuristics.
    }

    return fallbackResolveTurnMode(input, context);
  }
}

function buildTurnClassifierPrompt(input: string, context: TurnClassifierContext): string {
  const sections = [`当前激活 skill：${context.activeSkillId ?? "无"}`];

  if (context.lastAgentQuestion) {
    sections.push(`上一轮 agent/skill 的追问：${context.lastAgentQuestion}`);
  }

  if (context.history.length > 0) {
    sections.push(
      [
        "对话历史：",
        ...context.history.map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`),
      ].join("\n"),
    );
  }

  sections.push(`本轮用户输入：${input}`);
  return sections.join("\n\n");
}

function fallbackResolveTurnMode(input: string, context: TurnClassifierContext): AgentTurnMode {
  if (!context.activeSkillId) {
    return "new_request";
  }

  if (isLikelyClarificationReply(input, context)) {
    return "supplement";
  }

  if (/(结果|继续|再加|再减|再乘|再除|上一次结果)/.test(input)) {
    return "supplement";
  }

  return looksLikeStandaloneRequest(input) ? "new_request" : "supplement";
}

/**
 * 用户上一轮刚收到澄清追问时，这里判断本轮输入是否更像是在回答那条追问，
 * 而不是明显开启一个新任务。它只作为模型误判时的兜底保护。
 */
function isLikelyClarificationReply(input: string, context: TurnClassifierContext): boolean {
  if (!context.lastAgentQuestion) {
    return false;
  }

  return looksLikeFollowUpAnswer(input) && !looksLikeExplicitNewRequest(input);
}

function looksLikeFollowUpAnswer(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && !/[？?]/.test(trimmed);
}

function looksLikeExplicitNewRequest(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (/[？?]$/.test(trimmed)) {
    return true;
  }

  if (/(新问题|另一个问题|另外|再问|顺便问|帮我|请你|请帮我|计算|算一下|求一下|生成|创建|查询|搜索)/.test(trimmed)) {
    return true;
  }

  return /(\d|[零一二三四五六七八九十百千万两])\s*(加|减|乘|除|plus|minus|times|divide)/i.test(trimmed);
}

function looksLikeStandaloneRequest(input: string): boolean {
  const trimmed = input.trim();
  if (/[？?]$/.test(trimmed)) {
    return true;
  }

  return /(帮我|请你|写|生成|创建|查询|搜索|什么|为什么|怎么|如何|谁|哪一个|多少|几)/.test(trimmed);
}
