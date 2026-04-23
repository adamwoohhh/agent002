import type { TelemetryEvent, TelemetryWriter } from "./telemetry-writer.js";

export class CompositeTelemetryWriter implements TelemetryWriter {
  constructor(
    readonly runId: string,
    readonly filePath: string | undefined,
    private readonly sinks: TelemetryWriter[],
  ) {}

  async write(event: TelemetryEvent): Promise<void> {
    await this.invoke("write", event);
  }

  async flush(): Promise<void> {
    await this.invoke("flush");
  }

  async shutdown(): Promise<void> {
    await this.invoke("shutdown");
  }

  private async invoke(method: "flush" | "shutdown"): Promise<void>;
  private async invoke(method: "write", event: TelemetryEvent): Promise<void>;
  private async invoke(method: "write" | "flush" | "shutdown", event?: TelemetryEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.sinks.map(async (sink) => {
        if (method === "write") {
          await sink.write(event as TelemetryEvent);
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
