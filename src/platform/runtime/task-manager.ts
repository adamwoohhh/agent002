import { randomUUID } from "node:crypto";

import type { AgentRun, AgentTask } from "./types.js";

export class TaskManager {
  createTask(capability: string, input: string): AgentTask {
    return {
      id: randomUUID(),
      capability,
      input,
    };
  }

  createRun(task: AgentTask): AgentRun {
    return {
      id: randomUUID(),
      taskId: task.id,
      steps: [
        {
          id: randomUUID(),
          name: `${task.capability}:handle`,
          status: "pending",
        },
      ],
    };
  }
}
