import { runCli } from "./app/cli/run-cli.js";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "启动失败";
  console.error(message);
  process.exit(1);
}
