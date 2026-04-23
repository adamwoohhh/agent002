import OpenAI from "openai";

import type { AppConfig } from "../config/app-config.js";
import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "./types.js";

export class OpenAIResponsesProvider implements MathModelProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: AppConfig = defaultConfig()) {
    const apiKey = config.provider.apiKey?.trim();
    if (!apiKey) {
      throw new Error("缺少 AGX_API_KEY，无法初始化 openai provider。");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: config.provider.baseUrl || undefined,
    });
    this.model = config.provider.model;
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
      provider: "openai",
      model: this.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      },
      raw: response,
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

function defaultConfig(): AppConfig {
  return {
    provider: {
      type: (process.env.AGX_PROVIDER?.trim().toLowerCase() as "openai" | "http") || "openai",
      apiKey: process.env.AGX_API_KEY?.trim(),
      model: process.env.AGX_MODEL?.trim() || "gpt-4.1",
      baseUrl: process.env.AGX_BASE_URL?.trim() || undefined,
      httpUrl: process.env.AGX_HTTP_URL?.trim() || undefined,
      httpApiKey: process.env.AGX_HTTP_API_KEY?.trim() || undefined,
      httpModel: process.env.AGX_HTTP_MODEL?.trim() || undefined,
      httpTimeoutMs: Number(process.env.AGX_HTTP_TIMEOUT_MS?.trim() || "30000"),
    },
    logging: {
      directory: process.env.AGX_LOG_DIR?.trim() || undefined,
    },
    observability: {
      fornaxAk: process.env.FORNAX_AK?.trim() || undefined,
      fornaxSk: process.env.FORNAX_SK?.trim() || undefined,
      fornaxAppName: process.env.FORNAX_APP_NAME?.trim() || "langgraph-ts-demo",
      fornaxProcessor: "batch",
      fornaxRecordInputs: true,
      fornaxRecordOutputs: true,
    },
  };
}
