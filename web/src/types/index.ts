export interface UserPermissions {
  question_view: boolean;
  question_create: boolean;
  question_edit_content: boolean;
  question_edit_meta: boolean;
  question_delete: boolean;
  question_batch_edit: boolean;
  category_view: boolean;
  category_manage: boolean;
  import_manage: boolean;
  question_export: boolean;
  ai_use: boolean;
  ai_generate: boolean;
  ai_config_manage: boolean;
  ai_chat: boolean;
  tag_manage: boolean;
  duplicate_manage: boolean;
  backup_export: boolean;
  backup_restore: boolean;
  ai_polish: boolean;
  system_manage: boolean;
  user_manage: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  must_change_password: boolean;
  user_type: 'independent' | 'integrated';
  library_owner_id: string | null;
  category_scopes: string[];
  permissions: UserPermissions;
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Question {
  revision?: number;
  id: string;
  title: string;
  content: string;
  answer: string;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  category_id: string | null;
  user_id: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface LearningProgress {
  id: string;
  user_id: string;
  question_id: string;
  mode: 'study' | 'quiz';
  last_viewed_at: string;
  view_count: number;
  is_bookmarked: boolean;
}

export interface InterviewDraft {
  id: string;
  content: string;
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AIConfig {
  id: string;
  provider: string;
  displayName?: string;
  baseUrl?: string;
  model: string;
  isActive: boolean;
  isCustom?: boolean;
  credentialId?: string;
  modelStatus?: 'unknown' | 'valid' | 'invalid';
  lastCheckedAt?: string;
  lastCheckError?: string;
  createdAt: string;
}

export interface AICredential {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: string;
}

export interface AIModelInfo {
  id: string;
}

export interface AIModelCheckResult {
  id: string;
  model: string;
  status: 'unknown' | 'valid' | 'invalid';
  checkedAt: string;
  error?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImportPreview {
  id: string; expiresAt: string; total: number; valid: number; invalid: number;
  page: number; pageSize: number; totalPages: number;
  rows: Array<{ row: number; error?: string; warnings: string[]; question?: {
    title: string; content: string; answer: string; explanation: string;
    difficulty: 'easy' | 'medium' | 'hard'; categoryId: string | null; tags: string[];
  } }>;
}

export interface ImportResult {
  skipped?: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

export interface TagSummary {
  name: string;
  count: number;
}

export interface TagHealthPair {
  left: string;
  right: string;
  reason: string;
}

export interface TagHealthReport {
  lowFrequency: TagSummary[];
  aliased: Array<{ alias: string; target: string }>;
  similarPairs: TagHealthPair[];
}

export interface SimilarQuestionPair {
  left: Question;
  right: Question;
  titleScore: number;
  contentScore: number;
  score: number;
}

export interface BackupPayload {
  meta: {
    exportedAt: string;
    databaseType: DatabaseType | string;
    counts: DatabaseCounts;
  };
  dataset: {
    users?: Record<string, unknown>[];
    categories?: Record<string, unknown>[];
    questions?: Record<string, unknown>[];
    question_versions?: Record<string, unknown>[];
    learning_progress?: Record<string, unknown>[];
    review_states?: Record<string, unknown>[];
    review_events?: Record<string, unknown>[];
    ai_credentials?: Record<string, unknown>[];
    ai_configs?: Record<string, unknown>[];
    system_settings?: Record<string, unknown>[];
  };
}

export interface AIStatus {
  enabled: boolean;
  defaultProvider: string;
  availableProviders: string[];
  defaultConfigId?: string;
  availableModels?: AIModelOption[];
}

export interface AIModelOption {
  id: string;
  label: string;
  provider: string;
  model: string;
  isActive: boolean;
}

export type DatabaseType = 'sqlite' | 'mysql';

export interface DatabaseInfo {
  databaseType: DatabaseType | string;
  databaseEngine: 'SQLite' | 'MySQL' | 'MariaDB' | string;
  databaseVersion: string;
  connected: boolean;
  applicationVersion: string;
  version?: string;
  runtime?: {
    source: 'env' | 'profile';
    profileId: string | null;
    selectedProfileId: string | null;
  };
}

export interface DatabaseProfile {
  id: string;
  name: string;
  type: DatabaseType;
  sqlite?: {
    path: string;
  };
  mysql?: {
    host: string;
    port: number;
    user: string;
    database: string;
    hasPassword: boolean;
  };
  created_at: string;
  updated_at: string;
}

export interface DatabaseCounts {
  users: number;
  categories: number;
  questions: number;
  question_versions: number;
  learning_progress: number;
  review_states: number;
  review_events: number;
  ai_credentials: number;
  ai_configs: number;
  system_settings: number;
}

export interface DatabaseRuntimeInfo {
  source: 'env' | 'profile';
  profileId: string | null;
  databaseType: DatabaseType;
  selectedProfileId: string | null;
}

export interface DatabaseProfilesResponse {
  current: {
    databaseType: DatabaseType;
    runtime: DatabaseRuntimeInfo;
    counts: DatabaseCounts;
  };
  selectedProfileId: string | null;
  needsRestart: boolean;
  profiles: DatabaseProfile[];
}

export interface DatabaseValidationReport {
  source: DatabaseCounts;
  target: DatabaseCounts;
  matches: boolean;
}

export interface QuestionVersion {
  id: string;
  question_id: string;
  version: number;
  snapshot: string;
  actor_id: string | null;
  actor_name?: string | null;
  source: string;
  created_at: string;
}

export interface DuplicateScanResult {
  memberPage: number;
  id: string;
  status: 'running' | 'completed' | 'failed';
  processed: number;
  totalQuestions: number;
  total: number;
  available: number;
  groupTotal: number;
  pairs: SimilarQuestionPair[];
  groups: Array<{ title: string; count: number; questions: Question[] }>;
  truncated: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  comparisons: number;
}
