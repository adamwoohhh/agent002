import { SpanKind } from "@next-ai/fornax-sdk/tracer";

import type { TelemetryEvent } from "./telemetry-writer.js";

export type LocalSpanStage = "start" | "instant" | "end";

export type LocalSpanRecord = {
  recordType: "span_event";
  stage: LocalSpanStage;
  timestamp: string;
  runId?: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  spanType: string;
  status: "open" | "completed" | "failed";
  input?: unknown;
  output?: unknown;
  error?: unknown;
  tags: Record<string, unknown>;
  baggage: Record<string, unknown>;
  type?: string;
  event?: unknown;
  node?: unknown;
  purpose?: unknown;
  phase?: unknown;
  mode?: unknown;
  eventId?: string;
  parentEventId?: string;
};

export type SpanDescriptor = {
  name: string;
  spanType: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  tags: Record<string, unknown>;
  baggage: Record<string, unknown>;
};

export function resolveSpanDescriptor(event: TelemetryEvent, runId: string): SpanDescriptor {
  const details = getSpanDetails(event);
  return {
    name: getSpanName(event),
    spanType: getSpanKind(event),
    input: details.input,
    output: event.error !== undefined ? undefined : details.output,
    error: event.error,
    tags: {
      ...buildTags(event),
      ...details.tags,
    },
    baggage: buildBaggage(event, runId),
  };
}

export function getSpanName(event: TelemetryEvent): string {
  if (event.type === "session_event") {
    return `session:${String(event.event ?? "unknown")}`;
  }

  if (event.type === "graph_event") {
    return `graph:${String(event.node ?? "unknown")}`;
  }

  if (event.type === "model_call") {
    return `model:${String(event.purpose ?? "unknown")}`;
  }

  if (event.phase === "session_lifecycle") {
    return "math_session";
  }

  return "agent_run";
}

export function getSpanKind(event: TelemetryEvent): string {
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

  if (event.type === "run_started" || event.type === "run_completed" || event.type === "run_failed") {
    return SpanKind.Agent;
  }

  return "custom";
}

export function getSpanDetails(event: TelemetryEvent): {
  input?: unknown;
  output?: unknown;
  tags?: Record<string, unknown>;
} {
  if (event.type === "run_started") {
    return {
      input: {
        input: event.input,
        phase: event.phase,
        stateBeforeTurn: event.stateBeforeTurn,
        initialContext: event.initialContext,
      },
    };
  }

  if (event.type === "run_completed") {
    return {
      output: {
        finalAnswer: event.finalAnswer,
        finalState: event.finalState,
        phase: event.phase,
      },
    };
  }

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
          output: event,
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
        input_tokens: usage?.inputTokens,
        output_tokens: usage?.outputTokens,
        reasoning_tokens: usage?.reasoningTokens,
        tokens: usage?.totalTokens,
      },
    };
  }

  return {
    output: event,
  };
}

export function buildBaggage(event: TelemetryEvent, runId: string): Record<string, unknown> {
  return {
    run_id: runId,
    thread_id: runId,
    event_type: event.type,
    node: event.node,
    purpose: event.purpose,
    phase: event.phase,
  };
}

export function buildTags(event: TelemetryEvent): Record<string, unknown> {
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
    reasoningTokens: typeof usage.reasoningTokens === "number" ? usage.reasoningTokens : undefined,
    totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
  };
}
