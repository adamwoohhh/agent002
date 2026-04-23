import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FornaxSpan, fornaxTracer } from '@next-ai/fornax-sdk/tracer';

import type { RunLogEvent, RunLogger } from "./run-logger.js";
import { AppConfig } from "../config/app-config.js";

export class JsonlRunLogger implements RunLogger {
  private sequence = 0;
  readonly runId: string;
  readonly filePath: string;
  private fornaxTracer?: typeof fornaxTracer;

  readonly rootSpan?: FornaxSpan;

  private constructor(config: {
    runId: string;
    filePath: string;
    fornaxTracer?: typeof fornaxTracer;
    rootSpan?: FornaxSpan;
  }) {
    this.runId = config.runId;
    this.filePath = config.filePath;
    this.fornaxTracer = config.fornaxTracer;
    this.rootSpan = config.rootSpan;
  }

  static async create(prefix = "agx-run", options: { logDirectory?: string } & AppConfig): Promise<JsonlRunLogger> {
    const runId = randomUUID();
    const fileName = `${prefix}-${new Date().toISOString().replaceAll(":", "-")}-${runId}.jsonl`;
    const logDirectory = resolveLogDirectory(options?.logDirectory);

    let fornaxTracerInstance: typeof fornaxTracer | undefined;
    let rootSpan: FornaxSpan | undefined;
    if (options.observability.fornaxAk && options.observability.fornaxSk) {
      fornaxTracer.initialize({
        ak: options.observability.fornaxAk,
        sk: options.observability.fornaxSk,
      });

      fornaxTracerInstance = fornaxTracer;

      rootSpan = fornaxTracerInstance?.startSpan({
        name: prefix.toUpperCase(),
        type: "custom",
        threadId: runId,
      });

      rootSpan?.setOutput({})?.end();
    }

    await mkdir(logDirectory, { recursive: true });

    const intstance = new JsonlRunLogger({
      runId,
      filePath: path.join(logDirectory, fileName),
      fornaxTracer: fornaxTracerInstance,
      rootSpan,
    });

    return intstance;
  }

  async write(event: RunLogEvent): Promise<void> {
    const sanitizedEvent = sanitizeForJsonl(event);

    const line = JSON.stringify({
      sequence: this.sequence,
      ...(typeof sanitizedEvent === "object" && sanitizedEvent !== null ? sanitizedEvent : { event: sanitizedEvent }),
    });

    this.sequence += 1;
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }
}

function resolveLogDirectory(configuredDirectory?: string): string {
  if (configuredDirectory) {
    return path.resolve(configuredDirectory);
  }

  const envDirectory = process.env.AGX_LOG_DIR?.trim();
  if (envDirectory) {
    return path.resolve(envDirectory);
  }

  return path.resolve(process.cwd(), "logs");
}

function sanitizeForJsonl(value: unknown): unknown {
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
