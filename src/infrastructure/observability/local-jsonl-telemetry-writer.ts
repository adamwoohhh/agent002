import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { TelemetryEvent, TelemetryWriter } from "./telemetry-writer.js";

export class LocalJsonlTelemetryWriter implements TelemetryWriter {
  private sequence = 0;

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

  async write(event: TelemetryEvent): Promise<void> {
    const sanitizedEvent = sanitizeForJsonl(event);
    const line = JSON.stringify({
      sequence: this.sequence,
      ...(typeof sanitizedEvent === "object" && sanitizedEvent !== null ? sanitizedEvent : { event: sanitizedEvent }),
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
