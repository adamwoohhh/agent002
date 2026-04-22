import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listLogFiles,
  parseJsonlContent,
  resolveLogFilePath,
} from "../../src/tools/log-viewer/log-viewer-data.js";

test("parseJsonlContent parses valid events and builds summary", () => {
  const parsed = parseJsonlContent(
    [
      '{"sequence":0,"type":"run_started","timestamp":"2026-04-22T07:57:10.549Z","runId":"demo-run"}',
      "",
      '{"sequence":1,"type":"graph_event","timestamp":"2026-04-22T07:57:11.000Z","mode":"tasks"}',
      '{"sequence":2,"type":"run_completed","timestamp":"2026-04-22T07:57:12.000Z","runId":"demo-run"}',
    ].join("\n"),
    "agx-run-demo.jsonl",
  );

  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.parseErrors.length, 0);
  assert.equal(parsed.summary.runId, "demo-run");
  assert.equal(parsed.summary.kind, "run");
  assert.equal(parsed.summary.totalEvents, 3);
  assert.equal(parsed.summary.startedAt, "2026-04-22T07:57:10.549Z");
  assert.equal(parsed.summary.completedAt, "2026-04-22T07:57:12.000Z");
  assert.deepEqual(parsed.summary.eventTypeCounts, [
    { type: "graph_event", count: 1 },
    { type: "run_completed", count: 1 },
    { type: "run_started", count: 1 },
  ]);
});

test("parseJsonlContent keeps going when a line is malformed", () => {
  const parsed = parseJsonlContent(
    [
      '{"sequence":0,"type":"run_started","timestamp":"2026-04-22T07:57:10.549Z","runId":"demo-run"}',
      "{bad json",
      '{"sequence":2,"type":"run_completed","timestamp":"2026-04-22T07:57:12.000Z","runId":"demo-run"}',
    ].join("\n"),
    "agx-run-demo.jsonl",
  );

  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.parseErrors.length, 1);
  assert.equal(parsed.parseErrors[0]?.lineNumber, 2);
});

test("listLogFiles returns jsonl files with metadata and event counts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "log-viewer-data-"));
  const logsDir = path.join(tempRoot, "logs");

  try {
    await mkdir(logsDir);
    await writeFile(
      path.join(logsDir, "agx-run-demo.jsonl"),
      '{"sequence":0,"type":"run_started","timestamp":"2026-04-22T07:57:10.549Z","runId":"demo-run"}\n',
      "utf8",
    );

    const files = await listLogFiles(logsDir);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.name, "agx-run-demo.jsonl");
    assert.equal(files[0]?.kind, "run");
    assert.equal(files[0]?.eventCount, 1);
    assert.equal(files[0]?.path, path.join(logsDir, "agx-run-demo.jsonl"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("resolveLogFilePath rejects path traversal", () => {
  const logDir = path.resolve("/tmp/example-logs");

  assert.equal(resolveLogFilePath(logDir, "agx-run-demo.jsonl"), path.join(logDir, "agx-run-demo.jsonl"));
  assert.equal(resolveLogFilePath(logDir, "../secrets.txt"), null);
  assert.equal(resolveLogFilePath(logDir, "nested/file.jsonl"), null);
});
