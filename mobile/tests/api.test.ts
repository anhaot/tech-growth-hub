import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError, AIEmptyAnswerError, normalizeServer } from "../src/api";
import { permitted, tagsOf, type User } from "../src/types";

test("service URL normalization accepts a deployment prefix and removes /api", () => {
  assert.equal(
    normalizeServer(" https://tiku.example.com/hub/api/ "),
    "https://tiku.example.com/hub",
  );
  assert.equal(normalizeServer("http://10.0.2.2:3001"), "http://10.0.2.2:3001");
  assert.equal(
    normalizeServer("http://1.1.1.1:18081/api/"),
    "http://1.1.1.1:18081",
  );
  assert.equal(
    normalizeServer("HTTPS://TIKU.EXAMPLE.COM"),
    "https://tiku.example.com",
  );
  assert.equal(
    normalizeServer("http://localhost:18081"),
    "http://localhost:18081",
  );
  for (const invalid of [
    "javascript:alert(1)",
    "https://name:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com#test",
    "example.com",
  ])
    assert.throws(() => normalizeServer(invalid));
});

test("field supplements send current drafts and selected model, preserve Markdown, reject empty answers and support cancellation", async (t) => {
  const requests: { url: string; input: Record<string, unknown>; auth: string }[] = [];
  let empty = false;
  let nullResponse = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new Error('cancelled');
    requests.push({ url, input: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    return new Response(JSON.stringify(nullResponse ? null : { result: empty ? ' ' : '补充\n```bash\nfree -h\n```', truncated: false }));
  });
  const api = new ApiClient('https://test.example', 'test-token');
  for (const field of ['answer', 'explanation'] as const) {
    const result = await api.supplementQuestion({ questionId: 'question-1', field, answer: '正在编辑的答案', explanation: '尚未保存的解析', provider: 'model-2' });
    assert.equal(result.result, '补充\n```bash\nfree -h\n```');
    assert.equal(requests.at(-1)?.input.field, field);
    assert.equal(requests.at(-1)?.input.provider, 'model-2');
    assert.equal(requests.at(-1)?.input.answer, '正在编辑的答案');
    assert.equal(requests.at(-1)?.input.explanation, '尚未保存的解析');
    assert.equal(requests.at(-1)?.auth, 'Bearer test-token');
    assert.equal(requests.at(-1)?.url, 'https://test.example/api/ai/supplement');
  }
  const input = { questionId: 'question-1', field: 'answer' as const, answer: '', explanation: '' };
  empty = true;
  await assert.rejects(api.supplementQuestion(input), /没有返回有效/);
  nullResponse = true;
  await assert.rejects(api.supplementQuestion(input), /没有返回有效/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.supplementQuestion(input, controller.signal), /已取消/);
});

test("HTTP and HTTPS login retain the supplied protocol, host and custom port", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return new Response(
      JSON.stringify({ token: "test-token", user: { username: "test" } }),
    );
  });
  for (const address of [
    "http://1.1.1.1:18081",
    "https://tiku.example.com:18443",
  ]) {
    await new ApiClient(normalizeServer(address)).login("test", "password");
    assert.equal(urls.at(-1), `${address}/api/auth/login`);
  }
});

test("AI requests use the chosen model, question and bearer token; cancellation stops pending requests", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ result: "学习笔记" }));
    },
  );
  const api = new ApiClient("http://1.1.1.1:18081", "test-token");
  assert.equal(
    (await api.aiAction("q-1", "chat", "model-1", "请解释")).result,
    "学习笔记",
  );
  assert.equal(calls[0].url, "http://1.1.1.1:18081/api/ai/chat");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    questionId: "q-1",
    provider: "model-1",
    message: "请解释",
  });
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    "Bearer test-token",
  );
  await api.aiAction(undefined, "chat", "model-1", "学习 Linux");
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), {
    provider: "model-1",
    message: "学习 Linux",
  });
  await api.aiAction("q-1", "generate");
  assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), {
    questionId: "q-1",
    count: 3,
  });
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("Aborted")),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const pending = api.aiAction(
    "q-1",
    "analyze",
    undefined,
    undefined,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, /请求已取消/);
});

test("AI inference has a longer timeout than normal API requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = false;
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      }),
  );
  const pending = new ApiClient("https://tiku.example.com", "token").aiAction(
    "q-1",
    "expand",
  );
  t.mock.timers.tick(20_001);
  assert.equal(aborted, false);
  t.mock.timers.tick(180_000);
  await assert.rejects(pending, /连接超时/);
});

test("API requests use bearer auth, encoded filters, and preserve bookmarks when recording a visit", async (t) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ data: [], total: 0, page: 1, totalPages: 0 }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  );
  const api = new ApiClient("https://tiku.example.com", "test-token");
  await api.questions(3, {
    keyword: "Linux & 网络",
    difficulty: "hard",
    categoryId: "cat-1",
  });
  const query = new URL(calls[0].url).searchParams;
  assert.equal(query.get("keyword"), "Linux & 网络");
  assert.equal(query.get("page"), "3");
  assert.equal(query.get("difficulty"), "hard");
  assert.equal(calls[0].init?.credentials, "omit");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    "Bearer test-token",
  );
  await api.saveProgress("q-1", "quiz");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { mode: "quiz" });
  await api.saveProgress("q-1", "quiz", false);
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    mode: "quiz",
    isBookmarked: false,
  });
});

test("expired and forced-password sessions are reported; permission denial retains the session", async (t) => {
  let status = 401;
  const errors: number[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ error: "拒绝访问" }), { status }),
  );
  const api = new ApiClient("https://tiku.example.com", "token", (value) =>
    errors.push(value),
  );
  for (status of [401, 428, 403])
    await assert.rejects(
      api.me(),
      (error: unknown) => error instanceof ApiError && error.status === status,
    );
  assert.deepEqual(errors, [401, 428]);
  await assert.rejects(
    new ApiClient("https://tiku.example.com", undefined, (value) =>
      errors.push(value),
    ).login("user", "bad"),
  );
  assert.deepEqual(errors, [401, 428]);
});

test("network and non-JSON deployment errors produce useful messages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    new ApiClient("https://tiku.example.com").me(),
    (error: unknown) => error instanceof ApiError && error.status === 0,
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>wrong installation</html>"),
  );
  await assert.rejects(
    new ApiClient("https://tiku.example.com").me(),
    /非 JSON/,
  );
});

test("authentication errors retain their HTTP status for HTML and null response bodies", async (t) => {
  const errors: number[] = [];
  const responses = [
    new Response("<html>Session expired</html>", { status: 401 }),
    new Response("null", { status: 428 }),
    new Response("null", { status: 403 }),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  const api = new ApiClient("https://test.example", "token", (status) => errors.push(status));
  for (const status of [401, 428, 403]) {
    await assert.rejects(api.me(), (error: unknown) => error instanceof ApiError && error.status === status);
  }
  assert.deepEqual(errors, [401, 428]);
});

test("permission compatibility and malformed legacy tags are handled", () => {
  const user = {
    role: "user",
    permissions: { question_create: true },
  } as unknown as User;
  assert.equal(permitted(user, "question_view"), true);
  assert.equal(permitted(user, "category_view"), false);
  assert.equal(permitted({ ...user, role: "admin" }, "system_manage"), true);
  assert.deepEqual(tagsOf('["Linux",2]'), ["Linux"]);
  assert.deepEqual(tagsOf("broken JSON"), []);
});

test("AI response validation preserves structured answer text and rejects empty or reasoning-only replies", async (t) => {
  const answers: unknown[] = [
    {
      result: [
        { type: "text", text: "完整" },
        { type: "reasoning", text: "hidden" },
        { type: "text", text: "正文" },
      ],
    },
    { result: null },
    { result: "   " },
    { result: [{ type: "reasoning", text: "not an answer" }] },
    {},
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(answers.shift())),
  );
  const api = new ApiClient("https://tiku.example.com", "token");
  assert.equal(
    (await api.aiAction("q", "chat", undefined, "test")).result,
    "完整正文",
  );
  for (let i = 0; i < 4; i++)
    await assert.rejects(
      api.aiAction("q", "chat", undefined, "test"),
      /没有返回回答正文/,
    );
});

test("empty answer diagnostics identify the actual service and endpoint without retaining response secrets", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    result: null, reasoning_content: "private reasoning", apiKey: "never retain", finishReason: "length",
  })));
  await assert.rejects(new ApiClient("http://another.example:3001", "secret-token")
    .aiAction("q", "recommend", "chosen-model"), (error: unknown) => {
      assert.ok(error instanceof AIEmptyAnswerError);
      assert.equal(error.details.server, "http://another.example:3001");
      assert.equal(error.details.action, "recommend");
      assert.equal(error.details.provider, "chosen-model");
      assert.equal(error.details.resultKind, "null");
      const diagnostic = JSON.stringify(error.details);
      assert.ok(!diagnostic.includes("private reasoning") && !diagnostic.includes("never retain") && !diagnostic.includes("secret-token"));
      return true;
    });
});
