import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type LogFileKind = "run" | "chat" | "unknown";

export type LogEvent = {
  sequence?: number;
  type?: string;
  timestamp?: string;
  mode?: string;
  [key: string]: unknown;
};

export type ParseError = {
  lineNumber: number;
  message: string;
  rawLine: string;
};

export type EventTypeCount = {
  type: string;
  count: number;
};

export type LogFileSummary = {
  runId: string | null;
  kind: LogFileKind;
  totalEvents: number;
  startedAt: string | null;
  completedAt: string | null;
  eventTypeCounts: EventTypeCount[];
};

export type LogFileListItem = {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  kind: LogFileKind;
  eventCount: number;
};

export type ParsedLogFile = {
  summary: LogFileSummary;
  events: LogEvent[];
  parseErrors: ParseError[];
};

export async function listLogFiles(logDirectory: string): Promise<LogFileListItem[]> {
  const entries = await readdir(logDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const fullPath = path.join(logDirectory, entry.name);
        const fileStat = await stat(fullPath);
        const parsed = await parseLogFile(fullPath);

        return {
          name: entry.name,
          path: fullPath,
          sizeBytes: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
          kind: inferLogFileKind(entry.name, parsed.events),
          eventCount: parsed.summary.totalEvents,
        } satisfies LogFileListItem;
      }),
  );

  return files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function parseLogFile(filePath: string): Promise<ParsedLogFile> {
  const content = await readFile(filePath, "utf8");
  return parseJsonlContent(content, path.basename(filePath));
}

export function parseJsonlContent(content: string, fileName = "unknown.jsonl"): ParsedLogFile {
  const parseErrors: ParseError[] = [];
  const events: LogEvent[] = [];

  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmedLine) as LogEvent;
      if (typeof parsed === "object" && parsed !== null) {
        events.push(parsed);
      } else {
        parseErrors.push({
          lineNumber: index + 1,
          message: "JSONL 行不是对象",
          rawLine,
        });
      }
    } catch (error) {
      parseErrors.push({
        lineNumber: index + 1,
        message: error instanceof Error ? error.message : "无法解析 JSON",
        rawLine,
      });
    }
  }

  return {
    summary: buildLogFileSummary(events, fileName),
    events,
    parseErrors,
  };
}

export function buildLogFileSummary(events: LogEvent[], fileName: string): LogFileSummary {
  const counts = new Map<string, number>();
  let runId: string | null = null;
  let startedAt: string | null = null;
  let completedAt: string | null = null;

  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : "unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);

    if (!runId && typeof event.runId === "string") {
      runId = event.runId;
    }

    if (!startedAt && typeof event.timestamp === "string") {
      startedAt = event.timestamp;
    }

    if (typeof event.timestamp === "string") {
      completedAt = event.timestamp;
    }
  }

  return {
    runId,
    kind: inferLogFileKind(fileName, events),
    totalEvents: events.length,
    startedAt,
    completedAt,
    eventTypeCounts: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
  };
}

export function inferLogFileKind(fileName: string, events: LogEvent[]): LogFileKind {
  if (fileName.startsWith("agx-run-")) {
    return "run";
  }

  if (fileName.startsWith("agx-chat-")) {
    return "chat";
  }

  const runStarted = events.find((event) => event.type === "run_started");
  if (runStarted?.initialState && typeof runStarted.initialState === "object") {
    const turnMode = (runStarted.initialState as Record<string, unknown>).turnMode;
    if (typeof turnMode === "string" && turnMode.length > 0) {
      return "chat";
    }
  }

  return "unknown";
}

export function resolveLogFilePath(logDirectory: string, requestedFileName: string): string | null {
  if (!requestedFileName || requestedFileName.includes("/") || requestedFileName.includes("\\")) {
    return null;
  }

  const resolvedPath = path.resolve(logDirectory, requestedFileName);
  const normalizedDirectory = `${path.resolve(logDirectory)}${path.sep}`;

  if (resolvedPath !== path.resolve(logDirectory, requestedFileName)) {
    return null;
  }

  if (!resolvedPath.startsWith(normalizedDirectory) && resolvedPath !== path.resolve(logDirectory)) {
    return null;
  }

  return resolvedPath;
}
