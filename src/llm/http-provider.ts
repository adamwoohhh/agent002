import type { MathModelProvider, ModelMessage, ModelResponse, ModelTool } from "./types.js";

type HttpCompatibleTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;
    strict?: boolean;
  };
};

type ChatCompletionToolCall = {
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
  }>;
};

export class HttpChatCompletionsProvider implements MathModelProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor() {
    this.endpoint = resolveHttpProviderEndpoint();
    this.apiKey = process.env.AGX_HTTP_API_KEY?.trim() || process.env.AGX_API_KEY?.trim() || "";
    this.model = process.env.AGX_HTTP_MODEL?.trim() || process.env.AGX_MODEL?.trim() || "gpt-4.1";
    this.timeoutMs = Number(process.env.AGX_HTTP_TIMEOUT_MS?.trim() || "30000");

    if (!this.endpoint) {
      throw new Error("缺少 AGX_HTTP_URL，无法初始化 http provider。");
    }

    if (!this.apiKey) {
      throw new Error("缺少 AGX_HTTP_API_KEY，且未回退到 AGX_API_KEY，无法初始化 http provider。");
    }
  }

  async generate(params: {
    messages: ModelMessage[];
    tools?: ModelTool[];
  }): Promise<ModelResponse> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}?ak=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stream: false,
          model: this.model,
          messages: params.messages,
          tools: params.tools?.map<HttpCompatibleTool>((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: tool.strict,
            },
          })),
          tool_choice: params.tools ? "auto" : undefined,
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`http provider 请求超时（${this.timeoutMs}ms）`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`http provider 调用失败 (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const message = payload.choices?.[0]?.message;
    const functionCall = message?.tool_calls?.[0]?.function;

    return {
      text: message?.content?.trim() || "",
      toolCall:
        functionCall?.name && functionCall.arguments
          ? {
              name: functionCall.name,
              arguments: functionCall.arguments,
            }
          : undefined,
    };
  }
}

function resolveHttpProviderEndpoint(): string {
  const explicitUrl = process.env.AGX_HTTP_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const baseUrl = process.env.AGX_BASE_URL?.trim();
  if (!baseUrl) {
    return "";
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("chat/completions", normalizedBaseUrl).toString();
}
