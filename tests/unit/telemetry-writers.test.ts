import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveAppConfig } from "../../src/infrastructure/config/app-config.js";
import { CompositeTelemetryWriter } from "../../src/infrastructure/observability/composite-telemetry-writer.js";
import type { FornaxTracerLike } from "../../src/infrastructure/observability/fornax-telemetry-runtime.js";
import { FornaxTelemetryWriter } from "../../src/infrastructure/observability/fornax-telemetry-writer.js";
import { LocalJsonlTelemetryWriter } from "../../src/infrastructure/observability/local-jsonl-telemetry-writer.js";
import type { TelemetryEvent, TelemetryWriter } from "../../src/infrastructure/observability/telemetry-writer.js";

test("LocalJsonlTelemetryWriter preserves jsonl event contract", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "local-jsonl-telemetry-"));

  try {
    const writer = await LocalJsonlTelemetryWriter.create({
      runId: "run-1",
      prefix: "agx-run",
      logDirectory: tempRoot,
    });

    await writer.runStarted({
      type: "run_started",
      timestamp: "2026-04-23T00:00:00.000Z",
      runId: writer.runId,
      eventId: "root",
      input: "12 加 8",
    });

    const content = await readFile(writer.filePath, "utf8");
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.sequence, 0);
    assert.equal(parsed.recordType, "span_event");
    assert.equal(parsed.stage, "start");
    assert.equal(parsed.type, "run_started");
    assert.equal(parsed.name, "agent_run");
    assert.equal(parsed.spanType, "agent");
    assert.equal(parsed.spanId, "root");
    assert.equal(parsed.runId, "run-1");
    assert.equal(parsed.eventId, "root");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CompositeTelemetryWriter writes to every sink and swallows sink failures", async () => {
  const seenEvents: TelemetryEvent[] = [];
  const goodSink: TelemetryWriter = {
    runId: "run-1",
    async runStarted(event) {
      seenEvents.push(event);
    },
    async runCompleted() {},
    async runFailed() {},
    async sessionEvent(event) {
      seenEvents.push(event);
    },
    async graphEvent() {},
    async modelCall() {},
    async policyRejected() {},
    async runtimeTaskCompleted() {},
    async flush() {
      seenEvents.push({ type: "flush", timestamp: "now" });
    },
  };
  const badSink: TelemetryWriter = {
    runId: "run-1",
    async runStarted() {
      throw new Error("sink failed");
    },
    async runCompleted() {},
    async runFailed() {},
    async sessionEvent() {
      throw new Error("sink failed");
    },
    async graphEvent() {},
    async modelCall() {},
    async policyRejected() {},
    async runtimeTaskCompleted() {},
  };

  const writer = new CompositeTelemetryWriter("run-1", undefined, [goodSink, badSink]);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await writer.sessionEvent({
      type: "session_event",
      timestamp: "2026-04-23T00:00:00.000Z",
      runId: "run-1",
    });
    await writer.flush();
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(seenEvents[0]?.type, "session_event");
  assert.equal(seenEvents[1]?.type, "flush");
});

test("FornaxTelemetryWriter maps event tree into nested spans and records usage", async () => {
  const started: FakeSpan[] = [];
  const tracer = createFakeTracer(started);
  const config = resolveAppConfig({
    FORNAX_AK: "ak-demo",
    FORNAX_SK: "sk-demo",
  });
  const writer = new FornaxTelemetryWriter("run-1", config, tracer as unknown as FornaxTracerLike);

  await writer.runStarted({
    type: "run_started",
    timestamp: "2026-04-23T00:00:00.000Z",
    runId: "run-1",
    eventId: "root",
    input: "12 加 8",
    phase: "direct_run",
  });
  assert.equal(started[0]?.ended, true);
  await writer.modelCall({
    type: "model_call",
    timestamp: "2026-04-23T00:00:01.000Z",
    runId: "run-1",
    eventId: "model-1",
    parentEventId: "graph-1",
    purpose: "choose_math_tool",
    input: { messages: [{ role: "user", contentPreview: "12 加 8" }] },
    provider: "stub",
    model: "stub-model",
    usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, totalTokens: 15 },
  });
  await writer.graphEvent({
    type: "graph_event",
    timestamp: "2026-04-23T00:00:02.000Z",
    runId: "run-1",
    eventId: "graph-1",
    parentEventId: "root",
    event: "node_execution",
    node: "decideIntent",
    input: { normalizedInput: "12 加 8" },
    output: { operation: "add" },
  });
  await writer.runCompleted({
    type: "run_completed",
    timestamp: "2026-04-23T00:00:03.000Z",
    runId: "run-1",
    parentEventId: "root",
    finalAnswer: "12 + 8 = 20",
    phase: "direct_run",
  });
  await writer.flush();
  await writer.shutdown();

  assert.equal(tracer.initializeCalls.length, 1);
  assert.equal(started.length, 3);
  assert.equal(started[0]?.name, "agent_run");
  assert.equal(started[1]?.name, "graph:decideIntent");
  assert.equal(started[1]?.parent, started[0]);
  assert.equal(started[2]?.name, "model:choose_math_tool");
  assert.equal(started[2]?.parent, started[1]);
  assert.deepEqual((started[2]?.output as { usage?: unknown } | undefined)?.usage, {
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 2,
    totalTokens: 15,
  });
  assert.equal(started[2]?.tags.input_tokens, 10);
  assert.equal(started[2]?.tags.output_tokens, 5);
  assert.equal(started[2]?.tags.reasoning_tokens, 2);
  assert.equal(started[2]?.tags.tokens, 15);
  assert.equal(tracer.forceFlushCalls, 1);
  assert.equal(tracer.shutdownCalls, 1);
});

type FakeSpan = {
  name: string;
  type: string;
  parent?: FakeSpan;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  tags: Record<string, unknown>;
  ended: boolean;
  setInput(value: unknown): FakeSpan;
  setOutput(value: unknown): FakeSpan;
  setError(error: unknown): FakeSpan;
  setTag(key: string, value: unknown): FakeSpan;
  setTags(tags: Record<string, unknown>): FakeSpan;
  setFornaxCommonTags(tags: Record<string, unknown>): FakeSpan;
  end(): void;
};

function createFakeTracer(started: FakeSpan[]) {
  return {
    initializeCalls: [] as unknown[],
    forceFlushCalls: 0,
    shutdownCalls: 0,
    initialize(options: unknown) {
      this.initializeCalls.push(options);
    },
    startSpan(options: { name: string; type: string; parent?: FakeSpan }) {
      const span: FakeSpan = {
        name: options.name,
        type: options.type,
        parent: options.parent,
        tags: {},
        ended: false,
        setInput(value) {
          this.input = value;
          return this;
        },
        setOutput(value) {
          this.output = value;
          return this;
        },
        setError(error) {
          this.error = error;
          return this;
        },
        setTag(key, value) {
          this.tags[key] = value;
          return this;
        },
        setTags(tags) {
          Object.assign(this.tags, tags);
          return this;
        },
        setFornaxCommonTags(tags) {
          Object.assign(this.tags, tags);
          return this;
        },
        end() {
          this.ended = true;
        },
      };

      started.push(span);
      return span;
    },
    async forceFlush() {
      this.forceFlushCalls += 1;
    },
    async shutdown() {
      this.shutdownCalls += 1;
    },
  };
}
