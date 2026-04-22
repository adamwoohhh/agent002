import type { RunContext } from "./types.js";

export type CapabilityResult = {
  output: string;
  metadata?: Record<string, unknown>;
};

export interface Capability {
  readonly name: string;
  handle(input: string, context?: RunContext): Promise<CapabilityResult>;
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  register(capability: Capability): void {
    this.capabilities.set(capability.name, capability);
  }

  get(name: string): Capability {
    const capability = this.capabilities.get(name);
    if (!capability) {
      throw new Error(`未注册的 capability: ${name}`);
    }

    return capability;
  }
}
