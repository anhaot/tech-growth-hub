import type {
  Category,
  Filter,
  Mode,
  Page,
  Progress,
  Question,
  QuestionInput,
  AIStatus,
  AIAction,
  AIConfig,
  AIConfigInput,
  User,
} from "./types";

import { answerText } from "./ai-response";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export class AIEmptyAnswerError extends ApiError {
  constructor(public readonly details: {
    server: string;
    action: AIAction;
    provider: string;
    resultKind: string;
    responseFields: string[];
  }) {
    super("题库服务没有返回回答正文。请重试，或在“我的”切换模型。", 502);
  }
}

// Store the installation URL without /api; both forms are accepted at login.
export function normalizeServer(input: string): string {
  let url: URL;
  try {
    url = new URL(
      input
        .trim()
        .replace(
          /^(https?):/i,
          (_, scheme: string) => `${scheme.toLowerCase()}:`,
        ),
    );
    // React Native's URL constructor accepts some invalid authorities.
    if (!url.origin || !url.hostname)
      throw new Error("Invalid service address");
  } catch {
    throw new Error("请输入完整的服务地址，例如 https://tiku.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("服务地址需要以 https:// 或 http:// 开头");
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error("服务地址不能包含账户、查询参数或锚点");
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${url.origin.toLowerCase()}${path}`;
}

export class ApiClient {
  constructor(
    public readonly server: string,
    private token?: string,
    private onAuthError?: (status: number) => void,
    private isConnected?: () => Promise<boolean>,
  ) {}

  async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 20_000,
    );
    try {
      if (this.isConnected && !(await this.isConnected()))
        throw new ApiError("当前离线", 0);
      const response = await fetch(`${this.server}/api${path}`, {
        method,
        // The native client uses bearer auth; browser preview follows the same protocol.
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      // Authentication is determined by HTTP status even when a proxy returns
      // HTML or an empty body instead of the API's JSON error envelope.
      if (!response.ok && this.token && (response.status === 401 || response.status === 428))
        this.onAuthError?.(response.status);
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ApiError(
          "服务返回了非 JSON 内容，请检查题库服务地址",
          response.status,
        );
      }
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error : "";
        throw new ApiError(
          message || `请求失败（${response.status}）`,
          response.status,
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw new ApiError("请求已取消", 0);
      if (controller.signal.aborted)
        throw new ApiError("连接超时，请检查网络后重试", 0);
      throw new ApiError("无法连接题库服务，请检查地址和网络", 0);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  login(username: string, password: string) {
    return this.request<{ token: string; user: User }>("/auth/login", "POST", {
      username,
      password,
    });
  }
  me() {
    return this.request<User>("/auth/me");
  }
  changePassword(password: string) {
    return this.request<User>("/auth/profile", "PUT", { password });
  }
  categories() {
    return this.request<Category[]>("/categories");
  }
  questions(page = 1, filter: Filter = {}, pageSize = 20) {
    return this.request<Page<Question>>(
      `/questions${query({ page, pageSize, ...filter })}`,
    );
  }
  question(id: string) {
    return this.request<Question>(`/questions/${encodeURIComponent(id)}`);
  }
  bookmarks(mode: Mode) {
    return this.request<Question[]>(`/questions/bookmarked${query({ mode })}`);
  }
  removeBookmarks(ids: string[], mode: Mode = "study") {
    return this.request<{ removedCount: number }>("/questions/bookmarked/remove", "POST", { ids, mode });
  }
  updateQuestion(id: string, input: { answer: string; explanation: string; expectedRevision?: number }) {
    return this.request<Question>(`/questions/${encodeURIComponent(id)}`, "PUT", input);
  }
  deleteQuestion(id: string) {
    return this.request(`/questions/${encodeURIComponent(id)}`, "DELETE");
  }
  async lastViewed(mode: Mode, categoryId?: string) {
    const value = await this.request<Progress | null>(
      `/questions/last-viewed${query({ mode, categoryId })}`,
    );
    return value
      ? { ...value, is_bookmarked: Boolean(value.is_bookmarked) }
      : null;
  }
  async progress(id: string, mode: Mode) {
    const value = await this.request<Progress | null>(
      `/questions/${encodeURIComponent(id)}/progress${query({ mode })}`,
    );
    return value
      ? { ...value, is_bookmarked: Boolean(value.is_bookmarked) }
      : null;
  }
  async saveProgress(id: string, mode: Mode, isBookmarked?: boolean) {
    const value = await this.request<Progress>(
      `/questions/${encodeURIComponent(id)}/progress`,
      "POST",
      { mode, ...(isBookmarked === undefined ? {} : { isBookmarked }) },
    );
    return { ...value, is_bookmarked: Boolean(value.is_bookmarked) };
  }
  adjacent(id: string, direction: "next" | "prev", categoryId?: string) {
    return this.request<{
      nextQuestion?: Question | null;
      prevQuestion?: Question | null;
    }>(
      `/questions/navigate/${encodeURIComponent(id)}/${direction}${query({ categoryId })}`,
    );
  }
  random(categoryId?: string) {
    return this.request<{ randomQuestion: Question | null }>(
      `/questions/navigate/random${query({ categoryId })}`,
    );
  }
  createQuestion(input: QuestionInput) {
    return this.request<Question>("/questions", "POST", input);
  }
  aiStatus(signal?: AbortSignal) {
    return this.request<AIStatus>("/ai/status", "GET", undefined, { signal });
  }
  async supplementQuestion(input: { questionId: string; field: 'answer' | 'explanation'; answer: string; explanation: string; provider?: string }, signal?: AbortSignal) {
    const response = await this.request<{ result: unknown; truncated?: boolean }>("/ai/supplement", "POST", input, { timeoutMs: 200_000, signal });
    const result = answerText(response?.result);
    if (!result.trim()) throw new ApiError("AI 没有返回有效的补充内容，请重试", 502);
    return { result, truncated: Boolean(response.truncated) };
  }
  aiConfigs() {
    return this.request<AIConfig[]>("/ai/config");
  }
  saveAIConfig(input: AIConfigInput, id?: string) {
    return this.request<AIConfig>(
      id ? `/ai/config/${encodeURIComponent(id)}` : "/ai/config",
      id ? "PUT" : "POST",
      input,
    );
  }
  activateAIConfig(id: string) {
    return this.request(`/ai/config/${encodeURIComponent(id)}/active`, "PUT");
  }
  deleteAIConfig(id: string) {
    return this.request(`/ai/config/${encodeURIComponent(id)}`, "DELETE");
  }
  aiModels(input: {
    configId?: string;
    baseUrl: string;
    apiKey?: string;
    isCustom?: boolean;
  }) {
    return this.request<{ models: { id: string }[] }>(
      "/ai/models",
      "POST",
      input,
      { timeoutMs: 45_000 },
    );
  }
  checkAIConfig(id: string) {
    return this.request<{ status: string; error?: string }>(
      `/ai/config/${encodeURIComponent(id)}/check`,
      "POST",
      undefined,
      { timeoutMs: 120_000 },
    );
  }
  async aiAction(
    questionId: string | undefined,
    action: AIAction,
    provider?: string,
    message?: string,
    signal?: AbortSignal,
  ) {
    const response = await this.request<{
      result: unknown;
      truncated?: boolean;
      finishReason?: string;
    }>(
      `/ai/${action}`,
      "POST",
      {
        ...(questionId ? { questionId } : {}),
        ...(provider ? { provider } : {}),
        ...(message ? { message } : {}),
        ...(action === "generate" ? { count: 3 } : {}),
      },
      { timeoutMs: 200_000, signal },
    );
    const result = answerText(response?.result);
    if (!result.trim())
      throw new AIEmptyAnswerError({
        server: this.server,
        action,
        provider: provider || "服务默认模型",
        resultKind: response?.result === null ? "null" : Array.isArray(response?.result) ? "文本块中没有正文" : typeof response?.result,
        responseFields: response && typeof response === "object" ? Object.keys(response).slice(0, 12) : [],
      });
    return { ...response, result };
  }
}
function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : "";
}
