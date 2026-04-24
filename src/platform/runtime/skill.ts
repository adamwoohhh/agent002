import type { RunContext } from "./types.js";

export type SkillResult = {
  output: string;
  metadata?: Record<string, unknown>;
};

export type SkillDescriptor = {
  id: string;
  title: string;
  description: string;
  examples: string[];
  supportsConversation: boolean;
};

export interface AgentSkill {
  readonly descriptor: SkillDescriptor;
  handle(input: string, context?: RunContext): Promise<SkillResult>;
}

export class SkillRegistry {
  private readonly skills = new Map<string, AgentSkill>();

  register(skill: AgentSkill): void {
    this.skills.set(skill.descriptor.id, skill);
  }

  get(skillId: string): AgentSkill {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`未注册的 skill: ${skillId}`);
    }

    return skill;
  }

  listDescriptors(): SkillDescriptor[] {
    return [...this.skills.values()].map((skill) => skill.descriptor);
  }
}
