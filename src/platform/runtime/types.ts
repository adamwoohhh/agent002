export type AgentTask = {
  id: string;
  capability: string;
  input: string;
};

export type AgentRunStep = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
};

export type AgentOutcome = {
  status: "completed" | "rejected" | "failed";
  output: string;
};

export type AgentRun = {
  id: string;
  taskId: string;
  steps: AgentRunStep[];
  outcome?: AgentOutcome;
};

export type ExecutionAction = {
  kind: "capability";
  capability: string;
  input: string;
};

export type PolicyDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

export type RunContext = {
  sessionId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  metadata?: Record<string, unknown>;
};
