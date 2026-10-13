import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api";
import { StudyRepository, type DataStorage } from "../src/study-repository";
import {
  type AIReply,
  exportFilename,
  repliesToMarkdown,
} from "../src/ai-export";

const reply: AIReply = {
  id: "reply-1",
  questionId: "q-1",
  questionTitle: "Linux / 内存\n排查",
  prompt: "请举例解释",
  provider: "model-1",
  createdAt: "2026-10-11T06:00:00.000Z",
  content:
    "## 内存\n\n中文与 emoji 🧠\n\n```bash\nfree -h\necho 'available'\n```\n\n| 指标 | 含义 |\n| --- | --- |\n| available | 可用 |",
};
function storageFixture() {
  const data = new Map<string, string>();
  const storage: DataStorage = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}
test("single and selected batch exports preserve full Markdown, prompts and model metadata", () => {
  const second = {
    ...reply,
    id: "reply-2",
    questionId: "q-2",
    questionTitle: "网络",
    content: "另一道题的答疑",
  };
  const single = repliesToMarkdown([reply]);
  assert.ok(single.includes(reply.content));
  assert.ok(single.includes(reply.prompt));
  assert.match(single, /模型：model-1/);
  assert.match(single, /1\. Linux \/ 内存 排查/);
  const batch = repliesToMarkdown([second, reply]);
  assert.ok(batch.indexOf(second.content) < batch.indexOf(reply.content));
  assert.match(batch, /2\. Linux/);
  assert.throws(() => repliesToMarkdown([]), /至少一条/);
  const name = exportFilename([reply], new Date("2026-10-11T06:00:00.000Z"));
  assert.ok(name.endsWith(".md"));
  assert.ok(!/[<>:"/\\|?*\u0000-\u001f]/.test(name));
});

test("deletion persists only selected AI replies and serializes with incoming replies", async () => {
  const { storage } = storageFixture();
  const api = new ApiClient("https://one.example", "token");
  const repo = new StudyRepository(api, storage, "user-1");
  await repo.restore();
  await repo.saveAIReply(reply);
  await Promise.all([
    repo.deleteAIReplies([reply.id]),
    repo.saveAIReply({ ...reply, id: "reply-new", questionId: "q-2" }),
  ]);
  const restored = new StudyRepository(api, storage, "user-1");
  await restored.restore();
  assert.deepEqual(restored.getState().aiReplies.map((item) => item.id), ["reply-new"]);
});

test("failed AI reply deletion retains the archive and permits retry", async () => {
  const { storage } = storageFixture();
  let fail = false;
  const disk = { ...storage, set: async (key: string, value: string) => {
    if (fail) throw new Error("磁盘已满");
    await storage.set(key, value);
  } };
  const repo = new StudyRepository(new ApiClient("https://one.example", "token"), disk, "user-1");
  await repo.restore();
  await repo.saveAIReply(reply);
  fail = true;
  await assert.rejects(repo.deleteAIReplies([reply.id]), /磁盘已满/);
  assert.deepEqual(repo.getState().aiReplies, [reply]);
  fail = false;
  await repo.deleteAIReplies([reply.id]);
  assert.deepEqual(repo.getState().aiReplies, []);
});
test("AI archive survives restart, remains account/service scoped, and is cleared on logout", async () => {
  const { storage } = storageFixture();
  const api = new ApiClient("https://one.example", "token");
  const first = new StudyRepository(api, storage, "user-1");
  await first.restore();
  await first.saveAIReply(reply);
  await first.saveAIReply(reply);
  const restored = new StudyRepository(api, storage, "user-1");
  await restored.restore();
  assert.deepEqual(restored.getState().aiReplies, [reply]);
  for (const repo of [
    new StudyRepository(api, storage, "user-2"),
    new StudyRepository(
      new ApiClient("https://two.example", "token"),
      storage,
      "user-1",
    ),
  ]) {
    await repo.restore();
    assert.deepEqual(repo.getState().aiReplies, []);
  }
  await restored.clearOnLogout();
  await assert.rejects(restored.saveAIReply(reply), /会话已结束/);
  const loggedOut = new StudyRepository(api, storage, "user-1");
  await loggedOut.restore();
  assert.deepEqual(loggedOut.getState().aiReplies, []);
});
test("existing 1.2.1 cache restores without losing questions or requiring a new login", async () => {
  const { data, storage } = storageFixture();
  const repo = new StudyRepository(
    new ApiClient("https://one.example", "token"),
    storage,
    "user-1",
  );
  data.set(
    repo.key,
    JSON.stringify({
      version: 1,
      questions: [{ id: "old-question", title: "旧题目", content: "旧题目正文", answer: "旧答案",
        explanation: null, difficulty: "easy", category_id: null, tags: "[]" }],
      categories: [],
      progress: {},
      pending: {},
      categoryId: "old-library",
      provider: "old-model",
      downloadedAt: "2026-10-10",
    }),
  );
  await repo.restore();
  assert.equal(repo.getState().count, 1);
  assert.equal(repo.getState().provider, "old-model");
  assert.equal(repo.getState().categoryId, "old-library");
  assert.deepEqual(repo.getState().aiReplies, []);
  await repo.saveAIReply(reply);
  assert.equal(JSON.parse(data.get(repo.key)!).questions[0].id, "old-question");
});
test("failed disk write retains the previous archive and retry can save the generated answer", async () => {
  const { storage } = storageFixture();
  let fail = false;
  const disk = {
    ...storage,
    set: async (key: string, value: string) => {
      if (fail) throw new Error("磁盘已满");
      await storage.set(key, value);
    },
  };
  const repo = new StudyRepository(
    new ApiClient("https://one.example", "token"),
    disk,
    "user-1",
  );
  await repo.restore();
  await repo.saveAIReply(reply);
  const next = { ...reply, id: "reply-2", content: "第二条" };
  fail = true;
  await assert.rejects(repo.saveAIReply(next), /磁盘已满/);
  assert.deepEqual(repo.getState().aiReplies, [reply]);
  fail = false;
  await repo.saveAIReply(next);
  assert.deepEqual(repo.getState().aiReplies, [reply, next]);
});

test("a failed slow save from one question cannot discard another question's concurrent reply", async () => {
  const { data, storage } = storageFixture();
  let rejectFirst!: (error: Error) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let calls = 0;
  const disk = {
    ...storage,
    set: async (key: string, value: string) => {
      if (++calls === 1) {
        began();
        await new Promise<void>((_, reject) => {
          rejectFirst = reject;
        });
      }
      await storage.set(key, value);
    },
  };
  const repo = new StudyRepository(
    new ApiClient("https://one.example", "token"),
    disk,
    "user-1",
  );
  await repo.restore();
  const first = repo.saveAIReply(reply);
  const failure = assert.rejects(first, /磁盘写入失败/);
  await started;
  const other = {
    ...reply,
    id: "reply-other",
    questionId: "q-other",
    content: "另一题的回复",
  };
  const second = repo.saveAIReply(other);
  rejectFirst(new Error("磁盘写入失败"));
  await failure;
  await second;
  assert.deepEqual(repo.getState().aiReplies, [other]);
  assert.deepEqual(JSON.parse(data.get(repo.key)!).aiReplies, [other]);
  await repo.saveAIReply(reply);
  assert.deepEqual(repo.getState().aiReplies, [other, reply]);
});
