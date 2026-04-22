import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseLogViewerOptions } from "../../src/tools/log-viewer/parse-log-viewer-options.js";

test("parseLogViewerOptions uses defaults", () => {
  const options = parseLogViewerOptions([]);

  assert.equal(options.port, 3789);
  assert.equal(options.logDirectory, path.resolve(process.cwd(), "logs"));
});

test("parseLogViewerOptions accepts inline and positional flag values", () => {
  const options = parseLogViewerOptions(["--port=4010", "--log-dir", "./custom-logs"]);

  assert.equal(options.port, 4010);
  assert.equal(options.logDirectory, path.resolve("./custom-logs"));
});

test("parseLogViewerOptions validates unsupported or invalid flags", () => {
  assert.throws(() => parseLogViewerOptions(["--unknown"]), /不支持的 CLI 参数/);
  assert.throws(() => parseLogViewerOptions(["--port"]), /缺少值/);
  assert.throws(() => parseLogViewerOptions(["--port=-1"]), /非法端口号/);
});
