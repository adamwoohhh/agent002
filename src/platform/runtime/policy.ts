import type { ExecutionAction, PolicyDecision, RunContext } from "./types.js";

export interface ExecutionPolicy {
  authorize(action: ExecutionAction, context?: RunContext): PolicyDecision;
}

export class AllowAllExecutionPolicy implements ExecutionPolicy {
  authorize(_action: ExecutionAction, _context?: RunContext): PolicyDecision {
    return { allowed: true };
  }
}
