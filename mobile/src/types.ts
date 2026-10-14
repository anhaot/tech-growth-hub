export interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  must_change_password: boolean;
  user_type: "independent" | "integrated";
  category_scopes: string[];
  permissions: Record<string, boolean>;
}
export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}
export type Difficulty = "easy" | "medium" | "hard";
export type Mode = "study" | "quiz";
export type AIAction = "analyze" | "expand" | "recommend" | "generate" | "chat";
export interface AIStatus {
  enabled: boolean;
  defaultProvider: string;
  defaultConfigId?: string;
  availableProviders: string[];
  availableModels?: { id: string; label: string; isActive: boolean }[];
}
export interface AIConfig {
  id: string;
  provider: string;
  displayName?: string;
  baseUrl?: string;
  model: string;
  isActive: boolean;
  isCustom: boolean;
  modelStatus?: "unknown" | "valid" | "invalid";
}
export interface AIConfigInput {
  provider: string;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  isCustom?: boolean;
}
export interface Question {
  id: string;
  revision?: number;
  title: string;
  content: string;
  answer: string;
  explanation: string | null;
  difficulty: Difficulty;
  category_id: string | null;
}
export interface Progress {
  question_id: string;
  is_bookmarked: boolean;
  last_viewed_at: string;
  view_count: number;
}
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
export interface Filter {
  keyword?: string;
  categoryId?: string;
  difficulty?: Difficulty;
}
export interface QuestionInput {
  title: string;
  content: string;
  answer: string;
  explanation?: string;
  difficulty: Difficulty;
  categoryId?: string;
}
export interface Session {
  server: string;
  token: string;
  user: User;
}
export type RootStackParams = {
  Tabs: { screen: "首页" | "学习" | "收藏" | "我的" } | undefined;
  Question: { id: string };
  Session: { categoryId?: string; resume?: boolean };
  LibrarySettings: undefined;
  ModelSettings: undefined;
  ModelEditor: { id?: string } | undefined;
};
export function permitted(user: User, permission: string): boolean {
  if (user.role === "admin" || user.permissions?.[permission]) return true;
  const compatible: Record<string, string[]> = {
    question_view: [
      "question_create",
      "question_edit_content",
      "question_edit_meta",
      "question_delete",
      "question_batch_edit",
    ],
    category_view: ["category_manage"],
  };
  return Boolean(
    compatible[permission]?.some((key) => user.permissions?.[key]),
  );
}
