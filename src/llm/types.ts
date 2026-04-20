import type { MathToolDecision } from "../math.js";

export interface MathModelProvider {
  chooseMathTool(input: string): Promise<MathToolDecision>;
}
