export {
  BinaryOperationArgsSchema,
  type MathToolDecision,
  type Operation,
} from "./domain/math/types.js";
export {
  add,
  divide,
  mathOperations as toolImplementations,
  multiply,
  normalizeMathInput as normalizeInput,
  operationSymbolMap as TOOL_SYMBOL_MAP,
  subtract,
} from "./domain/math/operations.js";
export { createMathTools, TOOL_NAME_TO_OPERATION, toolParameterSchema } from "./application/math-agent/tools/math-tools.js";
export { mathToolSystemPrompt } from "./application/math-agent/prompts/math-prompts.js";
