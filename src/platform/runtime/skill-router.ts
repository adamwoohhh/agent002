import type { SkillDescriptor } from "./skill.js";
import type { RunContext } from "./types.js";

export type SkillRouterDecision =
  | {
      kind: "route";
      skillId: string;
    }
  | {
      kind: "clarify";
      message: string;
    }
  | {
      kind: "reject";
      message: string;
    };

export class SkillRouter {
  route(input: string, skills: SkillDescriptor[], _context?: RunContext): SkillRouterDecision {
    if (skills.length === 0) {
      return {
        kind: "reject",
        message: "当前 agent 还没有可用的内置 skill。",
      };
    }

    const mathSkill = skills.find((skill) => skill.id === "math");
    if (mathSkill && isExplicitArithmeticRequest(input)) {
      return {
        kind: "route",
        skillId: mathSkill.id,
      };
    }

    const billSkill = skills.find((skill) => skill.id === "bill");
    if (billSkill && isLikelyBillRequest(input)) {
      return {
        kind: "route",
        skillId: billSkill.id,
      };
    }

    if (mathSkill && isLikelyMathRequest(input)) {
      return {
        kind: "route",
        skillId: mathSkill.id,
      };
    }

    return {
      kind: "reject",
      message: "当前 agent 目前支持基础数学计算和多人账单结算。",
    };
  }
}

export function isLikelyBillRequest(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (/(账单|AA|分摊|谁该给谁|付了|花了|买了.*午饭|买了.*早饭|先付了|出去玩|吃饭)/.test(trimmed)) {
    return true;
  }

  return /(我们|大家|三个人|两个人).*(花了|出去玩|吃饭)/.test(trimmed);
}

function isExplicitArithmeticRequest(input: string): boolean {
  return /(\d|[零一二三四五六七八九十百千万两半])[^\n]{0,12}(加|减|乘|除|plus|minus|times|divide)/i.test(input.trim());
}

export function isLikelyMathRequest(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }

  if (/(结果|继续算|再加|再减|再乘|再除|上一次结果|还剩|总共|一共|平均|加|减|乘|除|plus|minus|times|divide)/i.test(trimmed)) {
    return true;
  }

  const hasNumber = /(\d|[零一二三四五六七八九十百千万两半])/.test(trimmed);
  const hasQuestion = /[？?]|(多少|几|剩下|等于|一共|总共)/.test(trimmed);
  return hasNumber && hasQuestion;
}
