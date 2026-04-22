import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { handleLogViewerRequest } from "../../src/tools/log-viewer/log-viewer-server.js";

test("log viewer server exposes file list and file detail", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "log-viewer-server-"));
  const logsDir = path.join(tempRoot, "logs");
  await mkdir(logsDir);

  const fileName = "agx-run-demo.jsonl";
  await writeFile(
    path.join(logsDir, fileName),
    [
      '{"sequence":0,"type":"run_started","timestamp":"2026-04-22T07:57:10.549Z","runId":"demo-run"}',
      '{"sequence":1,"type":"graph_event","timestamp":"2026-04-22T07:57:11.000Z","mode":"tasks"}',
    ].join("\n"),
    "utf8",
  );

  try {
    const listResponse = await invokeHandler("/api/log-files", logsDir);
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.body.files.length, 1);
    assert.equal(listResponse.body.files[0].name, fileName);

    const detailResponse = await invokeHandler(`/api/log-files/${encodeURIComponent(fileName)}`, logsDir);
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.body.summary.runId, "demo-run");
    assert.equal(detailResponse.body.events.length, 2);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("log viewer server returns 404 for missing files and 400 for invalid paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "log-viewer-server-"));
  const logsDir = path.join(tempRoot, "logs");
  await mkdir(logsDir);

  try {
    const notFoundResponse = await invokeHandler("/api/log-files/missing.jsonl", logsDir);
    assert.equal(notFoundResponse.statusCode, 404);

    const invalidResponse = await invokeHandler(`/api/log-files/${encodeURIComponent("../secret.txt")}`, logsDir);
    assert.equal(invalidResponse.statusCode, 400);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function invokeHandler(url: string, logDirectory: string): Promise<{ statusCode: number; body: any }> {
  const request = {
    method: "GET",
    url,
  } as IncomingMessage;

  const response = createMockResponse();
  await handleLogViewerRequest(request, response as unknown as ServerResponse, { logDirectory });

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body),
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(statusCode: number, headers: Record<string, string>) {
      this.statusCode = statusCode;
      this.headers = headers;
      return this;
    },
    end(chunk?: string) {
      this.body = chunk ?? "";
      return this;
    },
  };
}
