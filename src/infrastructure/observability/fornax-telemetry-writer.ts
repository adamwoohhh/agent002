import { SpanKind } from "@next-ai/fornax-sdk/tracer";

import type { AppConfig } from "../config/app-config.js";
import { sanitizeForJsonl } from "./local-jsonl-telemetry-writer.js";
import { FornaxTelemetryRuntime, type FornaxSpanLike, type FornaxTracerLike } from "./fornax-telemetry-runtime.js";
import type { TelemetryEvent, TelemetryWriter } from "./telemetry-writer.js";

export class FornaxTelemetryWriter implements TelemetryWriter {
  private readonly runtime: FornaxTelemetryRuntime;
  private readonly spansByEventId = new Map<string, FornaxSpanLike>();
  private readonly pendingEventsByParentId = new Map<string, TelemetryEvent[]>();
  private rootEventId: string | null = null;

  constructor(
    readonly runId: string,
    config: AppConfig,
    tracer?: FornaxTracerLike,
  ) {
    this.runtime = new FornaxTelemetryRuntime(config, tracer);
  }

  async write(event: TelemetryEvent): Promise<void> {
    if (!this.runtime.isEnabled()) {
      return;
    }

    if (event.type === "run_started") {
      this.handleRunStarted(event);
      return;
    }

    if (event.type === "run_completed" || event.type === "run_failed") {
      this.handleRunFinished(event);
      return;
    }

    const parentSpan = this.resolveParentSpan(event.parentEventId);
    if (event.parentEventId && !parentSpan) {
      this.enqueuePendingEvent(event.parentEventId, event);
      return;
    }

    this.createAndRecordChildSpan(event, parentSpan);
  }

  async flush(): Promise<void> {
    await this.runtime.flush();
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
    this.spansByEventId.clear();
    this.pendingEventsByParentId.clear();
    this.rootEventId = null;
  }

  private handleRunStarted(event: TelemetryEvent): void {
    const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
    const span = this.runtime.startSpan({
      name: "agent_run",
      type: SpanKind.Agent,
      threadId: this.runId,
      baggage: buildBaggage(event, this.runId),
    });

    if (!span) {
      return;
    }

    span
      .setTags(buildTags(event))
      .setInput({
        input: event.input,
        phase: event.phase,
        stateBeforeTurn: event.stateBeforeTurn,
        initialContext: event.initialContext,
      });

    if (eventId) {
      this.spansByEventId.set(eventId, span);
      this.rootEventId = eventId;
      this.flushPendingChildren(eventId);
    }
  }

  private handleRunFinished(event: TelemetryEvent): void {
    const rootEventId = typeof event.parentEventId === "string" ? event.parentEventId : this.rootEventId ?? undefined;
    const rootSpan = rootEventId ? this.spansByEventId.get(rootEventId) : undefined;
    if (!rootSpan) {
      return;
    }

    rootSpan.setTags(buildTags(event));

    if (event.type === "run_failed") {
      rootSpan.setError(event.error ?? "run_failed");
    } else {
      rootSpan.setOutput({
        finalAnswer: event.finalAnswer,
        finalState: event.finalState,
        phase: event.phase,
      });
    }

    rootSpan.end();
  }

  private createAndRecordChildSpan(event: TelemetryEvent, parent?: FornaxSpanLike): void {
    const span = this.runtime.startSpan({
      name: getSpanName(event),
      type: getSpanKind(event),
      parent,
      threadId: this.runId,
      baggage: buildBaggage(event, this.runId),
    });

    if (!span) {
      return;
    }

    const details = getSpanDetails(event);

    span.setTags({
      ...buildTags(event),
      ...details.tags,
    });

    if (details.input !== undefined) {
      span.setInput(details.input);
    }

    if (event.error !== undefined) {
      span.setError(event.error);
    } else if (details.output !== undefined) {
      span.setOutput(details.output);
    }

    span.end();

    if (typeof event.eventId === "string") {
      this.spansByEventId.set(event.eventId, span);
      this.flushPendingChildren(event.eventId);
    }
  }

  private resolveParentSpan(parentEventId: string | undefined): FornaxSpanLike | undefined {
    if (!parentEventId) {
      return undefined;
    }

    return this.spansByEventId.get(parentEventId);
  }

  private enqueuePendingEvent(parentEventId: string, event: TelemetryEvent): void {
    const pendingEvents = this.pendingEventsByParentId.get(parentEventId) ?? [];
    pendingEvents.push(event);
    this.pendingEventsByParentId.set(parentEventId, pendingEvents);
  }

  private flushPendingChildren(parentEventId: string): void {
    const pendingEvents = this.pendingEventsByParentId.get(parentEventId);
    if (!pendingEvents?.length) {
      return;
    }

    this.pendingEventsByParentId.delete(parentEventId);
    const parentSpan = this.spansByEventId.get(parentEventId);
    for (const pendingEvent of pendingEvents) {
      this.createAndRecordChildSpan(pendingEvent, parentSpan);
    }
  }
}

function getSpanName(event: TelemetryEvent): string {
  if (event.type === "session_event") {
    return `session:${String(event.event ?? "unknown")}`;
  }

  if (event.type === "graph_event") {
    return `graph:${String(event.node ?? "unknown")}`;
  }

  if (event.type === "model_call") {
    return `model:${String(event.purpose ?? "unknown")}`;
  }

  return String(event.type);
}

function getSpanKind(event: TelemetryEvent): string {
  if (event.type === "model_call") {
    return SpanKind.Model;
  }

  if (event.type === "graph_event") {
    switch (event.node) {
      case "decideIntent":
        return SpanKind.Agent;
      case "executeOperation":
        return SpanKind.Tool;
      case "renderAnswer":
        return SpanKind.Prompt;
      default:
        return "custom";
    }
  }

  if (event.type === "run_started") {
    return SpanKind.Agent;
  }

  return "custom";
}

function getSpanDetails(event: TelemetryEvent): {
  input?: unknown;
  output?: unknown;
  tags?: Record<string, unknown>;
} {
  if (event.type === "session_event") {
    switch (event.event) {
      case "turn_mode_resolved":
        return {
          input: {
            input: event.input,
            stateBeforeTurn: event.stateBeforeTurn,
          },
          output: {
            turnMode: event.turnMode,
          },
        };
      case "conversation_input_analyzed":
        return {
          input: {
            input: event.input,
            turnMode: event.turnMode,
          },
          output: event.analysis,
        };
      case "graph_execution":
        return {
          input: {
            input: event.input,
            phase: event.phase,
            stateBeforeGraph: event.stateBeforeGraph,
            context: event.context,
          },
        };
      case "conversation_state_updated":
        return {
          input: {
            input: event.input,
            answer: event.answer,
          },
          output: event.stateAfterTurn,
        };
      default:
        return {
          input: {
            input: event.input,
          },
          output: sanitizeForJsonl(event),
        };
    }
  }

  if (event.type === "graph_event") {
    return {
      input: event.input,
      output: event.output,
    };
  }

  if (event.type === "model_call") {
    const usage = normalizeUsage(event.usage);
    return {
      input: {
        purpose: event.purpose,
        request: event.input,
      },
      output: {
        provider: event.provider,
        model: event.model,
        usage,
        toolCall: event.toolCall,
      },
      tags: {
        usage_input_tokens: usage?.inputTokens,
        usage_output_tokens: usage?.outputTokens,
        usage_total_tokens: usage?.totalTokens,
      },
    };
  }

  return {
    output: sanitizeForJsonl(event),
  };
}

function buildBaggage(event: TelemetryEvent, runId: string): Record<string, unknown> {
  return {
    run_id: runId,
    thread_id: runId,
    event_type: event.type,
    node: event.node,
    purpose: event.purpose,
    phase: event.phase,
  };
}

function buildTags(event: TelemetryEvent): Record<string, unknown> {
  return {
    run_id: event.runId,
    event_type: event.type,
    event_name: event.event,
    node: event.node,
    purpose: event.purpose,
    phase: event.phase,
  };
}

function normalizeUsage(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  return {
    inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
    outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
    totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
  };
}
