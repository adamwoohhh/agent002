import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

type JsonlLogEvent = {
  type: string;
  timestamp: string;
  [key: string]: unknown;
};

export class JsonlRunLogger {
  readonly runId: string;
  readonly filePath: string;
  private sequence = 0;

  private constructor(filePath: string, runId: string) {
    this.filePath = filePath;
    this.runId = runId;
  }

  static async create(prefix = "math-agent-run"): Promise<JsonlRunLogger> {
    const runId = randomUUID();
    const fileName = `${prefix}-${new Date().toISOString().replaceAll(":", "-")}-${runId}.jsonl`;
    const logDirectory = resolveLogDirectory();

    await mkdir(logDirectory, { recursive: true });

    return new JsonlRunLogger(path.join(logDirectory, fileName), runId);
  }

  async write(event: JsonlLogEvent): Promise<void> {
    const sanitizedEvent = sanitizeForJsonl(event);

    const line = JSON.stringify({
      sequence: this.sequence,
      ...(typeof sanitizedEvent === "object" && sanitizedEvent !== null ? sanitizedEvent : { event: sanitizedEvent }),
    });

    this.sequence += 1;
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }
}

function resolveLogDirectory(): string {
  const configuredDirectory = process.env.AGX_LOG_DIR?.trim();
  if (configuredDirectory) {
    return path.resolve(configuredDirectory);
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
