import OpenAI from "openai";

import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "./types.js";

export class OpenAIResponsesProvider implements MathModelProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.AGX_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("缺少 AGX_API_KEY，无法初始化 openai provider。");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.AGX_BASE_URL?.trim() || undefined,
    });
    this.model = process.env.AGX_MODEL?.trim() || "gpt-4.1";
  }

  async generate(params: {
    messages: ModelMessage[];
    tools?: ModelTool[];
  }): Promise<ModelResponse> {
    const response = await this.client.responses.create({
      model: this.model,
      input: params.messages.map((message) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }],
      })),
      tools: params.tools?.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict ?? null,
      })),
    });

    const functionCall = response.output.find((item) => item.type === "function_call");
    return {
      text: response.output_text || "",
      toolCall:
        functionCall && "name" in functionCall && "arguments" in functionCall
          ? {
              name: functionCall.name,
              arguments: functionCall.arguments,
            }
          : undefined,
    };
  }
}
