import type {
  GraphTelemetryEvent,
  ModelTelemetryEvent,
  RunLifecycleEvent,
  RuntimeTelemetryEvent,
  SessionTelemetryEvent,
  TelemetryWriter,
} from "./telemetry-writer.js";

export class CompositeTelemetryWriter implements TelemetryWriter {
  constructor(
    readonly runId: string,
    readonly filePath: string | undefined,
    private readonly sinks: TelemetryWriter[],
  ) {}

  async runStarted(event: RunLifecycleEvent): Promise<void> { await this.invoke("runStarted", event); }
  async runCompleted(event: RunLifecycleEvent): Promise<void> { await this.invoke("runCompleted", event); }
  async runFailed(event: RunLifecycleEvent): Promise<void> { await this.invoke("runFailed", event); }
  async sessionEvent(event: SessionTelemetryEvent): Promise<void> { await this.invoke("sessionEvent", event); }
  async graphEvent(event: GraphTelemetryEvent): Promise<void> { await this.invoke("graphEvent", event); }
  async modelCall(event: ModelTelemetryEvent): Promise<void> { await this.invoke("modelCall", event); }
  async policyRejected(event: RuntimeTelemetryEvent): Promise<void> { await this.invoke("policyRejected", event); }
  async runtimeTaskCompleted(event: RuntimeTelemetryEvent): Promise<void> { await this.invoke("runtimeTaskCompleted", event); }

  async flush(): Promise<void> {
    await this.invoke("flush");
  }

  async shutdown(): Promise<void> {
    await this.invoke("shutdown");
  }

  private async invoke(method: "flush" | "shutdown"): Promise<void>;
  private async invoke(
    method:
      | "runStarted"
      | "runCompleted"
      | "runFailed"
      | "sessionEvent"
      | "graphEvent"
      | "modelCall"
      | "policyRejected"
      | "runtimeTaskCompleted",
    event: RunLifecycleEvent | SessionTelemetryEvent | GraphTelemetryEvent | ModelTelemetryEvent | RuntimeTelemetryEvent,
  ): Promise<void>;
  private async invoke(
    method:
      | "runStarted"
      | "runCompleted"
      | "runFailed"
      | "sessionEvent"
      | "graphEvent"
      | "modelCall"
      | "policyRejected"
      | "runtimeTaskCompleted"
      | "flush"
      | "shutdown",
    event?: RunLifecycleEvent | SessionTelemetryEvent | GraphTelemetryEvent | ModelTelemetryEvent | RuntimeTelemetryEvent,
  ): Promise<void> {
    const results = await Promise.allSettled(
      this.sinks.map(async (sink) => {
        if (method !== "flush" && method !== "shutdown") {
          await sink[method](event as never);
          return;
        }

        const maybeMethod = sink[method];
        if (typeof maybeMethod === "function") {
          await maybeMethod.call(sink);
        }
      }),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`[telemetry] sink ${method} failed:`, result.reason);
      }
    }
  }
}
