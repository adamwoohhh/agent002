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
    if (mathSkill && isLikelyMathRequest(input)) {
      return {
        kind: "route",
        skillId: mathSkill.id,
      };
    }

    return {
      kind: "reject",
      message: "当前 agent 暂时只内置数学计算 skill，支持两个数字的一次加减乘除。",
    };
  }
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
