import test from "node:test";
import assert from "node:assert/strict";

import { HttpChatCompletionsProvider } from "../../src/llm/http-provider.js";
import { chooseMathTool } from "../../src/llm/math-workflow.js";

type EnvSnapshot = NodeJS.ProcessEnv;

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const originalEnv: EnvSnapshot = { ...process.env };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = originalEnv;
    });
}

test("http provider sends compatible tool-calling request and parses tool result", async () => {
  await withEnv(
    {
      AGX_API_KEY: "test-key",
      AGX_MODEL: "test-model",
      AGX_BASE_URL: "https://example.com/v1",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      let seenUrl = "";
      let seenBody = "";

      globalThis.fetch = (async (input, init) => {
        seenUrl = String(input);
        seenBody = String(init?.body);

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "multiply",
                        arguments: JSON.stringify({ left: 7, right: 9 }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      try {
        const provider = new HttpChatCompletionsProvider();
        const decision = await chooseMathTool(provider, "7 乘 9");

        const requestUrl = new URL(seenUrl);
        assert.equal(requestUrl.origin, "https://example.com");
        assert.equal(requestUrl.pathname, "/v1/chat/completions");

        const body = JSON.parse(seenBody);
        assert.equal(body.model, "test-model");
        assert.equal(body.tool_choice, "auto");
        assert.equal(body.tools[0].type, "function");
        assert.equal(body.tools[0].function.name, "add");
        assert.deepEqual(decision, {
          kind: "solve",
          operation: "multiply",
          operands: [7, 9],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("http provider returns unsupported reason when model skips tool call", async () => {
  await withEnv(
    {
      AGX_API_KEY: "test-key",
      AGX_BASE_URL: "https://example.com/v1",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "这个问题超出当前能力范围",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      try {
        const provider = new HttpChatCompletionsProvider();
        const decision = await chooseMathTool(provider, "先加再乘");
        assert.deepEqual(decision, {
          kind: "reject",
          reason: "这个问题超出当前能力范围",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("http provider returns clarify question when model asks for missing information", async () => {
  await withEnv(
    {
      AGX_API_KEY: "test-key",
      AGX_BASE_URL: "https://example.com/v1",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "CLARIFY: 你早上吃了几个苹果？",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      try {
        const provider = new HttpChatCompletionsProvider();
        const decision = await chooseMathTool(
          provider,
          "冰箱里有 3 个苹果，早上我吃了苹果，还剩下几个苹果",
        );
        assert.deepEqual(decision, {
          kind: "clarify",
          question: "你早上吃了几个苹果？",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});

test("http provider request timeout fails with stable error", async () => {
  await withEnv(
    {
      AGX_API_KEY: "test-key",
      AGX_BASE_URL: "https://example.com/v1",
      AGX_HTTP_TIMEOUT_MS: "5",
    },
    async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }) as typeof fetch;

      try {
        const provider = new HttpChatCompletionsProvider();
        await assert.rejects(() => chooseMathTool(provider, "18 除以 3"), /请求超时（5ms）/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
});
