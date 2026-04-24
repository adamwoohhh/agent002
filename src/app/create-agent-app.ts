import type { AppConfig } from "../infrastructure/config/app-config.js";
import { createMathModelProvider } from "../infrastructure/llm/provider-factory.js";
import { createTelemetryWriter } from "../infrastructure/observability/create-telemetry-writer.js";
import { AgentChatService } from "../application/agent/agent-chat-service.js";
import { MathSkill } from "../application/math-agent/math-skill.js";
import { SkillRegistry } from "../platform/runtime/skill.js";
import { SkillRouter } from "../platform/runtime/skill-router.js";
import { AgentRuntime } from "../platform/runtime/agent-runtime.js";

export type AgentResult = {
  output: string;
};

export interface AgentSession {
  respond(input: string): Promise<string>;
  getHistory(): Array<{ role: "user" | "assistant"; content: string }>;
  close(): Promise<void>;
}

export interface AgentApp {
  run(input: string): Promise<AgentResult>;
  createSession(): AgentSession;
}

export function createAgentApp(config: AppConfig): AgentApp {
  const provider = createMathModelProvider(config);
  const router = new SkillRouter();

  return {
    // 单次执行
    async run(input: string): Promise<AgentResult> {
      const logger = await createTelemetryWriter("agx-run", config);
      const registry = new SkillRegistry();
      registry.register(new MathSkill(config, provider, logger));
      const runtime = new AgentRuntime(registry, router, undefined, undefined, logger);
      const result = await runtime.execute(input);
      await logger.flush?.();
      return {
        output: result.output,
      };
    },
    createSession(): AgentSession {
      const registry = new SkillRegistry();
      registry.register(new MathSkill(config, provider));
      return new AgentChatService(config, provider, registry, router);
    },
  }; 
}
