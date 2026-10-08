import axios from 'axios';
import {
  User,
  Category,
  Question,
  LearningProgress,
  AIConfig,
  AICredential,
  AIModelCheckResult,
  AIModelInfo,
  PaginatedResult,
  ImportResult,
  ImportPreview,
  AIStatus,
  UserPermissions,
  TagSummary,
  TagHealthReport,
  DatabaseProfilesResponse,
  DatabaseValidationReport,
  DatabaseProfile,
  DatabaseCounts,
  DatabaseInfo,
  SimilarQuestionPair,
  QuestionVersion,
  DuplicateScanResult,
  BackupPayload,
} from '@/types';
import { clearStoredAuthState } from '@/store';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const method = String(config.method || 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && typeof document !== 'undefined') {
    const csrfToken = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('tgh_csrf='))
      ?.slice('tgh_csrf='.length);
    if (csrfToken) {
      config.headers['X-CSRF-Token'] = decodeURIComponent(csrfToken);
    } else {
      return axios.get<{ csrfToken: string }>('/api/auth/csrf', { withCredentials: true })
        .then((response) => {
          config.headers['X-CSRF-Token'] = response.data.csrfToken;
          return config;
        });
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        clearStoredAuthState();

        const pathname = window.location.pathname;
        const requestUrl = String(error.config?.url || '');
        const isAuthRoute = pathname === '/login' || pathname === '/register';
        const isSessionRestoreProbe = requestUrl.includes('/auth/me');

        if (!isAuthRoute && !isSessionRestoreProbe) {
          window.location.replace('/login');
        }
      }
    }
    if (error.response?.status === 428 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (typeof window !== 'undefined' && window.location.pathname !== '/change-password') {
        window.location.replace('/change-password');
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post<{ user: User; token: string }>('/auth/register', data),
  
  login: (data: { username: string; password: string }) =>
    api.post<{ user: User; token: string }>('/auth/login', data),

  logout: () => api.post<{ message: string }>('/auth/logout', {}),
  refreshSession: () => api.post<{ message: string }>('/auth/session', {}),
  
  getMe: () => api.get<User>('/auth/me'),
  
  updateProfile: (data: { username?: string; email?: string; password?: string }) =>
    api.put<User>('/auth/profile', data),
};

export const categoryApi = {
  getAll: () => api.get<Category[]>('/categories'),
  
  getById: (id: string) => api.get<Category>(`/categories/${id}`),
  
  create: (data: { name: string; description?: string; parentId?: string }) =>
    api.post<Category>('/categories', data),
  
  update: (id: string, data: { name?: string; description?: string; parentId?: string }) =>
    api.put<Category>(`/categories/${id}`, data),
  
  delete: (id: string) => api.delete(`/categories/${id}`),
};

export const questionApi = {
  getPosition: (id: string, params?: { categoryId?: string; tags?: string[] }) => api.get<{ index: number | null }>(`/questions/position/${id}`, { params }),
  getVersions: (id: string, page = 1) => api.get<PaginatedResult<QuestionVersion>>(`/questions/${id}/versions`, { params: { page } }),
  restoreVersion: (id: string, version: number, expectedRevision: number) => api.post<Question>(`/questions/${id}/versions/${version}/restore`, { expectedRevision }),
  startDuplicateScan: () => api.post<{ id: string }>('/questions/duplicates/scan'),
  getDuplicateScan: (id: string, page = 1, memberPage = 1) => api.get<DuplicateScanResult>(`/questions/duplicates/scan/${id}`, { params: { page, memberPage } }),
  getAll: (params?: { page?: number; pageSize?: number; categoryId?: string; difficulty?: string; keyword?: string; tags?: string[] }) =>
    api.get<PaginatedResult<Question>>('/questions', { params }),

  getTags: (params?: { categoryId?: string; difficulty?: string; keyword?: string }) =>
    api.get<TagSummary[]>('/questions/tags', { params }),

  getTagHealth: () =>
    api.get<TagHealthReport>('/questions/tags/health'),

  renameTag: (fromTag: string, toTag: string) =>
    api.put<{ updated: number; message: string }>('/questions/tags/rename', { fromTag, toTag }),

  deleteTag: (tagName: string) =>
    api.delete<{ updated: number; message: string }>('/questions/tags', { data: { tagName } }),

  normalizeTags: () =>
    api.post<{ updated: number; message: string }>('/questions/tags/normalize', {}),

  batchTags: (data: { ids: string[]; mode: 'add' | 'remove' | 'replace'; tags: string[] }) =>
    api.post<{ updated: number; message: string }>('/questions/batch-tags', data),

  getSimilarDuplicates: () =>
    api.get<{ total: number; pairs: SimilarQuestionPair[] }>('/questions/duplicates/similar'),

  mergeDuplicate: (keepId: string, removeId: string) =>
    api.post<{ message: string; keepId: string; removeId: string }>('/questions/duplicates/merge', { keepId, removeId }),
  
  getBookmarked: (mode?: string) => api.get<Question[]>('/questions/bookmarked', { params: { mode } }),
  
  getLastViewed: (mode?: string, categoryId?: string) => 
    api.get<LearningProgress | null>('/questions/last-viewed', { params: { mode, categoryId } }),

  resetLearningProgress: () =>
    api.delete<{ cleared: number; message: string }>('/questions/progress/reset'),
  
  getById: (id: string) => api.get<Question>(`/questions/${id}`),
  
  create: (data: { title: string; content: string; answer?: string; explanation?: string; difficulty?: string; categoryId?: string; tags?: string[] }) =>
    api.post<Question>('/questions', data),
  
  update: (id: string, data: Partial<{ source: 'edit' | 'ai-polish' | 'ai-answer'; expectedRevision: number; title: string; content: string; answer: string; explanation: string; difficulty: string; categoryId: string; tags: string[] }>) =>
    api.put<Question>(`/questions/${id}`, data),
  
  delete: (id: string) => api.delete(`/questions/${id}`),
  
  batchDelete: (ids: string[]) => api.post('/questions/batch-delete', { ids }),
  
  clearAll: () => api.delete('/questions/clear-all'),
  
  export: (categoryId?: string) => api.get<{ questions: any[]; total: number }>('/questions/export', { params: { categoryId } }),
  
  saveProgress: (questionId: string, data: { mode: string; isBookmarked?: boolean }) =>
    api.post<LearningProgress>(`/questions/${questionId}/progress`, data),
  
  getProgress: (questionId: string, mode?: string) =>
    api.get<LearningProgress | null>(`/questions/${questionId}/progress`, { params: { mode } }),
  
  getNext: (id: string, categoryId?: string) =>
    api.get<{ nextQuestion: Question | null }>(`/questions/navigate/${id}/next`, { params: { categoryId } }),
  
  getPrev: (id: string, categoryId?: string) =>
    api.get<{ prevQuestion: Question | null }>(`/questions/navigate/${id}/prev`, { params: { categoryId } }),
  
  getRandom: (categoryId?: string) =>
    api.get<{ randomQuestion: Question | null }>('/questions/navigate/random', { params: { categoryId } }),
};

export const importApi = {
  previewFile: (format: 'csv' | 'json' | 'markdown', file: File, categoryId?: string) => {
    const data = new FormData(); data.append('file', file);
    if (categoryId) data.append('categoryId', categoryId);
    return api.post<ImportPreview>(`/import/preview/${format}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  previewText: (questions: unknown[], categoryId?: string) => api.post<ImportPreview>('/import/preview/text', { questions, categoryId }),
  getPreview: (id: string, page: number) => api.get<ImportPreview>(`/import/preview/${id}`, { params: { page } }),
  commitPreview: (id: string, excludedRows: number[]) => api.post<ImportResult>(`/import/preview/${id}/commit`, { excludedRows }),
  importCsv: (file: File, categoryId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (categoryId) formData.append('categoryId', categoryId);
    return api.post<ImportResult>('/import/csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  importJson: (file: File, categoryId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (categoryId) formData.append('categoryId', categoryId);
    return api.post<ImportResult>('/import/json', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  importMarkdown: (file: File, categoryId?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (categoryId) formData.append('categoryId', categoryId);
    return api.post<ImportResult>('/import/markdown', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  
  importText: (questions: Array<{ title: string; content: string; answer: string; explanation?: string; difficulty?: string; tags?: string[] }>, categoryId?: string) =>
    api.post<ImportResult>('/import/text', { questions, categoryId }),
};

export const aiApi = {
  getStatus: () => api.get<AIStatus>('/ai/status'),
  
  updateSettings: (data: { enabled?: boolean; defaultProvider?: string }) =>
    api.put<AIStatus>('/ai/settings', data),
  
  getConfigs: () => api.get<AIConfig[]>('/ai/config'),

  getCredentials: () => api.get<AICredential[]>('/ai/credentials'),

  createCredential: (data: { name: string; baseUrl: string; apiKey: string }) =>
    api.post<AICredential>('/ai/credentials', data),

  updateCredential: (id: string, data: { name?: string; baseUrl?: string; apiKey?: string }) =>
    api.put<AICredential>(`/ai/credentials/${id}`, data),

  deleteCredential: (id: string) => api.delete(`/ai/credentials/${id}`),

  getModels: (data: {
    configId?: string;
    credentialId?: string;
    baseUrl?: string;
    apiKey?: string;
    isCustom?: boolean;
  }) => api.post<{ models: AIModelInfo[] }>('/ai/models', data),
  
  createConfig: (data: { 
    provider: string; 
    displayName?: string;
    baseUrl?: string;
    apiKey?: string; 
    model: string;
    isCustom?: boolean;
    sourceConfigId?: string;
    credentialId?: string;
  }) => api.post<AIConfig>('/ai/config', data),
  
  updateConfig: (id: string, data: { 
    provider?: string; 
    displayName?: string;
    baseUrl?: string;
    apiKey?: string; 
    model?: string;
    isCustom?: boolean;
    credentialId?: string;
  }) => api.put<AIConfig>(`/ai/config/${id}`, data),
  
  deleteConfig: (id: string) => api.delete(`/ai/config/${id}`),

  deleteInvalidConfigs: () => api.delete<{ deleted: number }>('/ai/config/invalid'),
  
  setActiveConfig: (id: string) => api.put(`/ai/config/${id}/active`),

  checkConfig: (id: string) =>
    api.post<AIModelCheckResult>(`/ai/config/${id}/check`),

  checkAllConfigs: () =>
    api.post<{ results: AIModelCheckResult[] }>('/ai/config/check-all'),
  
  analyze: (questionId: string, provider?: string) =>
    api.post<{ result: string }>('/ai/analyze', { questionId, provider }),
  
  expand: (questionId: string, provider?: string) =>
    api.post<{ result: string }>('/ai/expand', { questionId, provider }),
  
  recommend: (questionId: string, provider?: string) =>
    api.post<{ result: string }>('/ai/recommend', { questionId, provider }),
  
  generate: (questionId: string, count?: number, provider?: string) =>
    api.post<{ result: string }>('/ai/generate', { questionId, count, provider }),
  
  explain: (concept: string, context?: string, provider?: string) =>
    api.post<{ result: string }>('/ai/explain', { concept, context, provider }),
  
  chat: (questionId: string, message: string, provider?: string) =>
    api.post<{ result: string }>('/ai/chat', { questionId, message, provider }),
  
  testConfig: (configId: string) =>
    api.post<{ success: boolean; message: string; result: string }>('/ai/test-config', { configId }),

  batchGenerate: (data: {
    topic: string;
    count?: number;
    difficulty?: 'easy' | 'medium' | 'hard' | 'mixed';
    mode?: 'quick' | 'practice' | 'teaching';
    requirements?: string;
    provider?: string;
    categoryName?: string;
  }) => api.post<{
    questions: Array<{
      title: string;
      content: string;
      answer: string;
      explanation?: string;
      difficulty?: 'easy' | 'medium' | 'hard';
      tags?: string[];
    }>;
    raw: string;
  }>('/ai/batch-generate', data),

  polishQuestion: (questionId: string, mode?: 'light' | 'deep', provider?: string) =>
    api.post<{
      question: Question;
      draft: {
        title: string;
        content: string;
        answer: string;
        explanation: string;
        difficulty: 'easy' | 'medium' | 'hard';
        tags: string[];
      };
      raw: string;
    }>('/ai/polish-question', { questionId, mode, provider }),

  answerDraft: (questionId: string, mode?: 'quick' | 'practice' | 'teaching', provider?: string) =>
    api.post<{
      question: Question;
      draft: {
        answer: string;
        explanation: string;
        tags: string[];
        mode: 'quick' | 'practice' | 'teaching';
      };
      raw: string;
    }>('/ai/answer-draft', { questionId, mode, provider }),

  answerDraftsRaw: (data: {
    questions: Array<{ clientId: string; content: string; difficulty?: 'easy' | 'medium' | 'hard' }>;
    mode?: 'quick' | 'practice' | 'teaching';
    provider?: string;
  }) => api.post<{
    drafts: Array<{
      clientId: string;
      answer: string;
      explanation: string;
      difficulty: 'easy' | 'medium' | 'hard';
      tags: string[];
    }>;
  }>('/ai/answer-drafts/raw', data),

  batchGenerateTags: (data: { ids: string[]; mode?: 'add' | 'replace'; provider?: string }) =>
    api.post<{
      updated: number;
      total: number;
      message: string;
      results: Array<{ questionId: string; tags: string[] }>;
    }>('/ai/batch-tags', data),
};

export const adminApi = {
  getInfo: () => api.get<DatabaseInfo>('/admin/info'),
  
  getStats: () => api.get<{ questionCount: number; categoryCount: number }>('/admin/stats'),
  
  getUsers: (page?: number, pageSize?: number) =>
    api.get<PaginatedResult<User>>('/admin/users', { params: { page, pageSize } }),
  
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),

  getSettings: () => api.get<{ allowRegister: boolean; tagAliases?: Record<string, string>; loginSessionDuration: string }>('/admin/settings'),
  
  updateSetting: (key: string, value: string) =>
    api.put(`/admin/settings/${key}`, { value }),
  
  getPublicSettings: () => api.get<{ allowRegister: boolean }>('/admin/public'),
  
  getAllUsers: () => api.get<User[]>('/admin/users'),

  getUserCategories: (id: string) => api.get<Category[]>(`/admin/users/${id}/categories`),

  createUser: (data: {
    username: string;
    email: string;
    password: string;
    role?: 'admin' | 'user';
    userType?: 'independent' | 'integrated';
    libraryOwnerId?: string | null;
    categoryScopes?: string[];
    permissions?: UserPermissions;
  }) =>
    api.post<User>('/admin/users', data),
  
  updateUserRole: (id: string, role: string) =>
    api.put<User>(`/admin/users/${id}/role`, { role }),
  
  updateUser: (id: string, data: {
    username?: string;
    email?: string;
    password?: string;
    role?: 'admin' | 'user';
    userType?: 'independent' | 'integrated';
    libraryOwnerId?: string | null;
    categoryScopes?: string[];
    permissions?: UserPermissions;
  }) =>
    api.put<User>(`/admin/users/${id}`, data),

  getDatabaseProfiles: () =>
    api.get<DatabaseProfilesResponse>('/admin/database/profiles'),

  createDatabaseProfile: (data: {
    name: string;
    type: 'sqlite' | 'mysql';
    sqlite?: { path: string };
    mysql?: { host: string; port: number; user: string; password?: string; database: string };
  }) => api.post<DatabaseProfile>('/admin/database/profiles', data),

  updateDatabaseProfile: (id: string, data: {
    name: string;
    type: 'sqlite' | 'mysql';
    sqlite?: { path: string };
    mysql?: { host: string; port: number; user: string; password?: string; database: string };
  }) => api.put<DatabaseProfile>(`/admin/database/profiles/${id}`, data),

  deleteDatabaseProfile: (id: string) =>
    api.delete<{ message: string }>(`/admin/database/profiles/${id}`),

  testDatabaseProfile: (id: string) =>
    api.post<{ success: boolean; message: string }>(`/admin/database/profiles/${id}/test`, {}),

  initDatabaseProfile: (id: string) =>
    api.post<{ message: string; counts: Record<string, number> }>(`/admin/database/profiles/${id}/init`, {}),

  migrateDatabaseProfile: (id: string, overwrite = false) =>
    api.post<{ message: string; report: DatabaseValidationReport }>(`/admin/database/profiles/${id}/migrate`, { overwrite }),

  validateDatabaseProfile: (id: string) =>
    api.post<DatabaseValidationReport>(`/admin/database/profiles/${id}/validate`, {}),

  selectDatabaseProfile: (id: string) =>
    api.post<{ message: string; selectedProfileId: string; needsRestart: boolean }>(`/admin/database/profiles/${id}/select`, {}),

  useEnvDatabase: () =>
    api.post<{ message: string; selectedProfileId: null; needsRestart: boolean }>('/admin/database/use-env', {}),

  exportBackup: () =>
    api.get<BackupPayload>('/admin/backup/export'),

  restoreBackup: (dataset: BackupPayload['dataset']) =>
    api.post<{ message: string; counts: DatabaseCounts }>('/admin/backup/restore', { dataset }),
};

export default api;
