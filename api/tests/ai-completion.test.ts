import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "isolated-ai-completion-test";

test("length completion continues from the exact partial answer and returns the full output", async (t) => {
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  const calls: any[] = [];
  const first = "完整中文和代码\n```bash\necho ".repeat(100);
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: calls.length === 1 ? first : "done\n```\n结尾",
            },
            finish_reason: calls.length === 1 ? "length" : "stop",
          },
        ],
      }),
    );
  });
  const provider = new OpenAICompatibleProvider(
    "test",
    "dummy-key",
    "test-model",
    "https://api.openai.com/v1",
  );
  const result = await provider.chatResult([{ role: "user", content: "解释" }]);
  assert.equal(result.content, first + "done\n```\n结尾");
  assert.equal(result.truncated, false);
  assert.equal(result.continuationCount, 1);
  assert.equal(calls[0].max_tokens, 8192);
  assert.equal(calls[1].messages[1].content, first);
});
test("continuations are bounded, retain partial text after failure and respect explicit token limits", async (t) => {
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "段落" }, finish_reason: "length" }],
      }),
    );
  });
  const provider = new OpenAICompatibleProvider(
    "test",
    "dummy",
    "model",
    "https://api.openai.com/v1",
  );
  assert.deepEqual(
    await provider.chatResult([{ role: "user", content: "test" }]),
    {
      content: "段落段落段落",
      truncated: true,
      finishReason: "length",
      continuationCount: 2,
    },
  );
  assert.equal(calls, 3);
  calls = 0;
  assert.equal(
    await provider.chat([{ role: "user", content: "check" }], { maxTokens: 8 }),
    "段落",
  );
  assert.equal(calls, 1);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 2)
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: "已生成内容" }, finish_reason: "length" },
          ],
        }),
      );
    throw new Error("provider unavailable");
  });
  assert.equal(
    (await provider.chatResult([{ role: "user", content: "test" }])).content,
    "已生成内容",
  );
});
test("empty thinking-only output is retried with a larger budget and never reported as an answer", async (t) => {
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  const budgets: number[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    budgets.push(JSON.parse(init.body).max_tokens);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: null }, finish_reason: "length" }],
      }),
    );
  });
  const provider = new OpenAICompatibleProvider(
    "test",
    "dummy",
    "model",
    "https://api.openai.com/v1",
  );
  await assert.rejects(
    provider.chat([{ role: "user", content: "test" }]),
    /推理过程耗尽/,
  );
  assert.deepEqual(budgets, [8192, 16384, 16384]);
});

test("structured text blocks are preserved and reasoning-only completions never appear as answers", async (t) => {
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message:
              count === 1
                ? { content: null, reasoning_content: "internal reasoning" }
                : {
                    content: [
                      { type: "reasoning", text: "hidden" },
                      { type: "text", text: "完整" },
                      { type: "text", text: "正文" },
                    ],
                  },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
  const provider = new OpenAICompatibleProvider(
    "test",
    "dummy",
    "test",
    "https://api.openai.com/v1",
  );
  const answer = await provider.chatResult([{ role: "user", content: "test" }]);
  assert.equal(count, 2);
  assert.equal(answer.content, "完整正文");
  assert.equal(answer.truncated, false);
});
test("an unavailable inference endpoint returns an actionable model error", async (t) => {
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response('{"detail":"Gone"}', { status: 410 }),
  );
  const provider = new OpenAICompatibleProvider(
    "model",
    "dummy",
    "test",
    "https://api.openai.com/v1",
  );
  await assert.rejects(
    provider.chat([{ role: "user", content: "test" }]),
    /HTTP 410/,
  );
});

test("NVIDIA MiniMax retries thinking-only output with the documented thinking mode disabled", async (t) => {
  const dns = (await import("node:dns/promises")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const originalLookup = dns.lookup;
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  syncBuiltinESMExports();
  t.after(() => {
    dns.lookup = originalLookup;
    syncBuiltinESMExports();
  });
  const { OpenAICompatibleProvider } = await import("../src/services/ai.js");
  const bodies: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      choices: [{ message: bodies.length === 1
        ? { content: null, reasoning_content: "hidden" }
        : { content: "最终正文" }, finish_reason: "stop" }],
    }));
  });
  const provider = new OpenAICompatibleProvider(
    "NVIDIA", "dummy", "minimaxai/minimax-m3", "https://integrate.api.nvidia.com/v1",
  );
  assert.equal(await provider.chat([{ role: "user", content: "test" }]), "最终正文");
  assert.equal(bodies[0].chat_template_kwargs, undefined);
  assert.deepEqual(bodies[1].chat_template_kwargs, { thinking_mode: "disabled" });
  assert.equal(bodies[1].max_tokens, 8192);
});
