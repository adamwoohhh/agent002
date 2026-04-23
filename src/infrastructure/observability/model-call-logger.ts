import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "../llm/types.js";
import type { RunLogger } from "./run-logger.js";
import { createEventId } from "./event-tree.js";

export async function generateWithLogging(params: {
  provider: MathModelProvider;
  logger?: RunLogger;
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
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    throw error;
  }
}
