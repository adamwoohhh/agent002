import { config as loadEnv } from "dotenv";

import { runMathAgent } from "./agent.js";
import { applyCliOverrides } from "./config.js";
import { createMathModelProvider } from "./llm/index.js";

// 加载环境变量
loadEnv({ path: ".env.local" });

let cliInput = "";

try {
  const parsed = applyCliOverrides(process.argv.slice(2));
  cliInput = parsed.input;
} catch (error) {
  const message = error instanceof Error ? error.message : "CLI 参数解析失败";
  console.error(message);
  process.exit(1);
}

let mathModelProvider: ReturnType<typeof createMathModelProvider>;

try {
  mathModelProvider = createMathModelProvider();
} catch (error) {
  const message = error instanceof Error ? error.message : "模型 provider 初始化失败";
  console.error(message);
  process.exit(1);
}

if (!cliInput) {
  console.error(
    '请通过命令行传入一个数学问题，例如：npm run dev -- --provider=openai "请帮我算一下 12 加 8"',
  );
  process.exit(1);
}

const result = await runMathAgent(cliInput, mathModelProvider);

console.log(`\n=== 输入: ${cliInput} ===`);
console.log(result);
