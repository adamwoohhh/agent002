import path from "node:path";

import { createLogViewerServer } from "./log-viewer/log-viewer-server.js";
import { parseLogViewerOptions } from "./log-viewer/parse-log-viewer-options.js";

async function main() {
  const options = parseLogViewerOptions(process.argv.slice(2));
  const server = createLogViewerServer({ logDirectory: options.logDirectory });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      const directoryLabel = path.relative(process.cwd(), options.logDirectory) || ".";
      console.log(`Log viewer 已启动: http://127.0.0.1:${options.port}`);
      console.log(`日志目录: ${directoryLabel}`);
      resolve();
    });
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "启动日志查看器失败";
  console.error(message);
  process.exit(1);
}
