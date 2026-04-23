import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../llm/types.js";
import type { TelemetryWriter } from "./telemetry-writer.js";
import { createEventId } from "./event-tree.js";

export async function generateWithLogging(params: {
  provider: MathModelProvider;
  logger?: TelemetryWriter;
  parentEventId?: string;
  purpose: string;
  messages: ModelMessage[];
  tools?: ModelTool[];
}): Promise<ModelResponse> {
  try {
    const response = await params.provider.generate({
      messages: params.messages,
      tools: params.tools,
    });

    await params.logger?.write({
      type: "model_call",
      timestamp: new Date().toISOString(),
      runId: params.logger.runId,
      eventId: createEventId(),
      parentEventId: params.parentEventId,
      purpose: params.purpose,
      input: summarizeModelInput(params.messages, params.tools),
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      toolCall: response.toolCall,
    });

    return response;
  } catch (error) {
    await params.logger?.write({
      type: "model_call",
      timestamp: new Date().toISOString(),
      runId: params.logger.runId,
      eventId: createEventId(),
      parentEventId: params.parentEventId,
      purpose: params.purpose,
      input: summarizeModelInput(params.messages, params.tools),
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    throw error;
  }
}

function summarizeModelInput(messages: ModelMessage[], tools?: ModelTool[]) {
  return {
    messages: messages.map((message) => ({
      role: message.role,
      contentPreview:
        message.content.length > 200 ? `${message.content.slice(0, 200)}...` : message.content,
    })),
    tools: tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}
