import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import { CapabilityRegistry } from "./capability.js";
import type { ExecutionPolicy } from "./policy.js";
import { AllowAllExecutionPolicy } from "./policy.js";
import { TaskManager } from "./task-manager.js";
import type { AgentRun, AgentTask, RunContext } from "./types.js";

export type RunResult = {
  task: AgentTask;
  run: AgentRun;
  output: string;
  metadata?: Record<string, unknown>;
};

export class AgentRuntime {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly taskManager = new TaskManager(),
    private readonly policy: ExecutionPolicy = new AllowAllExecutionPolicy(),
    private readonly logger?: TelemetryWriter,
  ) {}

  async execute(capabilityName: string, input: string, context?: RunContext): Promise<RunResult> {
    const task = this.taskManager.createTask(capabilityName, input);
    const run = this.taskManager.createRun(task);

    const decision = this.policy.authorize(
      {
        kind: "capability",
        capability: capabilityName,
        input,
      },
      context,
    );

    if (!decision.allowed) {
      run.steps[0].status = "failed";
      run.outcome = {
        status: "rejected",
        output: decision.reason,
      };
      await this.logger?.policyRejected({
        type: "policy_rejected",
        timestamp: new Date().toISOString(),
        runId: this.logger.runId,
        parentEventId: getRuntimeParentEventId(context),
        task,
        reason: decision.reason,
      });
      return {
        task,
        run,
        output: decision.reason,
      };
    }

    run.steps[0].status = "running";
    const capability = this.registry.get(capabilityName);
    const result = await capability.handle(input, context);
    run.steps[0].status = "completed";
    run.outcome = {
      status: "completed",
      output: result.output,
    };

    await this.logger?.runtimeTaskCompleted({
      type: "runtime_task_completed",
      timestamp: new Date().toISOString(),
      runId: this.logger.runId,
      parentEventId: getRuntimeParentEventId(context),
      task,
      run,
      metadata: result.metadata,
    });

    return {
      task,
      run,
      output: result.output,
      metadata: result.metadata,
    };
  }
}

function getRuntimeParentEventId(context?: RunContext): string | undefined {
  return typeof context?.metadata?.graphParentEventId === "string"
    ? context.metadata.graphParentEventId
    : undefined;
}
