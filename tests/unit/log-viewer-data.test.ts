import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildEventTree,
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
  assert.equal(parsed.eventTree.length, 3);
});

test("buildEventTree nests child events under parent event ids", () => {
  const tree = buildEventTree([
    { sequence: 0, type: "run_started", eventId: "root" },
    { sequence: 1, type: "session_event", eventId: "session-1", parentEventId: "root" },
    { sequence: 2, type: "graph_event", eventId: "graph-1", parentEventId: "session-1" },
    { sequence: 3, type: "model_call", eventId: "model-1", parentEventId: "graph-1" },
  ]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.event.eventId, "root");
  assert.equal(tree[0]?.children[0]?.event.eventId, "session-1");
  assert.equal(tree[0]?.children[0]?.children[0]?.event.eventId, "graph-1");
  assert.equal(tree[0]?.children[0]?.children[0]?.children[0]?.event.eventId, "model-1");
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

test("parseJsonlContent normalizes span_event jsonl into viewer events", () => {
  const parsed = parseJsonlContent(
    [
      '{"sequence":0,"recordType":"span_event","stage":"start","timestamp":"2026-04-22T07:57:10.549Z","runId":"demo-run","spanId":"root","name":"agent_run","spanType":"agent","status":"open","type":"run_started"}',
      '{"sequence":1,"recordType":"span_event","stage":"instant","timestamp":"2026-04-22T07:57:11.000Z","runId":"demo-run","spanId":"graph-1","parentSpanId":"root","name":"graph:decideIntent","spanType":"agent","status":"completed","type":"graph_event"}',
      '{"sequence":2,"recordType":"span_event","stage":"end","timestamp":"2026-04-22T07:57:12.000Z","runId":"demo-run","spanId":"root","name":"agent_run","spanType":"agent","status":"completed","type":"run_completed","output":{"finalAnswer":"20"}}',
    ].join("\n"),
    "agx-run-demo.jsonl",
  );

  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0]?.eventId, "root");
  assert.equal(parsed.events[0]?.name, "agent_run");
  assert.equal(parsed.events[0]?.status, "completed");
  assert.deepEqual(parsed.events[0]?.output, { finalAnswer: "20" });
  assert.equal(parsed.eventTree.length, 1);
  assert.equal(parsed.eventTree[0]?.children[0]?.event.name, "graph:decideIntent");
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
