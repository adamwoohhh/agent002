import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config/app-config.js";
import { CompositeTelemetryWriter } from "./composite-telemetry-writer.js";
import { FornaxTelemetryWriter } from "./fornax-telemetry-writer.js";
import { LocalJsonlTelemetryWriter } from "./local-jsonl-telemetry-writer.js";
import type { TelemetryWriter } from "./telemetry-writer.js";

export async function createTelemetryWriter(
  prefix = "agx-run",
  config?: AppConfig,
): Promise<TelemetryWriter> {
  const runId = randomUUID();
  const localWriter = await LocalJsonlTelemetryWriter.create({
    runId,
    prefix,
    logDirectory: config?.logging.directory,
  });

  const sinks: TelemetryWriter[] = [localWriter];

  if (config) {
    sinks.push(new FornaxTelemetryWriter(runId, config));
  }

  return new CompositeTelemetryWriter(runId, localWriter.filePath, sinks);
}

export async function shutdownTelemetry(writer?: TelemetryWriter): Promise<void> {
  await writer?.shutdown?.();
}
