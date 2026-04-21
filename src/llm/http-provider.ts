import {
  BinaryOperationArgsSchema,
  createMathTools,
  mathToolSystemPrompt,
  TOOL_NAME_TO_OPERATION,
  type MathToolDecision,
  type Operation,
} from "../math.js";
import { buildConversationPrompt, type ConversationMessage, type MathModelProvider } from "./types.js";

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

  async chooseMathTool(input: string, history: ConversationMessage[] = []): Promise<MathToolDecision> {
    const prompt = buildConversationPrompt(input, history);

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
          messages: [
            {
              role: "system",
              content: mathToolSystemPrompt,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          tools: createMathTools().map<HttpCompatibleTool>((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: tool.strict,
            },
          })),
          tool_choice: "auto",
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

    if (!functionCall?.name || !functionCall.arguments) {
      return {
        canSolve: false,
        reason:
          message?.content?.trim() ||
          "暂时只支持两个数字的一次加减乘除，例如：12 加 8、50 减 6、7 乘 9、20 除以 5。",
      };
    }

    const parsedArgs = BinaryOperationArgsSchema.safeParse(JSON.parse(functionCall.arguments));
    if (!parsedArgs.success) {
      return {
        canSolve: false,
        reason: "模型调用工具时传入了无效参数。",
      };
    }

    const operation = TOOL_NAME_TO_OPERATION[functionCall.name as Operation];
    if (!operation) {
      return {
        canSolve: false,
        reason: `模型选择了未知工具：${functionCall.name}`,
      };
    }

    return {
      canSolve: true,
      operation,
      operands: [parsedArgs.data.left, parsedArgs.data.right],
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
