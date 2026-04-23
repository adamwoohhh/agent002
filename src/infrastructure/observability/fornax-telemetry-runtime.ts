import { fornaxTracer } from "@next-ai/fornax-sdk/tracer";

import type { AppConfig } from "../config/app-config.js";

type FornaxInitializeOptions = Parameters<typeof fornaxTracer.initialize>[0];

export type FornaxSpanLike = ReturnType<typeof fornaxTracer.startSpan>;

export type FornaxTracerLike = {
  initialize(options: FornaxInitializeOptions): void;
  startSpan: typeof fornaxTracer.startSpan;
  forceFlush?: typeof fornaxTracer.forceFlush;
  shutdown?: typeof fornaxTracer.shutdown;
};

const initializedTracers = new WeakSet<object>();
const registeredShutdownHooks = new WeakSet<object>();

export class FornaxTelemetryRuntime {
  constructor(
    private readonly config: AppConfig,
    private readonly tracer: FornaxTracerLike = fornaxTracer,
  ) {}

  isEnabled(): boolean {
    return Boolean(this.config.observability.fornaxAk && this.config.observability.fornaxSk);
  }

  startSpan(options: Parameters<typeof fornaxTracer.startSpan>[0]): FornaxSpanLike | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }

    this.initialize();
    return this.tracer.startSpan(options);
  }

  async flush(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    this.initialize();
    await this.tracer.forceFlush?.();
  }

  async shutdown(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    this.initialize();
    await this.tracer.shutdown?.();
  }

  private initialize(): void {
    const tracerKey = this.tracer as unknown as object;
    if (initializedTracers.has(tracerKey)) {
      return;
    }

    const ak = this.config.observability.fornaxAk;
    const sk = this.config.observability.fornaxSk;
    if (!ak || !sk) {
      return;
    }

    this.tracer.initialize({
      ak,
      sk,
      appName: this.config.observability.fornaxAppName,
      processor: this.config.observability.fornaxProcessor,
      recordInputs: this.config.observability.fornaxRecordInputs,
      recordOutputs: this.config.observability.fornaxRecordOutputs,
      errorHandler: (error) => {
        console.error("[telemetry] fornax error:", error);
      },
    });
    initializedTracers.add(tracerKey);
    this.registerShutdownHook(tracerKey);
  }

  private registerShutdownHook(tracerKey: object): void {
    if (registeredShutdownHooks.has(tracerKey)) {
      return;
    }

    process.once("beforeExit", async () => {
      try {
        await this.tracer.forceFlush?.();
        await this.tracer.shutdown?.();
      } catch (error) {
        console.error("[telemetry] fornax shutdown failed:", error);
      }
    });

    registeredShutdownHooks.add(tracerKey);
  }
}
