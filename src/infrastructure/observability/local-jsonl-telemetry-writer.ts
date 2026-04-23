import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveSpanDescriptor, type LocalSpanRecord, type SpanDescriptor } from "./telemetry-span-mapping.js";
import type {
  GraphTelemetryEvent,
  ModelTelemetryEvent,
  RunLifecycleEvent,
  RuntimeTelemetryEvent,
  SessionTelemetryEvent,
  TelemetryEvent,
  TelemetryWriter,
} from "./telemetry-writer.js";

export class LocalJsonlTelemetryWriter implements TelemetryWriter {
  private sequence = 0;
  private readonly spanDescriptors = new Map<string, SpanDescriptor>();

  constructor(
    readonly runId: string,
    readonly filePath: string,
  ) {}

  static async create(params: {
    runId: string;
    prefix?: string;
    logDirectory?: string;
  }): Promise<LocalJsonlTelemetryWriter> {
    const fileName = `${params.prefix ?? "agx-run"}-${new Date().toISOString().replaceAll(":", "-")}-${params.runId}.jsonl`;
    const logDirectory = resolveLogDirectory(params.logDirectory);
    await mkdir(logDirectory, { recursive: true });

    return new LocalJsonlTelemetryWriter(params.runId, path.join(logDirectory, fileName));
  }

  async runStarted(event: RunLifecycleEvent): Promise<void> { await this.appendEvent(event); }
  async runCompleted(event: RunLifecycleEvent): Promise<void> { await this.appendEvent(event); }
  async runFailed(event: RunLifecycleEvent): Promise<void> { await this.appendEvent(event); }
  async sessionEvent(event: SessionTelemetryEvent): Promise<void> { await this.appendEvent(event); }
  async graphEvent(event: GraphTelemetryEvent): Promise<void> { await this.appendEvent(event); }
  async modelCall(event: ModelTelemetryEvent): Promise<void> { await this.appendEvent(event); }
  async policyRejected(event: RuntimeTelemetryEvent): Promise<void> { await this.appendEvent(event); }
  async runtimeTaskCompleted(event: RuntimeTelemetryEvent): Promise<void> { await this.appendEvent(event); }

  private async appendEvent(event: TelemetryEvent): Promise<void> {
    const sanitizedRecord = sanitizeForJsonl(this.toSpanRecord(event));
    const line = JSON.stringify({
      sequence: this.sequence,
      ...(typeof sanitizedRecord === "object" && sanitizedRecord !== null ? sanitizedRecord : { event: sanitizedRecord }),
    });

    this.sequence += 1;
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }

  async flush(): Promise<void> {
    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private toSpanRecord(event: TelemetryEvent): LocalSpanRecord {
    const isEndEvent = event.type === "run_completed" || event.type === "run_failed";
    const spanId = isEndEvent
      ? typeof event.parentEventId === "string"
        ? event.parentEventId
        : typeof event.eventId === "string"
          ? event.eventId
          : this.runId
      : typeof event.eventId === "string"
        ? event.eventId
        : this.runId;

    const parentSpanId = !isEndEvent && typeof event.parentEventId === "string"
      ? event.parentEventId
      : undefined;

    const currentDescriptor = resolveSpanDescriptor(event, this.runId);
    const descriptor = isEndEvent ? this.spanDescriptors.get(spanId) ?? currentDescriptor : currentDescriptor;

    if (!isEndEvent) {
      this.spanDescriptors.set(spanId, descriptor);
    }

    return {
      recordType: "span_event",
      stage: event.type === "run_started" ? "start" : isEndEvent ? "end" : "instant",
      timestamp: event.timestamp,
      runId: typeof event.runId === "string" ? event.runId : this.runId,
      spanId,
      parentSpanId,
      name: descriptor.name,
      spanType: descriptor.spanType,
      status: event.type === "run_failed" ? "failed" : event.type === "run_started" ? "open" : "completed",
      input: descriptor.input,
      output: currentDescriptor.output,
      error: currentDescriptor.error,
      tags: descriptor.tags,
      baggage: descriptor.baggage,
      type: event.type,
      event: event.event,
      node: event.node,
      purpose: event.purpose,
      phase: event.phase,
      mode: event.mode,
      eventId: typeof event.eventId === "string" ? event.eventId : undefined,
      parentEventId: typeof event.parentEventId === "string" ? event.parentEventId : undefined,
    };
  }
}

export function resolveLogDirectory(configuredDirectory?: string): string {
  if (configuredDirectory) {
    return path.resolve(configuredDirectory);
  }

  const envDirectory = process.env.AGX_LOG_DIR?.trim();
  if (envDirectory) {
    return path.resolve(envDirectory);
  }

  return path.resolve(process.cwd(), "logs");
}

export function sanitizeForJsonl(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJsonl(item));
  }

  if (typeof value === "object") {
    const maybeJson =
      "toJSON" in value && typeof value.toJSON === "function" ? value.toJSON() : value;

    if (maybeJson !== value) {
      return sanitizeForJsonl(maybeJson);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeForJsonl(nestedValue)]),
    );
  }

  return String(value);
}
