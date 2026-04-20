import OpenAI from "openai";

import {
  BinaryOperationArgsSchema,
  createMathTools,
  mathToolSystemPrompt,
  TOOL_NAME_TO_OPERATION,
  type MathToolDecision,
  type Operation,
} from "../math.js";
import type { MathModelProvider } from "./types.js";

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

  async chooseMathTool(input: string): Promise<MathToolDecision> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: mathToolSystemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: input }],
        },
      ],
      tools: createMathTools(),
    });

    const functionCall = response.output.find((item) => item.type === "function_call");
    if (!functionCall || !("name" in functionCall) || !("arguments" in functionCall)) {
      return {
        canSolve: false,
        reason:
          response.output_text ||
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
