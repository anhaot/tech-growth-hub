import { ApiClient, ApiError } from "./api";
import type { AIReply } from "./ai-export";
import type { Category, Filter, Page, Progress, Question } from "./types";

export interface DataStorage {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}
interface Snapshot {
  version: 1;
  questions: Question[];
  categories: Category[];
  progress: Record<string, Progress>;
  pending: Record<string, { revision: number; bookmark?: boolean }>;
  categoryId: string;
  provider: string;
  updateMode: "daily" | "manual";
  downloadedAt: string | null;
  aiReplies: AIReply[];
}
const emptySnapshot = (): Snapshot => ({
  version: 1,
  questions: [],
  categories: [],
  progress: {},
  pending: {},
  categoryId: "",
  provider: "",
  updateMode: "daily",
  downloadedAt: null,
  aiReplies: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isQuestion = (value: unknown): value is Question =>
  isRecord(value) && typeof value.id === "string" &&
  typeof value.title === "string" && typeof value.content === "string" &&
  typeof value.answer === "string" &&
  (value.explanation === null || typeof value.explanation === "string") &&
  ["easy", "medium", "hard"].includes(String(value.difficulty)) &&
  (value.category_id === null || typeof value.category_id === "string") &&
  typeof value.tags === "string";

function parseSnapshot(raw: string): Snapshot {
  const error = () => new Error("本地题库读取失败，请联网后重新下载");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw error(); }
  if (!isRecord(data) || data.version !== 1 ||
    !Array.isArray(data.questions) || !data.questions.every(isQuestion) ||
    !Array.isArray(data.categories) || !data.categories.every((category) =>
      isRecord(category) && typeof category.id === "string" && typeof category.name === "string" &&
      (category.parent_id === null || typeof category.parent_id === "string")) ||
    !isRecord(data.progress) || !Object.values(data.progress).every((progress) =>
      isRecord(progress) && typeof progress.question_id === "string" &&
      typeof progress.is_bookmarked === "boolean" && typeof progress.last_viewed_at === "string" &&
      typeof progress.view_count === "number" && Number.isFinite(progress.view_count)) ||
    !isRecord(data.pending) || !Object.values(data.pending).every((pending) =>
      isRecord(pending) && typeof pending.revision === "number" && Number.isFinite(pending.revision) &&
      (pending.bookmark === undefined || typeof pending.bookmark === "boolean")) ||
    typeof data.categoryId !== "string" || typeof data.provider !== "string" ||
    (data.downloadedAt !== null && typeof data.downloadedAt !== "string") ||
    (data.aiReplies !== undefined && (!Array.isArray(data.aiReplies) || !data.aiReplies.every((reply) =>
      isRecord(reply) && ["id", "questionId", "questionTitle", "prompt", "content", "provider", "createdAt"]
        .every((field) => typeof reply[field] === "string"))))
  ) throw error();
  return {
    ...(data as unknown as Snapshot),
    updateMode: data.updateMode === "manual" ? "manual" : "daily",
    aiReplies: (data.aiReplies as AIReply[] | undefined) || [],
  };
}

export class StudyRepository {
  private data = emptySnapshot();
  private writes: Promise<void> = Promise.resolve();
  private aiWrites: Promise<void> = Promise.resolve();
  private syncTask: Promise<void> | null = null;
  private downloading = false;
  private lastAutoDownload = -Infinity;
  private listeners = new Set<() => void>();
  private revision = Date.now();
  private stopped = false;
  private lifecycle = 0;
  private state = {
    offline: false,
    syncing: false,
    count: 0,
    downloadedAt: null as string | null,
    categoryId: "",
    provider: "",
    updateMode: "daily" as "daily" | "manual",
    categories: [] as Category[],
    pendingCount: 0,
    syncError: "",
    aiReplies: [] as AIReply[],
  };
  readonly key: string;

  constructor(
    private api: ApiClient,
    private storage: DataStorage,
    userId: string,
    private canViewCategories = true,
  ) {
    this.key = `tgh.study.v1.${encodeURIComponent(api.server)}.${encodeURIComponent(userId)}`;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = () => this.state;
  private emit(update: Partial<typeof this.state> = {}) {
    this.state = {
      ...this.state,
      count: this.data.questions.length,
      downloadedAt: this.data.downloadedAt,
      categoryId: this.data.categoryId,
      provider: this.data.provider,
      updateMode: this.data.updateMode,
      categories: this.data.categories,
      pendingCount: Object.keys(this.data.pending).length,
      aiReplies: this.data.aiReplies,
      ...update,
    };
    this.listeners.forEach((listener) => listener());
  }
  async restore() {
    const lifecycle = ++this.lifecycle;
    this.stopped = false;
    const raw = await this.storage.get(this.key);
    // A disk read started before logout must not restore cleared account data.
    if (this.stopped || lifecycle !== this.lifecycle) return;
    this.data = raw ? parseSnapshot(raw) : emptySnapshot();
    this.emit();
  }
  private persist() {
    if (this.stopped) return Promise.resolve();
    const value = JSON.stringify(this.data);
    // Serialize disk writes; one failed write must not poison the queue.
    const write = this.writes
      .catch(() => undefined)
      .then(() =>
        this.stopped ? undefined : this.storage.set(this.key, value),
      );
    this.writes = write;
    return write;
  }
  async clear() {
    this.lifecycle += 1;
    await this.writes.catch(() => undefined);
    await this.storage.remove(this.key);
    this.data = emptySnapshot();
    this.emit();
  }
  stop = () => {
    this.lifecycle += 1;
    this.stopped = true;
  };
  clearOnLogout = async () => {
    this.stop();
    await this.clear();
  };
  async setPreference<K extends "categoryId" | "provider" | "updateMode">(
    key: K,
    value: Snapshot[K],
  ) {
    const previous = this.data[key];
    this.data[key] = value;
    try {
      await this.persist();
    } catch (error) {
      this.data[key] = previous;
      throw error;
    }
    this.emit();
  }
  async saveAIReply(reply: AIReply) {
    // A slow write can overlap a reply from another question. Serialize both
    // mutation and persistence so one failed save cannot roll back a later reply.
    const operation = this.aiWrites
      .catch(() => undefined)
      .then(async () => {
        if (this.stopped) throw new Error("当前会话已结束，答疑未保存");
        const previous = this.data.aiReplies;
        this.data.aiReplies = [
          ...previous.filter((entry) => entry.id !== reply.id),
          reply,
        ];
        try {
          await this.persist();
        } catch (error) {
          this.data.aiReplies = previous;
          throw error;
        }
        if (!this.stopped) this.emit();
      });
    this.aiWrites = operation;
    return operation;
  }
  private remember(questions: Question[]) {
    const merged = new Map(
      this.data.questions.map((question) => [question.id, question]),
    );
    questions.forEach((question) => merged.set(question.id, question));
    this.data.questions = [...merged.values()];
    this.emit();
  }
  async deleteAIReplies(ids: string[]) {
    const operation = this.aiWrites.catch(() => undefined).then(async () => {
      if (this.stopped) throw new Error("当前会话已结束");
      const previous = this.data.aiReplies;
      const removed = new Set(ids);
      this.data.aiReplies = previous.filter((reply) => !removed.has(reply.id));
      try {
        await this.persist();
      } catch (error) {
        this.data.aiReplies = previous;
        throw error;
      }
      if (!this.stopped) this.emit();
    });
    this.aiWrites = operation;
    return operation;
  }
  async removeBookmarks(ids: string[]) {
    if (this.state.offline) throw new Error("请联网后批量取消收藏");
    // Finish replaying queued visits before clearing their bookmark state.
    if (this.syncTask) await this.syncTask;
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const revisions = new Map(batch.map((id) => [id, this.data.pending[id]?.revision]));
      await this.api.removeBookmarks(batch);
      for (const id of batch) {
        if (this.data.pending[id]?.revision !== revisions.get(id)) continue;
        if (this.data.progress[id]) this.data.progress[id].is_bookmarked = false;
        if (this.data.pending[id]) this.data.pending[id].bookmark = false;
      }
      this.emit();
      await this.persist();
    }
  }
  async updateQuestion(id: string, input: { answer: string; explanation: string; expectedRevision?: number }) {
    if (this.state.offline) throw new Error("请联网后修改题目");
    if (this.syncTask) await this.syncTask;
    const question = await this.api.updateQuestion(id, input);
    this.remember([question]);
    await this.persist();
    return question;
  }
  async deleteQuestion(id: string) {
    if (this.state.offline) throw new Error("请联网后删除题目");
    if (this.syncTask) await this.syncTask;
    await this.api.deleteQuestion(id);
    this.data.questions = this.data.questions.filter((q) => q.id !== id);
    delete this.data.progress[id];
    delete this.data.pending[id];
    this.emit();
    await this.persist();
  }
  private async read<T>(online: () => Promise<T>, cached: () => T): Promise<T> {
    if (this.state.offline) return cached();
    try {
      const result = await online();
      this.emit({ offline: false });
      return result;
    } catch (error) {
      // Never hide a permission error or revoked session behind cached content.
      if (!(error instanceof ApiError) || error.status !== 0) throw error;
      this.emit({ offline: true });
      return cached();
    }
  }
  private localQuestions(filter: Filter = {}) {
    const keyword = filter.keyword?.toLocaleLowerCase();
    return this.data.questions.filter(
      (q) =>
        (!filter.categoryId || q.category_id === filter.categoryId) &&
        (!filter.difficulty || q.difficulty === filter.difficulty) &&
        (!keyword ||
          [q.title, q.content, q.answer, q.explanation, q.tags].some((text) =>
            text?.toLocaleLowerCase().includes(keyword),
          )),
    );
  }
  async questions(
    page = 1,
    filter: Filter = {},
    pageSize = 20,
  ): Promise<Page<Question>> {
    return this.read(
      async () => {
        const result = await this.api.questions(page, filter, pageSize);
        this.remember(result.data);
        await this.persist();
        return result;
      },
      () => {
        const questions = this.localQuestions(filter);
        return {
          data: questions.slice((page - 1) * pageSize, page * pageSize),
          total: questions.length,
          page,
          totalPages: Math.ceil(questions.length / pageSize),
        };
      },
    );
  }
  async question(id: string) {
    return this.read(
      async () => {
        const question = await this.api.question(id);
        this.remember([question]);
        await this.persist();
        return question;
      },
      () => {
        const question = this.data.questions.find((item) => item.id === id);
        if (!question)
          throw new Error("这道题尚未下载，请联网后在“我的”下载离线题库");
        return question;
      },
    );
  }
  async categories() {
    if (!this.canViewCategories) return [];
    return this.read(
      async () => {
        this.data.categories = await this.api.categories();
        this.emit();
        await this.persist();
        return this.data.categories;
      },
      () => this.data.categories,
    );
  }
  async bookmarks() {
    return this.read(
      async () => {
        const questions = await this.api.bookmarks("study");
        this.remember(questions);
        Object.values(this.data.progress).forEach((p) => {
          if (!this.data.pending[p.question_id]) p.is_bookmarked = false;
        });
        questions.forEach((q) => {
          if (!this.data.pending[q.id])
            this.data.progress[q.id] = {
              ...this.data.progress[q.id],
              question_id: q.id,
              is_bookmarked: true,
              last_viewed_at: this.data.progress[q.id]?.last_viewed_at || "",
              view_count: this.data.progress[q.id]?.view_count || 0,
            };
        });
        await this.persist();
        return this.localBookmarks();
      },
      () => this.localBookmarks(),
    );
  }
  private localBookmarks() {
    return this.data.questions.filter(
      (q) => this.data.progress[q.id]?.is_bookmarked,
    );
  }
  private localLast(categoryId?: string) {
    const ids = new Set(this.localQuestions({ categoryId }).map((q) => q.id));
    return (
      Object.values(this.data.progress)
        .filter((p) => p.last_viewed_at && ids.has(p.question_id))
        .sort((a, b) => b.last_viewed_at.localeCompare(a.last_viewed_at))[0] ||
      null
    );
  }
  async lastViewed(categoryId?: string) {
    // Locally queued visits are newer than server progress.
    const local = this.localLast(categoryId);
    if (local && this.data.pending[local.question_id]) return local;
    return this.read(
      async () => {
        const progress = await this.api.lastViewed("study", categoryId);
        if (progress && !this.data.pending[progress.question_id]) {
          this.data.progress[progress.question_id] = progress;
          await this.persist();
        }
        return progress;
      },
      () => local,
    );
  }
  async saveProgress(id: string, bookmark?: boolean) {
    const previous = this.data.progress[id];
    const previousPending = this.data.pending[id];
    const progress: Progress = {
      question_id: id,
      is_bookmarked: bookmark ?? previous?.is_bookmarked ?? false,
      last_viewed_at: new Date().toISOString(),
      view_count: (previous?.view_count || 0) + 1,
    };
    const pending = {
      revision: ++this.revision,
      bookmark: bookmark ?? this.data.pending[id]?.bookmark,
    };
    this.data.progress[id] = progress;
    this.data.pending[id] = pending;
    try {
      await this.persist();
      this.emit();
      return await this.read(
        async () => {
          const saved = await this.api.saveProgress(
            id,
            "study",
            pending.bookmark,
          );
          if (this.data.pending[id]?.revision === pending.revision) {
            delete this.data.pending[id];
            this.data.progress[id] = saved;
            await this.persist();
            this.emit();
          }
          return this.data.progress[id];
        },
        () => progress,
      );
    } catch (error) {
      if (this.data.pending[id]?.revision === pending.revision) {
        if (previous) this.data.progress[id] = previous;
        else delete this.data.progress[id];
        if (previousPending) this.data.pending[id] = previousPending;
        else delete this.data.pending[id];
        await this.persist().catch(() => undefined);
        this.emit();
      }
      throw error;
    }
  }
  async adjacent(id: string, direction: "next" | "prev", categoryId?: string) {
    return this.read(
      async () => {
        const result = await this.api.adjacent(id, direction, categoryId);
        const question =
          direction === "next" ? result.nextQuestion : result.prevQuestion;
        if (question) {
          this.remember([question]);
          await this.persist();
        }
        return question || null;
      },
      () => {
        const questions = this.localQuestions({ categoryId });
        const index = questions.findIndex((q) => q.id === id);
        return index < 0
          ? null
          : questions[index + (direction === "next" ? 1 : -1)] || null;
      },
    );
  }
  async random(categoryId?: string) {
    return this.read(
      async () => {
        const { randomQuestion } = await this.api.random(categoryId);
        if (randomQuestion) {
          this.remember([randomQuestion]);
          await this.persist();
        }
        return randomQuestion;
      },
      () => {
        const questions = this.localQuestions({ categoryId });
        return questions[Math.floor(Math.random() * questions.length)] || null;
      },
    );
  }
  sync({ automatic = false }: { automatic?: boolean } = {}): Promise<void> {
    if (this.syncTask) {
      // A manual refresh must still download if a lightweight sync is in flight.
      if (!automatic && !this.downloading)
        return this.syncTask.catch(() => undefined).then(() => this.sync());
      return this.syncTask;
    }
    const now = Date.now();
    const downloaded = Date.parse(this.data.downloadedAt || "");
    const stale = !Number.isFinite(downloaded) || now - downloaded >= 86400000;
    const due = !this.data.downloadedAt || (this.data.updateMode === "daily" && stale);
    const refreshMirror = !automatic || (due && (!this.data.downloadedAt || now - this.lastAutoDownload >= 300000));
    if (automatic && refreshMirror) this.lastAutoDownload = now;
    this.downloading = refreshMirror;
    this.syncTask = this.download(refreshMirror).finally(() => {
      this.syncTask = null;
      this.downloading = false;
    });
    return this.syncTask;
  }
  private async download(refreshMirror: boolean) {
    if (this.stopped) return;
    this.emit({ syncing: refreshMirror, ...(refreshMirror ? { syncError: "" } : {}) });
    try {
      // Revalidate the account before replacing the authorized offline mirror.
      await this.api.me();
      if (this.stopped) return;
      for (const [id, pending] of Object.entries(this.data.pending).sort(
        (a, b) => a[1].revision - b[1].revision,
      )) {
        if (this.stopped) return;
        try {
          const saved = await this.api.saveProgress(
            id,
            "study",
            pending.bookmark,
          );
          if (this.data.pending[id]?.revision === pending.revision) {
            this.data.progress[id] = saved;
            delete this.data.pending[id];
          }
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          if (this.data.pending[id]?.revision === pending.revision) {
            delete this.data.pending[id];
            delete this.data.progress[id];
          }
        }
        await this.persist();
      }
      // Foreground/reconnect events replay visits and bookmarks without repeatedly
      // fetching the entire question library. Manual refresh always bypasses age.
      if (!refreshMirror) {
        this.emit({ offline: false });
        return;
      }
      const questions: Question[] = [];
      for (let page = 1; ; page++) {
        const result = await this.api.questions(page, {}, 1000);
        if (this.stopped) return;
        questions.push(...result.data);
        if (page >= result.totalPages) break;
      }
      const [categories, bookmarks, last] = await Promise.all([
        this.canViewCategories ? this.api.categories() : Promise.resolve([]),
        this.api.bookmarks("study"),
        this.api.lastViewed("study"),
      ]);
      if (this.stopped) return;
      // Publish only a complete download; a failed refresh retains the old mirror.
      const progress = { ...this.data.progress };
      const bookmarkIds = new Set(bookmarks.map((q) => q.id));
      for (const question of questions) {
        if (!this.data.pending[question.id])
          progress[question.id] = {
            question_id: question.id,
            last_viewed_at: progress[question.id]?.last_viewed_at || "",
            view_count: progress[question.id]?.view_count || 0,
            is_bookmarked: bookmarkIds.has(question.id),
          };
      }
      if (last && !this.data.pending[last.question_id])
        progress[last.question_id] = last;
      const previous = this.data;
      this.data = {
        ...this.data,
        questions,
        categories,
        progress,
        downloadedAt: new Date().toISOString(),
      };
      try {
        await this.persist();
      } catch (error) {
        this.data = {
          ...this.data,
          questions: previous.questions,
          categories: previous.categories,
          downloadedAt: previous.downloadedAt,
        };
        throw error;
      }
      this.emit({ offline: false });
    } catch (error) {
      this.emit({
        offline: error instanceof ApiError && error.status === 0,
        syncError: error instanceof Error ? error.message : "离线题库下载失败",
      });
      throw error;
    } finally {
      this.emit({ syncing: false });
    }
  }
}
