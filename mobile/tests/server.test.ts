import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { ApiClient, ApiError, normalizeServer } from "../src/api";

// Isolated database: never connect this test to the deployed service.
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), "tgh-mobile-contract-"),
);
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_TYPE: "sqlite",
  SQLITE_PATH: path.join(directory, "test.db"),
  DATABASE_RUNTIME_CONFIG_PATH: path.join(directory, "runtime.json"),
  JWT_SECRET: "mobile-contract-test-secret",
  AI_CONFIG_ENCRYPTION_KEY: "1".repeat(64),
  AI_ENABLED: "false",
  INIT_ADMIN_USERNAME: "mobile_admin",
  INIT_ADMIN_EMAIL: "mobile_admin@example.com",
  INIT_ADMIN_PASSWORD: "admin",
  INIT_ADMIN_FORCE_PASSWORD_CHANGE: "true",
});

test("native client works with the actual API: HTTP login, study, AI, permission isolation and token revocation", async (t) => {
  const { createApp } = await import("../../api/src/app");
  const { db } = await import("../../api/src/database");
  await db.connect();
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const publicApi = new ApiClient(
    normalizeServer(`http://127.0.0.1:${address.port}/api`),
  );
  try {
    const initial = await publicApi.login("mobile_admin", "admin");
    assert.equal(initial.user.must_change_password, true);
    const oldApi = new ApiClient(publicApi.server, initial.token);
    await assert.rejects(
      oldApi.questions(),
      (err: unknown) => err instanceof ApiError && err.status === 428,
    );
    await oldApi.changePassword("MobileTest123");
    await assert.rejects(
      oldApi.me(),
      (err: unknown) => err instanceof ApiError && err.status === 401,
    );
    const logged = await publicApi.login("mobile_admin", "MobileTest123");
    const api = new ApiClient(publicApi.server, logged.token);
    assert.equal((await api.me()).must_change_password, false);
    const category = await api.request<{ id: string }>("/categories", "POST", {
      name: "移动端测试",
    });
    assert.equal((await api.categories())[0].id, category.id);
    const first = await api.createQuestion({
      title: "Linux 移动题目 A",
      content: "如何排查 CPU？",
      answer: "使用 **top**。",
      difficulty: "easy",
      categoryId: category.id,
      tags: ["Linux"],
    });
    const second = await api.createQuestion({
      title: "Linux 移动题目 B",
      content: "如何查看内存？",
      answer: "使用 free。",
      difficulty: "hard",
      categoryId: category.id,
      tags: ["Linux"],
    });
    const list = await api.questions(1, {
      keyword: "Linux",
      categoryId: category.id,
      difficulty: "hard",
    });
    assert.equal(list.total, 1);
    assert.equal(list.data[0].id, second.id);
    assert.equal((await api.question(first.id)).content, first.content);
    // Configure directly from the app, with model discovery mocked locally.
    const fetchBeforeModels = globalThis.fetch;
    const modelFetch = t.mock.method(
      globalThis,
      "fetch",
      async (input, init) => {
        if (String(input).startsWith("https://api.openai.com/v1/")) {
          return new Response(
            JSON.stringify(
              String(input).endsWith("/models")
                ? { data: [{ id: "first-model" }, { id: "second-model" }] }
                : {
                    choices: [
                      { message: { content: "OK" }, finish_reason: "stop" },
                    ],
                  },
            ),
          );
        }
        return fetchBeforeModels(input, init);
      },
    );
    const configOne = await api.saveAIConfig({
      provider: "openai",
      displayName: "App 模型",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "isolated-model-secret",
      model: "first-model",
      isCustom: false,
    });
    const configs = await api.aiConfigs();
    assert.equal(configs[0].id, configOne.id);
    assert.ok(!JSON.stringify(configs).includes("isolated-model-secret"));
    assert.equal(Object.hasOwn(configs[0], "apiKey"), false);
    await api.saveAIConfig(
      {
        provider: "openai",
        displayName: "已编辑模型",
        baseUrl: "https://api.openai.com/v1",
        model: "second-model",
        isCustom: false,
      },
      configOne.id,
    );
    assert.deepEqual(
      (
        await api.aiModels({
          configId: configOne.id,
          baseUrl: "https://api.openai.com/v1",
        })
      ).models.map((m) => m.id),
      ["first-model", "second-model"],
    );
    const configTwo = await api.saveAIConfig({
      provider: "openai",
      model: "first-model",
      apiKey: "isolated-other-secret",
      baseUrl: "https://api.openai.com/v1",
    });
    await api.activateAIConfig(configOne.id);
    assert.equal((await api.aiStatus()).defaultConfigId, configOne.id);
    await api.deleteAIConfig(configTwo.id);
    assert.equal((await api.aiConfigs()).length, 1);
    modelFetch.mock.restore();
    assert.equal((await api.aiStatus()).enabled, false);
    await assert.rejects(
      api.aiAction(first.id, "analyze"),
      (err: unknown) => err instanceof ApiError && err.status === 403,
    );
    // Exercise real AI routes with an isolated provider stub, never paid inference.
    const { aiService } = await import("../../api/src/services/ai");
    const prompts: string[] = [];
    const models: string[] = [];
    t.mock.method(
      aiService,
      "getProvider",
      async (provider: string, options: { userId: string }) => {
        assert.equal(options.userId, logged.user.id);
        models.push(provider);
        return {
          chat: async (messages: { content: string }[]) => {
            prompts.push(messages[0].content);
            return "## 学习笔记\n\n使用 **top** 排查 CPU。";
          },
        };
      },
    );
    await db.setSetting("ai_enabled", "true");
    assert.equal((await api.aiStatus()).enabled, true);
    for (const action of [
      "analyze",
      "expand",
      "recommend",
      "generate",
      "chat",
    ] as const) {
      assert.match(
        (
          await api.aiAction(
            first.id,
            action,
            "mobile-test-model",
            "如何记住？",
          )
        ).result,
        /学习笔记/,
      );
    }
    assert.ok(prompts.every((prompt) => prompt.includes(first.title)));
    assert.ok(prompts.at(-1)?.includes("如何记住？"));
    assert.ok(models.every((model) => model === "mobile-test-model"));
    const detailed = t.mock.method(aiService, "getProvider", async () => ({
      chat: async () => "partial",
      chatResult: async () => ({
        content: "partial",
        truncated: true,
        finishReason: "length",
        continuationCount: 2,
      }),
    }));
    const partial = await api.aiAction(
      first.id,
      "chat",
      "mobile-test-model",
      "continue",
    );
    assert.equal(partial.result, "partial");
    assert.equal(partial.truncated, true);
    assert.equal(partial.finishReason, "length");
    detailed.mock.restore();
    assert.match(
      (
        await api.aiAction(
          undefined,
          "chat",
          "mobile-test-model",
          "如何学习 Linux？",
        )
      ).result,
      /学习笔记/,
    );
    assert.ok(prompts.at(-1)?.includes("如何学习 Linux？"));
    assert.ok(!prompts.at(-1)?.includes(first.title));
    for (const body of [
      {},
      { message: "   " },
      { message: "问题", questionId: "invalid" },
      { message: "x".repeat(12001) },
    ]) {
      await assert.rejects(
        api.request("/ai/chat", "POST", body),
        (error: unknown) => error instanceof ApiError && error.status === 400,
      );
    }
    await api.saveProgress(first.id, "study", true);
    await api.saveProgress(first.id, "study");
    assert.equal((await api.progress(first.id, "study"))?.is_bookmarked, true);
    assert.equal((await api.bookmarks("study"))[0].id, first.id);
    assert.equal((await api.bookmarks("quiz")).length, 0);
    assert.equal(
      (await api.lastViewed("study", category.id))?.question_id,
      first.id,
    );
    const random = await api.random(category.id);
    assert.ok([first.id, second.id].includes(random.randomQuestion!.id));
    const all = await api.questions(1, { categoryId: category.id });
    const next = await api.adjacent(all.data[0].id, "next", category.id);
    assert.equal(next.nextQuestion?.id, all.data[1].id);
    const previous = await api.adjacent(all.data[1].id, "prev", category.id);
    assert.equal(previous.prevQuestion?.id, all.data[0].id);
    await api.saveProgress(first.id, "study", false);
    assert.equal((await api.bookmarks("study")).length, 0);
    const other = await publicApi.request<{ token: string }>(
      "/auth/register",
      "POST",
      {
        username: "mobile_other",
        email: "mobile_other@example.com",
        password: "OtherPass123",
      },
    );
    await assert.rejects(
      new ApiClient(publicApi.server, other.token).question(first.id),
      (err: unknown) =>
        err instanceof ApiError && [403, 404].includes(err.status),
    );
    await assert.rejects(
      new ApiClient(publicApi.server, other.token).aiAction(
        first.id,
        "analyze",
      ),
      (err: unknown) =>
        err instanceof ApiError && [403, 404].includes(err.status),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
