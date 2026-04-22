import path from "node:path";

export type LogViewerCliOptions = {
  port: number;
  logDirectory: string;
};

const DEFAULT_PORT = 3789;

export function parseLogViewerOptions(argv: string[]): LogViewerCliOptions {
  let port = DEFAULT_PORT;
  let logDirectory = path.resolve(process.cwd(), "logs");

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const [flag, inlineValue] = splitInlineFlag(current);

    if (flag === "--port") {
      const value = inlineValue ?? argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("CLI 参数 --port 缺少值");
      }

      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`非法端口号: ${value}`);
      }

      port = parsedPort;
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (flag === "--log-dir") {
      const value = inlineValue ?? argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("CLI 参数 --log-dir 缺少值");
      }

      logDirectory = path.resolve(value);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    throw new Error(`不支持的 CLI 参数: ${flag}`);
  }

  return { port, logDirectory };
}

function splitInlineFlag(arg: string): [string, string | undefined] {
  const equalIndex = arg.indexOf("=");
  if (equalIndex === -1) {
    return [arg, undefined];
  }

  return [arg.slice(0, equalIndex), arg.slice(equalIndex + 1)];
}
