import { config as loadEnv } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { createAgentApp } from "../create-agent-app.js";
import { parseCliOptions } from "../../infrastructure/config/cli.js";
import { resolveAppConfig } from "../../infrastructure/config/app-config.js";

export async function runCli(argv: string[]): Promise<void> {
  // 加载环境变量
  loadEnv({ path: ".env.local" });

  // 解析命令行参数
  const cliOptions = parseCliOptions(argv);
  // 解析应用配置
  const config = resolveAppConfig(process.env, cliOptions);
  // 创建应用实例
  const app = createAgentApp(config);

  // 如果命令行参数没有指定输入，进入交互式模式
  if (!cliOptions.input) {
    await runInteractiveChat(app);
    return;
  }

  const result = await app.run(cliOptions.input);
  console.log(`\n=== 输入: ${cliOptions.input} ===`);
  console.log(result.output);
}

async function runInteractiveChat(app: ReturnType<typeof createAgentApp>) {
  const rl = createInterface({ input, output });
  const session = app.createSession();

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
    await session.close();
    rl.close();
  }
}
