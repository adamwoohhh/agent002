import type { AppConfig } from "../infrastructure/config/app-config.js";
import { createMathModelProvider } from "../infrastructure/llm/provider-factory.js";
import { createTelemetryWriter } from "../infrastructure/observability/create-telemetry-writer.js";
import { MathCapability } from "../application/math-agent/math-capability.js";
import { MathChatService } from "../application/math-agent/math-chat-service.js";
import { CapabilityRegistry } from "../platform/runtime/capability.js";
import { AgentRuntime } from "../platform/runtime/agent-runtime.js";

export type AgentResult = {
  output: string;
};

export interface AgentSession {
  respond(input: string): Promise<string>;
  getHistory(): Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentApp {
  run(input: string): Promise<AgentResult>;
  createSession(): AgentSession;
}

export function createAgentApp(config: AppConfig): AgentApp {
  const provider = createMathModelProvider(config);

  return {
    // 单次执行
    async run(input: string): Promise<AgentResult> {
      const logger = await createTelemetryWriter("agx-run", config);
      const registry = new CapabilityRegistry();
      registry.register(new MathCapability(config, provider, logger));
      const runtime = new AgentRuntime(registry, undefined, undefined, logger);
      const result = await runtime.execute("math", input);
      await logger.flush?.();
      return {
        output: result.output,
      };
    },
    createSession(): AgentSession {
      return new MathChatService(config, provider);
    },
  };
}
