import type { ConversationMessage } from "../../infrastructure/llm/types.js";

export type AgentTurnMode = "new_request" | "supplement";

export type AgentSessionState = {
  history: ConversationMessage[];
  activeSkillId: string | null;
  pendingSkillSwitch: boolean;
  lastAgentQuestion: string | null;
  sessionMetadata: Record<string, unknown>;
  skillStateById: Record<string, unknown>;
};

export function createEmptyAgentSessionState(): AgentSessionState {
  return {
    history: [],
    activeSkillId: null,
    pendingSkillSwitch: false,
    lastAgentQuestion: null,
    sessionMetadata: {},
    skillStateById: {},
  };
}
