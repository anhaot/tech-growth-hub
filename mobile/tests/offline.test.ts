import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError } from "../src/api";
import { StudyRepository, type DataStorage } from "../src/study-repository";
import type { Category, Filter, Progress, Question, User } from "../src/types";

const questions: Question[] = [
  {
    id: "q-1",
    title: "CPU 排查",
    content: "如何排查 CPU？",
    answer: "**top**",
    explanation: "观察进程",
    difficulty: "easy",
    category_id: "linux",
    tags: '["运维"]',
  },
  {
    id: "q-2",
    title: "内存排查",
    content: "如何查看内存？",
    answer: "free",
    explanation: "检查 available",
    difficulty: "hard",
    category_id: "linux",
    tags: "[]",
  },
  {
    id: "q-3",
    title: "网络排查",
    content: "如何看端口？",
    answer: "ss",
    explanation: "查看监听状态",
    difficulty: "medium",
    category_id: "network",
    tags: "[]",
  },
];
const categories: Category[] = [
  { id: "linux", name: "Linux", parent_id: null },
  { id: "network", name: "网络", parent_id: null },
];
function fixture(t: TestContext) {
  const values = new Map<string, string>();
  const storage: DataStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
  const api = new ApiClient("https://test.example", "token");
  const progress = new Map<string, Progress>();
  const online = { value: true, denial: 0 };
  const calls: string[] = [];
  const check = (name: string) => {
    calls.push(name);
    if (!online.value) throw new ApiError("当前离线", 0);
    if (online.denial) throw new ApiError("拒绝访问", online.denial);
  };
  t.mock.method(api, "me", async () => {
    check("me");
    return { id: "user-1" } as User;
  });
  t.mock.method(
    api,
    "questions",
    async (page = 1, filter: Filter = {}, pageSize = 20) => {
      check("questions");
      const data = questions.filter(
        (q) => !filter.categoryId || q.category_id === filter.categoryId,
      );
      return {
        data: data.slice((page - 1) * pageSize, page * pageSize),
        total: data.length,
        page,
        totalPages: Math.ceil(data.length / pageSize),
      };
    },
  );
  t.mock.method(api, "question", async (id: string) => {
    check("question");
    return questions.find((q) => q.id === id)!;
  });
  t.mock.method(api, "categories", async () => {
    check("categories");
    return categories;
  });
  t.mock.method(api, "bookmarks", async () => {
    check("bookmarks");
    return questions.filter((q) => progress.get(q.id)?.is_bookmarked);
  });
  t.mock.method(api, "lastViewed", async () => {
    check("last");
    return (
      [...progress.values()].sort((a, b) =>
        b.last_viewed_at.localeCompare(a.last_viewed_at),
      )[0] ?? null
    );
  });
  t.mock.method(
    api,
    "saveProgress",
    async (id: string, _mode: string, bookmarked?: boolean) => {
      check("save");
      const previous = progress.get(id);
      const saved = {
        question_id: id,
        is_bookmarked: bookmarked ?? previous?.is_bookmarked ?? false,
        view_count: (previous?.view_count ?? 0) + 1,
        last_viewed_at: new Date().toISOString(),
      };
      progress.set(id, saved);
      // Real HTTP responses cannot share references with server-side state.
      return { ...saved };
    },
  );
  return {
    api,
    storage,
    values,
    online,
    progress,
    calls,
    repository: new StudyRepository(api, storage, "user-1"),
  };
}

test("fresh cache survives cold starts and foreground events without full downloads; manual update bypasses age", async (t) => {
  const f = fixture(t);
  await f.repository.restore();
  await f.repository.sync({ automatic: true });
  assert.equal(f.calls.filter((call) => call === "questions").length, 1);
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  await restarted.sync({ automatic: true });
  await restarted.sync({ automatic: true });
  assert.equal(f.calls.filter((call) => call === "questions").length, 1);
  await restarted.sync();
  assert.equal(f.calls.filter((call) => call === "questions").length, 2);
});

test("batch bookmark cancellation persists without recording visits and does not reappear on sync", async (t) => {
  const f = fixture(t);
  t.mock.method(f.api, "removeBookmarks", async (ids: string[]) => {
    for (const id of ids) {
      const p = f.progress.get(id);
      if (p) f.progress.set(id, { ...p, is_bookmarked: false });
    }
    return { removedCount: ids.length };
  });
  await f.repository.restore();
  await f.repository.sync();
  await f.repository.saveProgress("q-1", true);
  await f.repository.saveProgress("q-2", true);
  const before = { ...f.progress.get("q-1")! };
  await f.repository.removeBookmarks(["q-1"]);
  assert.deepEqual(f.progress.get("q-1"), { ...before, is_bookmarked: false });
  assert.deepEqual((await f.repository.bookmarks()).map((q) => q.id), ["q-2"]);
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  await restarted.sync({ automatic: true });
  assert.deepEqual((await restarted.bookmarks()).map((q) => q.id), ["q-2"]);
  f.online.value = false;
  await restarted.questions();
  await assert.rejects(restarted.removeBookmarks(["q-2"]), /请联网/);
  assert.deepEqual((await restarted.bookmarks()).map((q) => q.id), ["q-2"]);
});

test("question edits update the offline answer and deletion removes cached progress and pending bookmarks", async (t) => {
  const f = fixture(t);
  t.mock.method(f.api, "updateQuestion", async (id: string, input: { answer: string; explanation: string; expectedRevision?: number }) => ({ ...questions.find((q) => q.id === id)!, ...input, revision: 2 }));
  t.mock.method(f.api, "deleteQuestion", async () => ({}));
  await f.repository.restore();
  await f.repository.sync();
  const edited = await f.repository.updateQuestion("q-1", { answer: "新版答案", explanation: "新版解析", expectedRevision: 1 });
  assert.equal(edited.revision, 2);
  f.online.value = false;
  await f.repository.questions();
  assert.equal((await f.repository.question("q-1")).answer, "新版答案");
  await assert.rejects(f.repository.deleteQuestion("q-1"), /请联网/);
  await f.repository.saveProgress("q-1", true);
  f.online.value = true;
  // A lightweight read restores connectivity without replaying the pending visit.
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  await restarted.deleteQuestion("q-1");
  f.online.value = false;
  await restarted.questions();
  assert.equal((await restarted.questions()).data.some((q) => q.id === "q-1"), false);
  assert.equal(restarted.getState().pendingCount, 0);
  assert.equal((await restarted.bookmarks()).some((q) => q.id === "q-1"), false);
});

test("legacy preferences default to daily; manual mode still bootstraps the first offline mirror", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const saved = JSON.parse(f.values.get(f.repository.key)!);
  delete saved.updateMode;
  saved.downloadedAt = null;
  saved.questions = [];
  f.values.set(f.repository.key, JSON.stringify(saved));
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  assert.equal(restarted.getState().updateMode, "daily");
  await restarted.setPreference("updateMode", "manual");
  await restarted.sync({ automatic: true });
  assert.equal(restarted.getState().count, 3);
  assert.equal(restarted.getState().updateMode, "manual");
});

test("a failed first offline boot downloads promptly when the network returns", async (t) => {
  const f = fixture(t);
  f.online.value = false;
  await assert.rejects(f.repository.sync({ automatic: true }), /当前离线/);
  f.online.value = true;
  await f.repository.sync({ automatic: true });
  assert.equal(f.repository.getState().count, 3);
});

test("daily and manual choices survive restart; stale daily cache updates and stale manual cache retains queued sync", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const saved = JSON.parse(f.values.get(f.repository.key)!);
  saved.downloadedAt = new Date(Date.now() - 86400001).toISOString();
  f.values.set(f.repository.key, JSON.stringify(saved));
  const daily = new StudyRepository(f.api, f.storage, "user-1");
  await daily.restore();
  await daily.sync({ automatic: true });
  assert.equal(f.calls.filter((call) => call === "questions").length, 2);
  await daily.setPreference("updateMode", "manual");
  const old = JSON.parse(f.values.get(daily.key)!);
  old.downloadedAt = saved.downloadedAt;
  f.values.set(daily.key, JSON.stringify(old));
  const manual = new StudyRepository(f.api, f.storage, "user-1");
  await manual.restore();
  assert.equal(manual.getState().updateMode, "manual");
  f.online.value = false;
  await manual.question("q-1");
  await manual.saveProgress("q-1", true);
  assert.equal(manual.getState().pendingCount, 1);
  f.online.value = true;
  await manual.sync({ automatic: true });
  assert.equal(manual.getState().pendingCount, 0);
  assert.equal(f.progress.get("q-1")?.is_bookmarked, true);
  assert.equal(f.calls.filter((call) => call === "questions").length, 2);
  assert.equal(manual.getState().downloadedAt, saved.downloadedAt);
  await manual.sync();
  assert.equal(f.calls.filter((call) => call === "questions").length, 3);
});

test("failed automatic downloads are throttled, keep the saved mirror, and allow immediate manual retry", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const saved = JSON.parse(f.values.get(f.repository.key)!);
  saved.downloadedAt = new Date(Date.now() - 86400001).toISOString();
  f.values.set(f.repository.key, JSON.stringify(saved));
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  const failure = t.mock.method(f.api, "questions", async () => {
    f.calls.push("failed download");
    throw new ApiError("连接失败", 0);
  });
  await assert.rejects(restarted.sync({ automatic: true }), /连接失败/);
  await restarted.sync({ automatic: true });
  assert.equal(f.calls.filter((call) => call === "failed download").length, 1);
  assert.equal(restarted.getState().count, 3);
  assert.equal(restarted.getState().downloadedAt, saved.downloadedAt);
  failure.mock.restore();
  await restarted.sync();
  assert.equal(f.calls.filter((call) => call === "questions").length, 2);
});

test("manual refresh waits for a lightweight in-flight sync and still downloads; concurrent auto downloads coalesce", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  let release!: (user: User) => void;
  const slow = t.mock.method(f.api, "me", () => new Promise<User>((resolve) => { release = resolve; }));
  const auto = f.repository.sync({ automatic: true });
  const manual = f.repository.sync();
  assert.equal(f.repository.sync({ automatic: true }), auto);
  slow.mock.restore();
  release({ id: "user-1" } as User);
  await Promise.all([auto, manual]);
  assert.equal(f.calls.filter((call) => call === "questions").length, 2);
});

test("download survives restart; offline answers, explanations, search, filters and navigation work immediately", async (t) => {
  const f = fixture(t);
  await f.repository.restore();
  await f.repository.sync();
  f.online.value = false;
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  assert.equal((await restarted.question("q-1")).explanation, "观察进程");
  assert.equal((await restarted.question("q-1")).answer, "**top**");
  assert.equal(restarted.getState().offline, true);
  const calls = f.calls.length;
  assert.equal(
    (await restarted.questions(1, { keyword: "available" })).data[0].id,
    "q-2",
  );
  assert.equal(
    (await restarted.questions(1, { difficulty: "hard", categoryId: "linux" }))
      .total,
    1,
  );
  assert.equal((await restarted.questions(2, {}, 2)).data[0].id, "q-3");
  assert.equal((await restarted.adjacent("q-1", "next", "linux"))?.id, "q-2");
  assert.equal(await restarted.adjacent("q-2", "next", "linux"), null);
  assert.equal((await restarted.adjacent("q-2", "prev", "linux"))?.id, "q-1");
  assert.equal((await restarted.random("network"))?.id, "q-3");
  assert.equal((await restarted.categories()).length, 2);
  assert.equal(f.calls.length, calls);
});

test("offline bookmarks and visits persist with preferences and replay after reconnect", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  await f.repository.setPreference("categoryId", "linux");
  await f.repository.setPreference("provider", "chosen-model");
  f.online.value = false;
  await f.repository.saveProgress("q-1", true);
  await f.repository.saveProgress("q-1");
  const restarted = new StudyRepository(f.api, f.storage, "user-1");
  await restarted.restore();
  assert.equal(restarted.getState().categoryId, "linux");
  assert.equal(restarted.getState().provider, "chosen-model");
  assert.equal((await restarted.bookmarks())[0].id, "q-1");
  assert.equal((await restarted.lastViewed("linux"))?.question_id, "q-1");
  assert.equal(restarted.getState().pendingCount, 1);
  await restarted.saveProgress("q-1", false);
  assert.equal((await restarted.bookmarks()).length, 0);
  f.online.value = true;
  await restarted.sync();
  assert.equal(f.progress.get("q-1")?.is_bookmarked, false);
  assert.equal(restarted.getState().pendingCount, 0);
  assert.equal(restarted.getState().offline, false);
});

test("cached content and preferences are isolated by account and server", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  await f.repository.setPreference("categoryId", "linux");
  for (const [api, user] of [
    [f.api, "other-user"],
    [new ApiClient("https://other.example"), "user-1"],
  ] as const) {
    const other = new StudyRepository(api, f.storage, user);
    await other.restore();
    assert.equal(other.getState().count, 0);
    assert.equal(other.getState().categoryId, "");
  }
});

test("interrupted paginated refresh retains the previously complete download", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const previous = f.values.get(f.repository.key);
  t.mock.method(f.api, "questions", async (page: number) => {
    if (page === 2) throw new ApiError("断网", 0);
    return { data: [questions[2]], total: 2, totalPages: 2, page };
  });
  await assert.rejects(f.repository.sync(), /断网/);
  assert.equal(f.repository.getState().count, 3);
  assert.equal(f.values.get(f.repository.key), previous);
  assert.equal((await f.repository.questions()).total, 3);
});

test("authorization failures never fall back to cache or retain a rejected bookmark", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  for (const status of [401, 403, 428]) {
    f.online.denial = status;
    await assert.rejects(
      f.repository.question("q-1"),
      (e: unknown) => e instanceof ApiError && e.status === status,
    );
    await assert.rejects(
      f.repository.saveProgress("q-1", true),
      (e: unknown) => e instanceof ApiError && e.status === status,
    );
    assert.equal(f.repository.getState().pendingCount, 0);
    assert.equal(f.repository.getState().offline, false);
  }
});

test("disk failure cannot report a successful download; retry recovers", async (t) => {
  const f = fixture(t);
  await f.repository.restore();
  const original = f.storage.set;
  t.mock.method(f.storage, "set", async () => {
    throw new Error("磁盘空间不足");
  });
  await assert.rejects(f.repository.sync(), /磁盘空间不足/);
  assert.equal(f.repository.getState().downloadedAt, null);
  assert.equal(f.repository.getState().count, 0);
  t.mock.method(f.storage, "set", original);
  await f.repository.sync();
  assert.equal(f.repository.getState().count, 3);
});

test("logout prevents in-flight downloads from recreating deleted content", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  let release!: (value: User) => void;
  t.mock.method(
    f.api,
    "me",
    () =>
      new Promise<User>((resolve) => {
        release = resolve;
      }),
  );
  const downloading = f.repository.sync();
  await f.repository.clearOnLogout();
  release({ id: "user-1" } as User);
  await downloading;
  assert.equal(f.values.has(f.repository.key), false);
  assert.equal(f.repository.getState().count, 0);
});

test("newer offline bookmark wins over an older in-flight visit response", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  let release!: (value: Progress) => void;
  t.mock.method(
    f.api,
    "saveProgress",
    () =>
      new Promise<Progress>((resolve) => {
        release = resolve;
      }),
  );
  const first = f.repository.saveProgress("q-1");
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  f.online.value = false;
  await f.repository.question("q-1");
  await f.repository.saveProgress("q-1", true);
  release({
    question_id: "q-1",
    is_bookmarked: false,
    last_viewed_at: new Date().toISOString(),
    view_count: 1,
  });
  await first;
  assert.equal(f.repository.getState().pendingCount, 1);
  assert.equal((await f.repository.bookmarks())[0].id, "q-1");
});

test("corrupted snapshot fields fail restore with a recoverable download message", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const valid = JSON.parse(f.values.get(f.repository.key)!);
  for (const invalid of [null, { ...valid, pending: null }, { ...valid, progress: [] },
    { ...valid, questions: [{ ...questions[0], content: null }] },
    { ...valid, aiReplies: [{ id: "bad", content: null }] }]) {
    f.values.set(f.repository.key, JSON.stringify(invalid));
    const restarted = new StudyRepository(f.api, f.storage, "user-1");
    await assert.rejects(restarted.restore(), /请联网后重新下载/);
    await restarted.clear();
    await restarted.restore();
    await restarted.sync();
    assert.equal(restarted.getState().count, 3);
  }
});

test("logout during a pending disk restore cannot resurrect cached account data", async (t) => {
  const f = fixture(t);
  await f.repository.sync();
  const raw = f.values.get(f.repository.key)!;
  let release!: (value: string) => void;
  t.mock.method(f.storage, "get", () => new Promise<string>((resolve) => { release = resolve; }));
  const restarting = new StudyRepository(f.api, f.storage, "user-1");
  const restore = restarting.restore();
  await restarting.clearOnLogout();
  release(raw);
  await restore;
  assert.equal(restarting.getState().count, 0);
  assert.equal(f.values.has(restarting.key), false);
});
