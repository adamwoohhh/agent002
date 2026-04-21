import { config as loadEnv } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { MathChatSession, runMathAgent } from "./agent.js";
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
  await runInteractiveChat(mathModelProvider);
  process.exit(0);
}

const result = await runMathAgent(cliInput, mathModelProvider);

console.log(`\n=== 输入: ${cliInput} ===`);
console.log(result);

async function runInteractiveChat(provider: NonNullable<typeof mathModelProvider>) {
  const rl = createInterface({ input, output });
  const session = new MathChatSession(provider);

  console.log("进入多轮数学对话模式，输入 exit 或 quit 结束。");

  try {
    while (true) {
      const userInput = (await rl.question("\n你> ")).trim();
      if (!userInput) {
        continue;
      }

      if (["exit", "quit"].includes(userInput.toLowerCase())) {
        console.log("已结束对话。");
        break;
      }

      const result = await session.respond(userInput);
      console.log(`助手> ${result}`);
    }
  } finally {
    rl.close();
  }
}
