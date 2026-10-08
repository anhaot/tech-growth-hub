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
  password_hash: string;
  must_change_password: boolean;
  role: 'admin' | 'user';
  user_type: 'independent' | 'integrated';
  library_owner_id: string | null;
  category_scopes: string[];
  permissions: UserPermissions;
  created_at: string;
  updated_at: string;
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

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewState {
  id: string;
  user_id: string;
  question_id: string;
  due_at: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
  last_rating: ReviewRating | null;
  last_reviewed_at: string | null;
  updated_at: string;
}

export interface ReviewEvent {
  id: string;
  user_id: string;
  question_id: string;
  rating: ReviewRating;
  reviewed_at: string;
  response_ms: number | null;
  created_at: string;
}

export interface ReviewQueueItem extends Question {
  review_state: ReviewState | null;
}

export interface AIConfig {
  id: string;
  user_id: string;
  provider: string;
  display_name?: string;
  base_url?: string;
  api_key: string;
  model: string;
  is_active: boolean;
  is_custom?: boolean;
  credential_id?: string;
  model_status?: 'unknown' | 'valid' | 'invalid';
  last_checked_at?: string;
  last_check_error?: string;
  created_at: string;
  updated_at: string;
}

export interface AICredential {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  api_key: string;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QuestionFilter {
  categoryId?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  keyword?: string;
  tags?: string[];
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

export type DatabaseType = 'sqlite' | 'mysql';

export interface SQLiteConnectionConfig {
  path: string;
}

export interface MySQLConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DatabaseConnectionConfig {
  type: DatabaseType;
  sqlite: SQLiteConnectionConfig;
  mysql: MySQLConnectionConfig;
}

export interface DatabaseProfile {
  id: string;
  name: string;
  type: DatabaseType;
  sqlite?: SQLiteConnectionConfig;
  mysql?: MySQLConnectionConfig;
  created_at: string;
  updated_at: string;
}

export interface SanitizedDatabaseProfile {
  id: string;
  name: string;
  type: DatabaseType;
  sqlite?: SQLiteConnectionConfig;
  mysql?: Omit<MySQLConnectionConfig, 'password'> & { hasPassword: boolean };
  created_at: string;
  updated_at: string;
}

export interface DatabaseRuntimeState {
  profiles: DatabaseProfile[];
  selectedProfileId: string | null;
}

export interface DatabaseRuntimeInfo {
  source: 'env' | 'profile';
  profileId: string | null;
  databaseType: DatabaseType;
  selectedProfileId: string | null;
}

export interface DatabaseTableCountSummary {
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

export interface DatabaseValidationReport {
  source: DatabaseTableCountSummary;
  target: DatabaseTableCountSummary;
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
