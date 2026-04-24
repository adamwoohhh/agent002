import { randomUUID } from "node:crypto";

import type { AgentRun, AgentTask } from "./types.js";

export class TaskManager {
  createTask(skillId: string, input: string): AgentTask {
    return {
      id: randomUUID(),
      skillId,
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
          name: `${task.skillId}:handle`,
          status: "pending",
        },
      ],
    };
  }
}
