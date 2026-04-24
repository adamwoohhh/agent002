import type { TelemetryWriter } from "../../infrastructure/observability/telemetry-writer.js";
import { SkillRegistry } from "./skill.js";
import type { ExecutionPolicy } from "./policy.js";
import { AllowAllExecutionPolicy } from "./policy.js";
import { SkillRouter } from "./skill-router.js";
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
    private readonly registry: SkillRegistry,
    private readonly router?: SkillRouter,
    private readonly taskManager = new TaskManager(),
    private readonly policy: ExecutionPolicy = new AllowAllExecutionPolicy(),
    private readonly logger?: TelemetryWriter,
  ) {}

  async execute(input: string, context?: RunContext): Promise<RunResult> {
    if (!this.router) {
      throw new Error("AgentRuntime.execute 需要配置 skill router。");
    }

    const routeDecision = this.router.route(input, this.registry.listDescriptors(), context);
    if (routeDecision.kind !== "route") {
      const task = this.taskManager.createTask("router", input);
      const run = this.taskManager.createRun(task);
      run.steps[0].status = "completed";
      run.outcome = {
        status: routeDecision.kind === "reject" ? "rejected" : "completed",
        output: routeDecision.message,
      };
      return {
        task,
        run,
        output: routeDecision.message,
        metadata: {
          routeDecision,
        },
      };
    }

    return this.executeSkill(routeDecision.skillId, input, context);
  }

  async executeSkill(skillId: string, input: string, context?: RunContext): Promise<RunResult> {
    const task = this.taskManager.createTask(skillId, input);
    const run = this.taskManager.createRun(task);

    const decision = this.policy.authorize(
      {
        kind: "skill",
        skillId,
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
    const skill = this.registry.get(skillId);
    const result = await skill.handle(input, context);
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
