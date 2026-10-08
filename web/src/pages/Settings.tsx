import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore, useAIStore } from '@/store';
import { categoryApi, aiApi, adminApi, questionApi, authApi } from '@/api';
import { getTagColorClasses } from '@/lib/tagColors';
import { getSingleValueSuggestions } from '@/lib/tagSuggestions';
import {
  Category,
  AIConfig,
  AICredential,
  AIModelCheckResult,
  AIModelInfo,
  AIStatus,
  User,
  UserPermissions,
  TagSummary,
  TagHealthReport,
  DatabaseInfo,
} from '@/types';
import { LoadingSpinner } from '@/components/ui';
import { DatabaseStatus } from '@/components/settings/DatabaseStatus';
import { DatabaseMigrationDialog } from '@/components/settings/DatabaseMigrationDialog';
import { toast } from 'react-hot-toast';
import {
  Database,
  Brain,
  FolderOpen,
  Tags,
  Plus,
  Edit,
  Trash2,
  Settings,
  Shield,
  Sparkles,
  X,
  Check,
  Key,
  Cpu,
  Play,
  Users,
  UserCog,
  Download,
  Upload,
  RefreshCcw,
  AlertTriangle,
} from 'lucide-react';

const DEFAULT_USER_PERMISSIONS: UserPermissions = {
  question_view: false,
  question_create: false,
  question_edit_content: false,
  question_edit_meta: false,
  question_delete: false,
  question_batch_edit: false,
  category_view: false,
  category_manage: false,
  import_manage: false,
  question_export: false,
  ai_use: false,
  ai_generate: false,
  ai_config_manage: false,
  ai_chat: false,
  tag_manage: false,
  duplicate_manage: false,
  backup_export: false,
  backup_restore: false,
  ai_polish: false,
  system_manage: false,
  user_manage: false,
};

const ADMIN_PERMISSIONS: UserPermissions = {
  question_view: true,
  question_create: true,
  question_edit_content: true,
  question_edit_meta: true,
  question_delete: true,
  question_batch_edit: true,
  category_view: true,
  category_manage: true,
  import_manage: true,
  question_export: true,
  ai_use: true,
  ai_generate: true,
  ai_config_manage: true,
  ai_chat: true,
  tag_manage: true,
  duplicate_manage: true,
  backup_export: true,
  backup_restore: true,
  ai_polish: true,
  system_manage: true,
  user_manage: true,
};

const PERMISSION_OPTIONS: Array<{ key: keyof UserPermissions; label: string; description: string }> = [
  { key: 'question_view', label: '题目查看', description: '查看题库和题目详情' },
  { key: 'question_create', label: '新增题目', description: '创建单题和写入题库' },
  { key: 'question_edit_content', label: '编辑题目内容', description: '修改题干、答案、解析' },
  { key: 'question_edit_meta', label: '编辑题目属性', description: '修改分类、难度、标签等元信息' },
  { key: 'question_delete', label: '删除题目', description: '删除单题和批量删除' },
  { key: 'question_batch_edit', label: '批量改题', description: '批量标签和批量题目处理' },
  { key: 'question_export', label: '导出题目', description: '导出题库内容' },
  { key: 'category_view', label: '分类查看', description: '查看分类列表和分类结构' },
  { key: 'category_manage', label: '分类管理', description: '新增、编辑、删除分类' },
  { key: 'import_manage', label: '导入权限', description: '批量导入、单题导入' },
  { key: 'ai_use', label: 'AI 基础使用', description: '基础 AI 助手与解析能力' },
  { key: 'ai_generate', label: 'AI 生题', description: '批量生题和相似题生成' },
  { key: 'ai_polish', label: 'AI 润色', description: '对单题进行 AI 润色并写回题库' },
  { key: 'ai_chat', label: 'AI 对话', description: 'AI 助手深度对话和问答' },
  { key: 'ai_config_manage', label: 'AI 配置管理', description: '管理模型、密钥和默认配置' },
  { key: 'tag_manage', label: '标签管理', description: '批量标签操作、标签整理与维护' },
  { key: 'duplicate_manage', label: '查重功能', description: '精确查重、相似题查重处理' },
  { key: 'backup_export', label: '备份导出', description: '导出完整系统备份' },
  { key: 'backup_restore', label: '备份恢复', description: '恢复完整系统备份' },
  { key: 'system_manage', label: '系统管理', description: '系统设置、数据库信息' },
  { key: 'user_manage', label: '用户管理', description: '创建用户、编辑用户、删除用户' },
];

const PERMISSION_GROUPS: Array<{
  title: string;
  description: string;
  keys: Array<keyof UserPermissions>;
}> = [
  {
    title: '题库权限',
    description: '控制题目查看、录入、编辑、删除、批量处理和导出。',
    keys: ['question_view', 'question_create', 'question_edit_content', 'question_edit_meta', 'question_delete', 'question_batch_edit', 'question_export', 'import_manage'],
  },
  {
    title: '分类与治理',
    description: '控制分类、标签和查重等题库治理能力。',
    keys: ['category_view', 'category_manage', 'tag_manage', 'duplicate_manage'],
  },
  {
    title: 'AI 权限',
    description: '控制 AI 助手、生题、润色、对话和配置。',
    keys: ['ai_use', 'ai_generate', 'ai_polish', 'ai_chat', 'ai_config_manage'],
  },
  {
    title: '系统权限',
    description: '控制备份、系统设置和用户管理。',
    keys: ['backup_export', 'backup_restore', 'system_manage', 'user_manage'],
  },
];

const hasPermission = (user: User | null, permission: keyof UserPermissions) => {
  if (!user) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  return Boolean(user.permissions?.[permission]);
};

export const SettingsPage: React.FC = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const { setStatus: setAIStoreStatus } = useAIStore();
  const [activeTab, setActiveTab] = useState<'system' | 'categories' | 'ai' | 'database'>('system');
  const [categories, setCategories] = useState<Category[]>([]);
  const [aiStatus, setAIStatus] = useState<AIStatus | null>(null);
  const [aiConfigs, setAIConfigs] = useState<AIConfig[]>([]);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [databaseMigrationOpen, setDatabaseMigrationOpen] = useState(false);
  const loadedTabsRef = useRef(new Set<string>());

  const handleAIStatusChange = (status: AIStatus) => {
    setAIStatus(status);
    setAIStoreStatus({
      enabled: status.enabled,
      defaultProvider: status.defaultProvider,
      availableProviders: status.availableProviders,
    });
  };

  const fetchCategories = async () => {
    try {
      const response = await categoryApi.getAll();
      setCategories(response.data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchAIStatus = async () => {
    try {
      const response = await aiApi.getStatus();
      setAIStatus(response.data);
    } catch (error) {
      console.error('Failed to fetch AI status:', error);
    }
  };

  const fetchAIConfigs = async () => {
    try {
      const response = await aiApi.getConfigs();
      setAIConfigs(response.data);
    } catch (error) {
      console.error('Failed to fetch AI configs:', error);
    }
  };

  const fetchDbInfo = async () => {
    try {
      const response = await adminApi.getInfo();
      setDbInfo(response.data);
    } catch (error) {
      console.error('Failed to fetch db info:', error);
    }
  };

  useEffect(() => {
    if (loadedTabsRef.current.has(activeTab)) {
      return;
    }

    loadedTabsRef.current.add(activeTab);
    if (activeTab === 'categories') {
      void fetchCategories();
    } else if (activeTab === 'ai') {
      void Promise.all([fetchAIStatus(), fetchAIConfigs()]);
    } else if (activeTab === 'database') {
      void fetchDbInfo();
    }
  }, [activeTab]);

  const tabs = [
    ...(hasPermission(user, 'system_manage') || hasPermission(user, 'user_manage') || isAdmin
      ? [{ id: 'system' as const, label: '系统管理', icon: Shield, color: 'from-rose-500 to-pink-600' }]
      : []),
    ...(hasPermission(user, 'category_manage')
      ? [{ id: 'categories' as const, label: '分类管理', icon: FolderOpen, color: 'from-amber-500 to-orange-600' }]
      : []),
    ...(hasPermission(user, 'ai_config_manage')
      ? [{ id: 'ai' as const, label: 'AI设置', icon: Brain, color: 'from-violet-500 to-purple-600' }]
      : []),
    ...(hasPermission(user, 'system_manage')
      ? [{ id: 'database' as const, label: '数据库', icon: Database, color: 'from-emerald-500 to-teal-600' }]
      : []),
  ] as const;

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab) && tabs.length > 0) {
      setActiveTab(tabs[0].id);
    }
  }, [activeTab, tabs]);

  return (
    <div className="mobile-settings page-shell">
      <div className="lg:hidden">
        <h1 className="text-lg font-bold text-gray-900">设置</h1>
        <p className="mt-0.5 text-xs text-gray-500">管理题库、账号与系统服务</p>
      </div>

      <div className="hidden items-center gap-3 lg:flex">
        <div className="hidden rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 p-3 shadow-lg lg:block">
          <Settings className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">系统设置</h1>
          <p className="text-xs text-gray-500 lg:text-sm">权限、标签、AI 与数据库配置</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const mobileDescription = {
            system: '账号与备份',
            categories: '分类与标签',
            ai: '模型与密钥',
            database: '连接与迁移',
          }[tab.id];
          return (
            <button
              key={tab.id}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex min-h-[3.75rem] min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all lg:min-h-0 lg:gap-3 lg:p-4 ${
                isActive
                  ? `border-transparent bg-gradient-to-r ${tab.color} text-white shadow-sm lg:shadow-lg`
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={18} className="shrink-0 lg:h-5 lg:w-5" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold lg:text-sm">{tab.label}</span>
                <span className={`mt-0.5 block truncate text-[10px] lg:hidden ${isActive ? 'text-white/75' : 'text-gray-400'}`}>
                  {mobileDescription}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mobile-settings-content">
        {activeTab === 'system' && (hasPermission(user, 'system_manage') || hasPermission(user, 'user_manage') || isAdmin) && <SystemSettings />}
        {activeTab === 'categories' && (
          <CategorySettings
            categories={categories}
            onRefresh={fetchCategories}
          />
        )}
        {activeTab === 'ai' && (
          <AISettings
            aiStatus={aiStatus}
            aiConfigs={aiConfigs}
            onRefresh={() => {
              fetchAIStatus();
              fetchAIConfigs();
            }}
            onStatusChange={handleAIStatusChange}
          />
        )}
        {activeTab === 'database' && (
          <>
            <DatabaseStatus dbInfo={dbInfo} onOpenMigration={() => setDatabaseMigrationOpen(true)} />
            <DatabaseMigrationDialog
              open={databaseMigrationOpen}
              onClose={() => setDatabaseMigrationOpen(false)}
              onChanged={fetchDbInfo}
            />
          </>
        )}
      </div>
    </div>
  );
};

interface CategorySettingsProps {
  categories: Category[];
  onRefresh: () => void;
}

const CategorySettings: React.FC<CategorySettingsProps> = ({ categories, onRefresh }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [renamingTag, setRenamingTag] = useState<TagSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [normalizingTags, setNormalizingTags] = useState(false);
  const [tagAliases, setTagAliases] = useState<Array<{ alias: string; target: string }>>([]);
  const [aliasForm, setAliasForm] = useState({ alias: '', target: '' });
  const [savingAliases, setSavingAliases] = useState(false);
  const [tagHealth, setTagHealth] = useState<TagHealthReport | null>(null);
  const [loadingTagHealth, setLoadingTagHealth] = useState(true);
  const matchedAliasTargets = getSingleValueSuggestions(aliasForm.target, tags);

  const fetchTags = async () => {
    setLoadingTags(true);
    try {
      const response = await questionApi.getTags();
      setTags(response.data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    } finally {
      setLoadingTags(false);
    }
  };

  useEffect(() => {
    fetchTags();
    fetchTagAliases();
    fetchTagHealth();
  }, []);

  const fetchTagAliases = async () => {
    try {
      const response = await adminApi.getSettings();
      const aliases = Object.entries(response.data.tagAliases || {}).map(([alias, target]) => ({ alias, target }));
      aliases.sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'));
      setTagAliases(aliases);
    } catch (error) {
      console.error('Failed to fetch tag aliases:', error);
    }
  };

  const fetchTagHealth = async () => {
    setLoadingTagHealth(true);
    try {
      const response = await questionApi.getTagHealth();
      setTagHealth(response.data);
    } catch (error) {
      console.error('Failed to fetch tag health:', error);
    } finally {
      setLoadingTagHealth(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此分类吗？')) return;

    try {
      await categoryApi.delete(id);
      toast.success('删除成功');
      onRefresh();
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(`确定要删除标签“${tagName}”吗？这会把它从所有题目中移除。`)) return;

    try {
      const response = await questionApi.deleteTag(tagName);
      toast.success(response.data.message);
      fetchTags();
      fetchTagHealth();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '删除标签失败');
    }
  };

  const handleRenameTag = async () => {
    if (!renamingTag) return;

    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error('请输入新标签名');
      return;
    }

    try {
      const response = await questionApi.renameTag(renamingTag.name, nextName);
      toast.success(response.data.message);
      setRenamingTag(null);
      setRenameValue('');
      fetchTags();
      fetchTagHealth();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '重命名标签失败');
    }
  };

  const renameTagDirectly = async (fromTag: string, toTag: string) => {
    if (fromTag === toTag) {
      return;
    }

    try {
      const response = await questionApi.renameTag(fromTag, toTag);
      toast.success(response.data.message);
      fetchTags();
      fetchTagHealth();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '合并标签失败');
    }
  };

  const handleNormalizeTags = async () => {
    setNormalizingTags(true);
    try {
      const response = await questionApi.normalizeTags();
      toast.success(response.data.message);
      fetchTags();
      fetchTagHealth();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '规范化标签失败');
    } finally {
      setNormalizingTags(false);
    }
  };

  const saveTagAliases = async (nextAliases: Array<{ alias: string; target: string }>) => {
    setSavingAliases(true);
    try {
      const payload = JSON.stringify(
        nextAliases.reduce<Record<string, string>>((acc, item) => {
          const alias = item.alias.trim().toLowerCase();
          const target = item.target.trim().toLowerCase();
          if (alias && target && alias !== target) {
            acc[alias] = target;
          }
          return acc;
        }, {})
      );
      await adminApi.updateSetting('tag_aliases', payload);
      setTagAliases(nextAliases);
      toast.success('标签别名已保存');
      fetchTagHealth();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存标签别名失败');
    } finally {
      setSavingAliases(false);
    }
  };

  const handleAddAlias = async () => {
    const alias = aliasForm.alias.trim().toLowerCase();
    const target = aliasForm.target.trim().toLowerCase();
    if (!alias || !target) {
      toast.error('请填写别名和主标签');
      return;
    }
    if (alias === target) {
      toast.error('别名和主标签不能相同');
      return;
    }
    const nextAliases = [...tagAliases.filter((item) => item.alias !== alias), { alias, target }]
      .sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'));
    await saveTagAliases(nextAliases);
    setAliasForm({ alias: '', target: '' });
  };

  const handleDeleteAlias = async (alias: string) => {
    const nextAliases = tagAliases.filter((item) => item.alias !== alias);
    await saveTagAliases(nextAliases);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg">
              <FolderOpen className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">分类管理</h2>
          </div>
          <button
            onClick={() => { setEditingCategory(null); setShowModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl text-white text-sm font-medium hover:from-amber-600 hover:to-orange-700 transition-colors"
          >
            <Plus size={18} />
            添加分类
          </button>
        </div>

        <div className="p-6">
          {categories.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-amber-50 rounded-2xl inline-flex mb-4">
                <FolderOpen size={32} className="text-amber-400" />
              </div>
              <p className="text-gray-600">暂无分类</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group"
                >
                  <div>
                    <p className="font-medium text-gray-900">{category.name}</p>
                    {category.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{category.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingCategory(category); setShowModal(true); }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg">
            <Tags className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">标签健康检查</h2>
            <p className="text-sm text-gray-500">查看低频标签、已配置别名和疑似重复标签</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loadingTagHealth ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner />
            </div>
          ) : tagHealth ? (
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">低频标签</h3>
                {tagHealth.lowFrequency.length === 0 ? (
                  <p className="text-sm text-gray-500">没有低频标签。</p>
                ) : (
                  <div className="grid gap-3">
                    {tagHealth.lowFrequency.slice(0, 20).map((tag) => (
                      <div key={tag.name} className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-amber-800">
                          <span className="font-medium">{tag.name}</span>
                          <span className="text-xs text-amber-600">仅 {tag.count} 道题</span>
                        </div>
                        <button
                          onClick={() => handleDeleteTag(tag.name)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-200 text-amber-700 text-sm hover:bg-amber-100 transition-colors"
                        >
                          <Trash2 size={14} />
                          删除标签
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">已配置别名</h3>
                {tagHealth.aliased.length === 0 ? (
                  <p className="text-sm text-gray-500">暂无别名规则。</p>
                ) : (
                  <div className="grid gap-3">
                    {tagHealth.aliased.slice(0, 20).map((item) => (
                      <div key={item.alias} className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
                        <span className="font-medium">{item.alias}</span>
                        <span className="mx-2 text-gray-400">{'->'}</span>
                        <span className="font-medium text-violet-700">{item.target}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">疑似重复标签</h3>
                {tagHealth.similarPairs.length === 0 ? (
                  <p className="text-sm text-gray-500">暂未发现疑似重复标签。</p>
                ) : (
                  <div className="grid gap-3">
                    {tagHealth.similarPairs.map((pair, index) => (
                      <div key={`${pair.left}-${pair.right}-${index}`} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="inline-flex px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{pair.left}</span>
                          <span className="text-gray-400">{'vs'}</span>
                          <span className="inline-flex px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{pair.right}</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">原因：{pair.reason}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => renameTagDirectly(pair.right, pair.left)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-sm hover:bg-violet-100 transition-colors"
                          >
                            合并为 {pair.left}
                          </button>
                          <button
                            onClick={() => renameTagDirectly(pair.left, pair.right)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-sm hover:bg-violet-100 transition-colors"
                          >
                            合并为 {pair.right}
                          </button>
                          <button
                            onClick={() => {
                              setAliasForm({ alias: pair.left, target: pair.right });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm hover:bg-gray-50 transition-colors"
                          >
                            设为别名
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">标签健康检查暂不可用。</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="p-2 bg-gradient-to-br from-sky-500 to-cyan-600 rounded-lg">
            <Tags className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">标签管理</h2>
            <p className="text-sm text-gray-500">重命名、合并或删除题目标签</p>
          </div>
          <div className="ml-auto">
            <button
              onClick={handleNormalizeTags}
              disabled={normalizingTags}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              <Tags size={16} />
              {normalizingTags ? '规范化中...' : '一键规范化'}
            </button>
          </div>
        </div>

        <div className="p-6">
          {loadingTags ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner />
            </div>
          ) : tags.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-sky-50 rounded-2xl inline-flex mb-4">
                <Tags size={32} className="text-sky-400" />
              </div>
              <p className="text-gray-600">暂无标签</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {tags.map((tag) => (
                <div key={tag.name} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-medium border ${getTagColorClasses(tag.name)}`}>
                      {tag.name}
                    </span>
                    <span className="text-sm text-gray-500">关联 {tag.count} 道题</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setRenamingTag(tag);
                        setRenameValue(tag.name);
                      }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.name)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="p-2 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-lg">
            <Tags className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">标签别名</h2>
            <p className="text-sm text-gray-500">把常见别名自动归并到主标签，例如 js {'->'} javascript</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              value={aliasForm.alias}
              onChange={(e) => setAliasForm((prev) => ({ ...prev, alias: e.target.value }))}
              placeholder="别名，例如 js"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
            />
            <input
              type="text"
              value={aliasForm.target}
              onChange={(e) => setAliasForm((prev) => ({ ...prev, target: e.target.value }))}
              placeholder="主标签，例如 javascript"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
            />
            <button
              onClick={handleAddAlias}
              disabled={savingAliases}
              className="px-4 py-3 bg-gradient-to-r from-violet-500 to-fuchsia-600 rounded-xl text-white hover:from-violet-600 hover:to-fuchsia-700 transition-all disabled:opacity-50"
            >
              添加别名
            </button>
          </div>
          {matchedAliasTargets.length > 0 ? (
            <div className="-mt-1 rounded-xl border border-gray-200 bg-white p-2">
              <div className="flex flex-wrap gap-2">
                {matchedAliasTargets.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => setAliasForm((prev) => ({ ...prev, target: tag.name }))}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                  >
                    <span>{tag.name}</span>
                    <span className="text-[11px] text-gray-400">{tag.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tagAliases.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
              暂无别名规则。添加后，新建题目、导入题目、AI 生题和一键规范化都会自动应用这些规则。
            </div>
          ) : (
            <div className="grid gap-3">
              {tagAliases.map((item) => (
                <div key={item.alias} className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-flex px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-700">{item.alias}</span>
                    <span className="text-gray-400">{'->'}</span>
                    <span className="inline-flex px-3 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700">{item.target}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteAlias(item.alias)}
                    disabled={savingAliases}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CategoryModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        category={editingCategory}
        onSuccess={() => { setShowModal(false); onRefresh(); }}
      />

      {renamingTag ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-transparent" onClick={() => { setRenamingTag(null); setRenameValue(''); }} />
          <div className="relative flex min-h-full items-center justify-center px-4 py-6">
            <div className="app-modal-panel w-full max-w-md overflow-hidden">
              <div className="app-modal-header flex items-center justify-between px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">重命名标签</h2>
                <button onClick={() => { setRenamingTag(null); setRenameValue(''); }} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">原标签</label>
                  <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-500">{renamingTag.name}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">新标签</label>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white transition-all"
                  />
                  <p className="mt-2 text-xs text-gray-500">如果新标签已存在，会自动合并到已有标签。</p>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => { setRenamingTag(null); setRenameValue(''); }}
                    className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleRenameTag}
                    className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-cyan-600 rounded-xl text-white hover:from-sky-600 hover:to-cyan-700 transition-all"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: Category | null;
  onSuccess: () => void;
}

const CategoryModal: React.FC<CategoryModalProps> = ({ isOpen, onClose, category, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ name: '', description: '' });

  useEffect(() => {
    if (category) {
      setFormData({ name: category.name, description: category.description || '' });
    } else {
      setFormData({ name: '', description: '' });
    }
  }, [category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (category) {
        await categoryApi.update(category.id, { name: formData.name, description: formData.description || undefined });
        toast.success('更新成功');
      } else {
        await categoryApi.create({ name: formData.name, description: formData.description || undefined });
        toast.success('创建成功');
      }
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
      <div className="app-modal-panel w-full max-w-md overflow-hidden">
        <div className="app-modal-header flex items-center justify-between px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{category ? '编辑分类' : '添加分类'}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} autoComplete="off" className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">分类名称</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">描述（可选）</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl text-white hover:from-amber-600 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? '保存中...' : category ? '更新' : '创建'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

interface AISettingsProps {
  aiStatus: AIStatus | null;
  aiConfigs: AIConfig[];
  onRefresh: () => void;
  onStatusChange: (status: AIStatus) => void;
}

const AISettings: React.FC<AISettingsProps> = ({ aiStatus, aiConfigs, onRefresh, onStatusChange }) => {
  const { user } = useAuthStore();
  const canManageSystem = hasPermission(user, 'system_manage');
  const [showModal, setShowModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AIConfig | null>(null);
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [liveCheckResults, setLiveCheckResults] = useState<Record<string, AIModelCheckResult>>({});
  const [checkSummary, setCheckSummary] = useState<{
    total: number;
    valid: number;
    invalid: number;
    unknown: number;
    timedOut: number;
    results: AIModelCheckResult[];
  } | null>(null);
  const [credentials, setCredentials] = useState<AICredential[]>([]);
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  const [editingCredential, setEditingCredential] = useState<AICredential | null>(null);

  const refreshCredentials = async () => {
    try {
      const response = await aiApi.getCredentials();
      setCredentials(response.data);
    } catch (error) {
      console.error('Failed to fetch AI credentials:', error);
    }
  };

  useEffect(() => {
    refreshCredentials();
  }, []);

  const handleDeleteCredential = async (credential: AICredential) => {
    if (!confirm(`确定删除 API 凭据“${credential.name}”吗？`)) return;
    try {
      await aiApi.deleteCredential(credential.id);
      toast.success('API 凭据已删除');
      refreshCredentials();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '删除 API 凭据失败');
    }
  };

  const handleToggleEnabled = async () => {
    if (!aiStatus) return;
    setUpdating(true);
    try {
      const response = await aiApi.updateSettings({ enabled: !aiStatus.enabled });
      onStatusChange(response.data);
      toast.success(aiStatus.enabled ? 'AI已禁用' : 'AI已启用');
    } catch (error) {
      toast.error('更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const handleDefaultProviderChange = async (configId: string) => {
    setUpdating(true);
    try {
      const config = aiConfigs.find(c => c.id === configId);
      if (config) {
        await aiApi.setActiveConfig(config.id);
        onRefresh();
        toast.success('已切换默认模型');
      }
    } catch (error) {
      toast.error('更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const runConfigCheck = async (config: AIConfig): Promise<AIModelCheckResult> => {
    setCheckingIds((current) => new Set(current).add(config.id));
    try {
      const response = await aiApi.checkConfig(config.id);
      setLiveCheckResults((current) => ({ ...current, [config.id]: response.data }));
      return response.data;
    } catch (error: any) {
      const result: AIModelCheckResult = {
        id: config.id,
        model: config.model,
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        error: error.response?.data?.error || error.message || '检查请求失败',
      };
      setLiveCheckResults((current) => ({ ...current, [config.id]: result }));
      return result;
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(config.id);
        return next;
      });
    }
  };

  const handleCheckAll = async () => {
    setChecking(true);
    setCheckingIds(new Set(aiConfigs.map((config) => config.id)));
    setCheckSummary(null);
    setLiveCheckResults((current) => {
      const next = { ...current };
      aiConfigs.forEach((config) => delete next[config.id]);
      return next;
    });
    try {
      const results = new Array<AIModelCheckResult>(aiConfigs.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < aiConfigs.length) {
          const index = cursor++;
          results[index] = await runConfigCheck(aiConfigs[index]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, aiConfigs.length) }, worker));

      const valid = results.filter((item) => item.status === 'valid').length;
      const invalid = results.filter((item) => item.status === 'invalid').length;
      const unknown = results.filter((item) => item.status === 'unknown').length;
      const timedOut = results.filter((item) => /超时|未响应|timeout/i.test(item.error || '')).length;
      setCheckSummary({ total: results.length, valid, invalid, unknown, timedOut, results });
      onRefresh();
    } finally {
      setChecking(false);
    }
  };

  const handleCheckOne = async (config: AIConfig) => {
    const result = await runConfigCheck(config);
    try {
      if (result.status === 'valid') {
        toast.success('模型可用');
      } else if (result.status === 'invalid') {
        toast.error(result.error || '模型已失效');
      } else {
        toast.error(result.error || '无法确认模型状态');
      }
      onRefresh();
    } catch { /* runConfigCheck always returns a result */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此配置吗？')) return;

    try {
      await aiApi.deleteConfig(id);
      toast.success('删除成功');
      onRefresh();
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleDeleteInvalid = async () => {
    const invalidCount = aiConfigs.filter((config) => config.modelStatus === 'invalid').length;
    if (invalidCount === 0) {
      toast('没有已标记失效的模型配置');
      return;
    }
    if (!confirm(`确定要清除 ${invalidCount} 个已标记失效的模型配置吗？`)) return;

    try {
      const response = await aiApi.deleteInvalidConfigs();
      toast.success(`已清除 ${response.data.deleted} 个失效配置`);
      onRefresh();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '清除失败');
    }
  };

  const providerOptions = [
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'qwen', label: '千问' },
    { value: 'doubao', label: '豆包' },
    { value: 'wenxin', label: '文心一言' },
    { value: 'zhipu', label: '智谱AI' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="p-2 bg-primary-600 rounded-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">AI设置</h2>
        </div>
        
        {aiStatus ? (
          <div className="p-6 space-y-6">
            {canManageSystem ? (
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Cpu size={20} className="text-gray-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">AI功能</p>
                    <p className="text-sm text-gray-500">启用后可在学习模式中使用AI辅助功能</p>
                  </div>
                </div>
                <button
                  onClick={handleToggleEnabled}
                  disabled={updating}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                    aiStatus.enabled ? 'bg-primary-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${aiStatus.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            ) : null}

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Key size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">默认模型</p>
                  <p className="text-sm text-gray-500">选择默认使用的AI模型</p>
                </div>
              </div>
              <select
                value={aiConfigs.find(c => c.isActive)?.id || ''}
                onChange={(e) => handleDefaultProviderChange(e.target.value)}
                disabled={updating}
                className="select-field min-w-[140px] px-4 pr-10 py-2 bg-white text-gray-700 cursor-pointer"
              >
                {aiConfigs.filter(c => c.isActive).map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.displayName || providerOptions.find(o => o.value === config.provider)?.label || config.provider}
                  </option>
                ))}
                {aiConfigs.filter(c => !c.isActive).map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.displayName || providerOptions.find(o => o.value === config.provider)?.label || config.provider}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="p-6 flex justify-center">
            <LoadingSpinner />
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg"><Key className="w-5 h-5 text-white" /></div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">API 凭据</h2>
              <p className="text-sm text-gray-500">集中保存自定义接口地址和密钥，模型配置只需选择凭据</p>
            </div>
          </div>
          <button onClick={() => { setEditingCredential(null); setShowCredentialModal(true); }} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm font-medium hover:bg-blue-700 transition-colors">
            <Plus size={18} />添加凭据
          </button>
        </div>
        <div className="p-6">
          {credentials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500">暂无自定义 API 凭据，请先添加凭据，再添加自定义模型。</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {credentials.map((credential) => (
                <div key={credential.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-gray-50 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{credential.name}</p>
                    <p className="truncate text-sm text-gray-500" title={credential.baseUrl}>{credential.baseUrl}</p>
                    <p className="mt-1 text-xs text-gray-400">密钥已加密保存</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => { setEditingCredential(credential); setShowCredentialModal(true); }} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑凭据"><Edit size={16} /></button>
                    <button onClick={() => handleDeleteCredential(credential)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除凭据"><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-700 rounded-lg">
              <Key className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">API配置</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckAll}
              disabled={checking || aiConfigs.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCcw size={18} className={checking ? 'animate-spin' : ''} />
              检查模型可用性
            </button>
            <button
              onClick={handleDeleteInvalid}
              disabled={aiConfigs.every((config) => config.modelStatus !== 'invalid')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-lg text-red-700 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              <Trash2 size={18} />
              清除失效模型
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 rounded-lg text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus size={18} />
              添加配置
            </button>
          </div>
        </div>

        <div className="p-6">
          {aiConfigs.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-gray-100 rounded-xl inline-flex mb-4">
                <Key size={32} className="text-gray-400" />
              </div>
              <p className="text-gray-600">暂无AI配置</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {aiConfigs.map((config) => {
                const liveResult = liveCheckResults[config.id];
                const modelStatus = liveResult?.status || config.modelStatus;
                const lastCheckError = liveResult?.error ?? config.lastCheckError;
                const isChecking = checkingIds.has(config.id);
                return (
                <div key={config.id} data-testid={`ai-config-${config.id}`} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-lg border border-gray-200">
                      {isChecking ? (
                        <RefreshCcw size={18} className="animate-spin text-blue-600" />
                      ) : modelStatus === 'invalid' ? (
                        <AlertTriangle size={18} className="text-red-600" />
                      ) : (
                        <Cpu size={18} className="text-gray-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{config.displayName || config.provider}</p>
                        {isChecking && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-xs font-medium">
                            检查中
                          </span>
                        )}
                        {!isChecking && modelStatus === 'valid' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-md text-xs font-medium">
                            <Check size={11} />
                            可用
                          </span>
                        )}
                        {!isChecking && modelStatus === 'invalid' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-md text-xs font-medium">
                            <AlertTriangle size={11} />
                            已失效
                          </span>
                        )}
                        {!isChecking && modelStatus === 'unknown' && lastCheckError && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">
                            无法确认
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">模型：{config.model}</p>
                      {!isChecking && lastCheckError && (
                        <p className="mt-1 text-xs text-red-600 max-w-xl truncate" title={lastCheckError}>{lastCheckError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {config.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                        <Check size={12} />
                        当前使用
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            await aiApi.setActiveConfig(config.id);
                            onRefresh();
                            toast.success('已切换配置');
                          } catch (error) {
                            toast.error('切换失败');
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-primary-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await handleCheckOne(config);
                      }}
                      disabled={isChecking}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="检查模型是否可调用"
                    >
                      <Play size={16} />
                    </button>
                    <button
                      onClick={() => { setEditingConfig(config); setShowModal(true); }}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>

        <AIConfigModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); setEditingConfig(null); }}
          onSuccess={() => { setShowModal(false); setEditingConfig(null); onRefresh(); }}
          editingConfig={editingConfig}
          credentials={credentials}
        />
        <AICredentialModal
          isOpen={showCredentialModal}
          credential={editingCredential}
          onClose={() => { setShowCredentialModal(false); setEditingCredential(null); }}
          onSuccess={() => {
            setShowCredentialModal(false);
            setEditingCredential(null);
            refreshCredentials();
            onRefresh();
          }}
        />
        {checkSummary && (
          <div className="fixed inset-0 z-[70]" data-testid="ai-check-summary">
            <div className="absolute inset-0 bg-black/35" onClick={() => setCheckSummary(null)} />
            <div className="relative flex min-h-full items-center justify-center px-4 py-6">
              <div className="app-modal-panel w-full max-w-lg overflow-hidden">
                <div className="app-modal-header flex items-start justify-between gap-4 px-6 py-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">模型检查完成</h2>
                    <p className="mt-1 text-sm text-gray-500">共检查 {checkSummary.total} 个模型，结果已逐项更新</p>
                  </div>
                  <button onClick={() => setCheckSummary(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X size={20} /></button>
                </div>
                <div className="space-y-4 p-6">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl bg-green-50 p-4 text-center"><p className="text-2xl font-bold text-green-700">{checkSummary.valid}</p><p className="text-xs text-green-700">可用</p></div>
                    <div className="rounded-xl bg-red-50 p-4 text-center"><p className="text-2xl font-bold text-red-700">{checkSummary.invalid}</p><p className="text-xs text-red-700">不可用</p></div>
                    <div className="rounded-xl bg-amber-50 p-4 text-center"><p className="text-2xl font-bold text-amber-700">{checkSummary.unknown}</p><p className="text-xs text-amber-700">无法确认</p></div>
                  </div>
                  {checkSummary.timedOut > 0 && (
                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">其中 {checkSummary.timedOut} 个模型等待上游响应超时。</p>
                  )}
                  {checkSummary.results.some((result) => result.status !== 'valid') && (
                    <div className="max-h-56 space-y-2 overflow-y-auto">
                      {checkSummary.results.filter((result) => result.status !== 'valid').map((result) => (
                        <div key={result.id} className="rounded-lg border border-gray-200 px-3 py-2">
                          <p className="text-sm font-medium text-gray-800">{result.model}</p>
                          <p className="mt-1 break-words text-xs text-gray-500">{result.error || '上游未返回可确认的结果'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button onClick={() => setCheckSummary(null)} className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700">知道了</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface AICredentialModalProps {
  isOpen: boolean;
  credential: AICredential | null;
  onClose: () => void;
  onSuccess: () => void;
}

const AICredentialModal: React.FC<AICredentialModalProps> = ({ isOpen, credential, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [secretEditable, setSecretEditable] = useState(false);
  const [formData, setFormData] = useState({ name: '', baseUrl: '', apiKey: '' });

  useEffect(() => {
    setSecretEditable(false);
    setFormData({
      name: credential?.name || '',
      baseUrl: credential?.baseUrl || '',
      apiKey: '',
    });
  }, [credential, isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      if (credential) {
        await aiApi.updateCredential(credential.id, {
          name: formData.name,
          baseUrl: formData.baseUrl,
          apiKey: formData.apiKey || undefined,
        });
        toast.success('API 凭据已更新，关联模型会自动使用新密钥');
      } else {
        await aiApi.createCredential(formData);
        toast.success('API 凭据已保存');
      }
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存 API 凭据失败');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="app-modal-panel w-full max-w-md overflow-hidden">
          <div className="app-modal-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{credential ? '编辑 API 凭据' : '添加 API 凭据'}</h2>
              <p className="text-sm text-gray-500">密钥只在这里维护，不会显示在模型配置中</p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4 p-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">凭据名称</label>
              <input
                type="text"
                name="ai-credential-label"
                autoComplete="off"
                value={formData.name}
                onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                required
                placeholder="例如：NVIDIA"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">API 地址</label>
              <input
                type="url"
                name="ai-credential-endpoint"
                autoComplete="off"
                value={formData.baseUrl}
                onChange={(event) => setFormData((current) => ({ ...current, baseUrl: event.target.value }))}
                required
                placeholder="https://integrate.api.nvidia.com/v1"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">API Key</label>
              <input
                type="password"
                name="ai-credential-secret-new"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                readOnly={!secretEditable}
                onFocus={() => setSecretEditable(true)}
                value={formData.apiKey}
                onChange={(event) => setFormData((current) => ({ ...current, apiKey: event.target.value }))}
                required={!credential}
                placeholder={credential ? '留空保持原 Key 不变' : '粘贴 API Key'}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="mt-1 text-xs text-gray-500">NVIDIA Key 应以 nvapi- 开头；浏览器密码管理器已被明确禁止填充此字段。</p>
            </div>
            <div className="flex justify-end gap-3 pt-3">
              <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-gray-700 hover:bg-gray-50">取消</button>
              <button type="submit" disabled={loading} className="rounded-xl bg-blue-600 px-5 py-2.5 text-white hover:bg-blue-700 disabled:opacity-50">
                {loading ? '保存中…' : '保存凭据'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

interface AIConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingConfig?: AIConfig | null;
  credentials: AICredential[];
}

const AIConfigModal: React.FC<AIConfigModalProps> = ({ isOpen, onClose, onSuccess, editingConfig, credentials }) => {
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<AIModelInfo[]>([]);
  const [isCustom, setIsCustom] = useState(false);
  const [selectedCredentialId, setSelectedCredentialId] = useState('');
  const [apiKeyEditable, setApiKeyEditable] = useState(false);
  const [formData, setFormData] = useState({
    provider: 'deepseek',
    displayName: '',
    baseUrl: '',
    apiKey: '',
    model: '',
    isCustom: false,
  });

  const presetProviders: Record<string, { label: string; model: string; baseUrl: string }> = {
    deepseek: { label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
    openai: { label: 'OpenAI', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    qwen: { label: '千问', model: 'qwen-turbo', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    doubao: { label: '豆包', model: 'doubao-pro-4k', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    wenxin: { label: '文心一言', model: 'ernie-bot-4', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat' },
    zhipu: { label: '智谱AI', model: 'glm-4', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  };

  const toProviderSlug = (name: string) => {
    const source = name || 'custom-ai';
    return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'custom-ai';
  };
  const selectedCredential = credentials.find((credential) => credential.id === selectedCredentialId);

  useEffect(() => {
    setApiKeyEditable(false);
    if (editingConfig) {
      setIsCustom(editingConfig.isCustom || false);
      setSelectedCredentialId(editingConfig.credentialId || credentials[0]?.id || '');
      setFormData({
        provider: editingConfig.provider,
        displayName: editingConfig.displayName || '',
        baseUrl: editingConfig.baseUrl || '',
        apiKey: '',
        model: editingConfig.model,
        isCustom: editingConfig.isCustom || false,
      });
    } else {
      setSelectedCredentialId('');
      setIsCustom(false);
      setFormData({
        provider: 'deepseek',
        displayName: '',
        baseUrl: '',
        apiKey: '',
        model: '',
        isCustom: false,
      });
    }
    setModelOptions([]);
  }, [editingConfig, credentials]);

  useEffect(() => {
    if (!isCustom && formData.provider && presetProviders[formData.provider]) {
      setFormData((prev) => ({ 
        ...prev, 
        model: presetProviders[formData.provider].model,
        displayName: presetProviders[formData.provider].label,
        isCustom: false 
      }));
    }
  }, [formData.provider, isCustom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const fallbackName = formData.displayName || formData.model;
      if (isCustom && !selectedCredential) {
        toast.error('请先选择 API 凭据');
        return;
      }
      const customProvider = isCustom ? toProviderSlug(selectedCredential?.name || '') : formData.provider;
      if (editingConfig) {
        const updateData = {
          provider: isCustom ? customProvider : formData.provider,
          displayName: isCustom ? fallbackName : formData.displayName || presetProviders[formData.provider]?.label,
          baseUrl: undefined,
          apiKey: isCustom ? undefined : formData.apiKey || undefined,
          model: formData.model,
          isCustom,
          credentialId: isCustom ? selectedCredentialId : undefined,
        };
        await aiApi.updateConfig(editingConfig.id, updateData);
        toast.success('配置更新成功');
      } else {
        const submitData = {
          provider: isCustom ? customProvider : formData.provider,
          displayName: isCustom ? fallbackName : formData.displayName || presetProviders[formData.provider]?.label,
          baseUrl: undefined,
          apiKey: isCustom ? undefined : formData.apiKey || undefined,
          model: formData.model,
          isCustom: isCustom,
          credentialId: isCustom ? selectedCredentialId : undefined,
        };
        await aiApi.createConfig(submitData);
        toast.success('配置创建成功');
      }
      onSuccess();
    } catch (error: any) {
      console.error('Config save error:', error);
      toast.error(error.response?.data?.error || (editingConfig ? '更新失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    try {
      const response = await aiApi.getModels({
        configId: !isCustom ? editingConfig?.id : undefined,
        credentialId: isCustom ? selectedCredentialId : undefined,
        baseUrl: isCustom ? undefined : presetProviders[formData.provider]?.baseUrl,
        apiKey: isCustom ? undefined : formData.apiKey || undefined,
        isCustom,
      });
      setModelOptions(response.data.models);
      const availableModelIds = response.data.models.map((model) => model.id);
      if (response.data.models[0] && (!formData.model || !availableModelIds.includes(formData.model))) {
        setFormData((prev) => ({ ...prev, model: response.data.models[0].id }));
      }
      toast.success(`已读取 ${response.data.models.length} 个可用模型`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || '读取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !isCustom || !selectedCredentialId) return;

    const timer = window.setTimeout(async () => {
      setLoadingModels(true);
      try {
        const response = await aiApi.getModels({
          credentialId: selectedCredentialId,
          isCustom: true,
        });
        setModelOptions(response.data.models);
        const availableModelIds = response.data.models.map((model) => model.id);
        if (response.data.models[0] && (!formData.model || !availableModelIds.includes(formData.model))) {
          setFormData((prev) => ({ ...prev, model: response.data.models[0].id }));
        }
      } catch {
        setModelOptions([]);
      } finally {
        setLoadingModels(false);
      }
    }, 600);

    return () => window.clearTimeout(timer);
  }, [formData.model, isCustom, isOpen, selectedCredentialId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
      <div className="app-modal-panel w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="app-modal-header sticky top-0 flex items-center justify-between px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{editingConfig ? '编辑AI配置' : '添加AI配置'}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} autoComplete="off" className="p-6 space-y-4">
          <div className="flex items-center gap-4 mb-4">
            <button
              type="button"
              onClick={() => { setIsCustom(false); setFormData(prev => ({ ...prev, provider: 'deepseek' })); setModelOptions([]); }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${!isCustom ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              预设提供商
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCustom(true);
                setModelOptions([]);
                const credential = credentials[0];
                setSelectedCredentialId(credential?.id || '');
                setFormData(prev => ({
                  ...prev,
                  provider: credential ? toProviderSlug(credential.name) : '',
                  displayName: '',
                  baseUrl: '',
                  apiKey: '',
                  model: '',
                }));
              }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all ${isCustom ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              自定义提供商
            </button>
          </div>

          {!isCustom ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">AI提供商</label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
              >
                {Object.entries(presetProviders).map(([key, value]) => (
                  <option key={key} value={key}>{value.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">API 凭据</label>
                <select
                  value={selectedCredentialId}
                  onChange={(e) => {
                    const credential = credentials.find((item) => item.id === e.target.value);
                    setSelectedCredentialId(e.target.value);
                    setModelOptions([]);
                    setFormData((prev) => ({
                      ...prev,
                      provider: credential ? toProviderSlug(credential.name) : '',
                      model: '',
                    }));
                  }}
                  required
                  className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                >
                  <option value="">请选择 API 凭据</option>
                  {credentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>{credential.name} · {credential.baseUrl}</option>
                  ))}
                </select>
                {credentials.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">请关闭此窗口，先在“API 凭据”区域添加地址和密钥。</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">显示名称</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="留空则使用所选模型名称"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
                />
              </div>
            </>
          )}

          {!isCustom && <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">API密钥</label>
            <input
              type="password"
              name="ai-provider-api-key"
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              readOnly={!apiKeyEditable}
              onFocus={() => setApiKeyEditable(true)}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              required={!editingConfig}
              placeholder={editingConfig ? '留空保持原密钥不变' : '请输入API密钥'}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
            />
            <p className="text-xs text-gray-500 mt-1">
              {editingConfig ? '留空则保持原密钥不变。' : '首次添加提供商时需要填写密钥。'}
            </p>
          </div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型名称</label>
            <div className="flex gap-2">
              {modelOptions.length > 0 ? (
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  required
                  className="select-field min-w-0 flex-1 px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                >
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>{model.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  required
                  placeholder="例如：gpt-4o-mini"
                  className="min-w-0 flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
                />
              )}
              <button
                type="button"
                onClick={handleLoadModels}
                disabled={loadingModels || (isCustom ? !selectedCredentialId : (!editingConfig && !formData.apiKey))}
                className="inline-flex items-center justify-center gap-2 px-3 py-3 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50"
                title="从 API 地址读取可用模型"
              >
                <RefreshCcw size={16} className={loadingModels ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl text-white hover:from-violet-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (editingConfig ? '保存中...' : '创建中...') : (editingConfig ? '保存' : '创建')}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

const SystemSettings: React.FC = () => {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const canManageSystem = hasPermission(user, 'system_manage');
  const canManageUsers = hasPermission(user, 'user_manage');
  const canBackupRestore = isAdmin;
  const [allowRegister, setAllowRegister] = useState(true);
  const [sessionDuration, setSessionDuration] = useState('7d');
  const [customSessionAmount, setCustomSessionAmount] = useState('30');
  const [customSessionUnit, setCustomSessionUnit] = useState('d');
  const [sessionUpdating, setSessionUpdating] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [resetLearningBusy, setResetLearningBusy] = useState(false);
  const [userModalMode, setUserModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user',
    userType: 'independent' as 'independent' | 'integrated',
    libraryOwnerId: '' as string,
    categoryScopes: [] as string[],
    permissions: DEFAULT_USER_PERMISSIONS,
  });
  const [assignableCategories, setAssignableCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (canManageSystem) {
      fetchSettings();
    }
    if (canManageUsers) {
      fetchUsers();
    } else if (!canBackupRestore) {
      setLoading(false);
    }
  }, [canManageSystem, canManageUsers, canBackupRestore]);

  const fetchSettings = async () => {
    try {
      const response = await adminApi.getSettings();
      setAllowRegister(response.data.allowRegister);
      const duration = response.data.loginSessionDuration;
      if (['1h', '1d', '7d', '30d', '90d', '365d', 'forever'].includes(duration)) {
        setSessionDuration(duration);
      } else {
        const match = /^(\d+)(s|m|h|d)$/.exec(duration);
        if (match) {
          setSessionDuration('custom');
          setCustomSessionAmount(match[1]);
          setCustomSessionUnit(match[2]);
        }
      }
      setSettingsReady(true);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await adminApi.getAllUsers();
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignableCategories = async (ownerId?: string) => {
    if (!ownerId) {
      setAssignableCategories([]);
      return;
    }

    try {
      const response = await adminApi.getUserCategories(ownerId);
      setAssignableCategories(response.data);
    } catch (error) {
      console.error('Failed to fetch assignable categories:', error);
      setAssignableCategories([]);
    }
  };

  const resetUserForm = () => {
    setEditingUser(null);
    setAssignableCategories([]);
    setUserForm({
      username: '',
      email: '',
      password: '',
      role: 'user',
      userType: 'independent',
      libraryOwnerId: '',
      categoryScopes: [],
      permissions: DEFAULT_USER_PERMISSIONS,
    });
  };

  const openCreateUserModal = () => {
    resetUserForm();
    setUserModalMode('create');
  };

  const openEditUserModal = (targetUser: User) => {
    setEditingUser(targetUser);
    setUserForm({
      username: targetUser.username,
      email: targetUser.email,
      password: '',
      role: targetUser.role,
      userType: targetUser.user_type || 'independent',
      libraryOwnerId: targetUser.library_owner_id || '',
      categoryScopes: targetUser.category_scopes || [],
      permissions: targetUser.role === 'admin' ? ADMIN_PERMISSIONS : targetUser.permissions,
    });
    setUserModalMode('edit');
  };

  useEffect(() => {
    if (!canManageUsers || userForm.role !== 'user' || userForm.userType !== 'integrated') {
      setAssignableCategories([]);
      return;
    }

    const ownerId = userForm.libraryOwnerId || user?.id || '';
    void fetchAssignableCategories(ownerId);
  }, [canManageUsers, user?.id, userForm.role, userForm.userType, userForm.libraryOwnerId]);

  const closeUserModal = () => {
    setUserModalMode(null);
    resetUserForm();
  };

  const handleToggleRegister = async () => {
    setUpdating(true);
    try {
      const newValue = !allowRegister;
      await adminApi.updateSetting('allow_register', String(newValue));
      setAllowRegister(newValue);
      toast.success(newValue ? '已开放用户注册' : '已关闭用户注册');
    } catch (error) {
      toast.error('更新失败');
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveSessionDuration = async () => {
    const duration = sessionDuration === 'custom' ? `${customSessionAmount}${customSessionUnit}` : sessionDuration;
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    if (sessionDuration === 'custom') {
      const seconds = Number(customSessionAmount) * units[customSessionUnit];
      if (!/^\d+$/.test(customSessionAmount) || !Number.isSafeInteger(seconds) || seconds < 60 || seconds > 365 * 86400) {
        toast.error('登录有效期须为 1 分钟至 365 天');
        return;
      }
    }
    setSessionUpdating(true);
    try {
      await adminApi.updateSetting('login_session_duration', duration);
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存登录有效期失败');
      setSessionUpdating(false);
      return;
    }
    try {
      await authApi.refreshSession();
      toast.success('登录有效期已保存，并已应用到当前登录');
    } catch {
      toast.error('设置已保存，当前登录期限未更新；重新登录后生效');
    } finally {
      setSessionUpdating(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupBusy(true);
    try {
      const response = await adminApi.exportBackup();
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tech-growth-hub-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('备份已导出');
    } catch (error: any) {
      toast.error(error.response?.data?.error || '导出备份失败');
    } finally {
      setBackupBusy(false);
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (file: File | null) => {
    if (!file) return;

    setBackupBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const counts = parsed?.meta?.counts;
      const preview = counts
        ? `用户 ${counts.users} / 分类 ${counts.categories} / 题目 ${counts.questions} / 题目版本 ${counts.question_versions || 0} / 学习记录 ${counts.learning_progress} / AI配置 ${counts.ai_configs} / 系统设置 ${counts.system_settings}`
        : '未提供数量摘要';
      if (!confirm(`将恢复以下备份数据：\n${preview}\n\n恢复会覆盖当前系统数据，确定继续吗？`)) {
        setBackupBusy(false);
        return;
      }
      await adminApi.restoreBackup(parsed.dataset || {});
      toast.success('备份已恢复');
      fetchSettings();
      if (canManageUsers) {
        fetchUsers();
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || '恢复备份失败');
    } finally {
      setBackupBusy(false);
      setLoading(false);
    }
  };

  const handleResetLearningProgress = async () => {
    if (!confirm('确定要清空当前账号的学习相关信息吗？这会清除背题/答题进度、已查看次数、收藏标记和最近学习记录。')) {
      return;
    }

    setResetLearningBusy(true);
    try {
      const response = await questionApi.resetLearningProgress();
      toast.success(response.data.message || '学习记录已清空');
    } catch (error: any) {
      toast.error(error.response?.data?.error || '清空学习记录失败');
    } finally {
      setResetLearningBusy(false);
    }
  };

  const handleDeleteUser = async (id: string, username: string) => {
    if (!confirm(`确定要删除用户 "${username}" 吗？`)) return;

    try {
      await adminApi.deleteUser(id);
      toast.success('用户已删除');
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '删除失败');
    }
  };

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await adminApi.updateUserRole(id, role);
      toast.success('角色已更新');
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '更新失败');
    }
  };

  const handlePermissionChange = (permission: keyof UserPermissions, checked: boolean) => {
    if (userForm.role === 'admin') {
      return;
    }

    setUserForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permission]: checked,
      },
    }));
  };

  const handleModalRoleChange = (role: 'admin' | 'user') => {
    setUserForm((prev) => ({
      ...prev,
      role,
      permissions: role === 'admin'
        ? ADMIN_PERMISSIONS
        : (editingUser?.role === 'user' ? editingUser.permissions : DEFAULT_USER_PERMISSIONS),
    }));
  };

  const handleSaveUser = async () => {
    try {
      if (!userForm.username.trim()) {
        toast.error('请输入用户名');
        return;
      }
      if (!userForm.email.trim()) {
        toast.error('请输入邮箱');
        return;
      }
      if (userModalMode === 'create' && !userForm.password.trim()) {
        toast.error('请输入初始密码');
        return;
      }

      if (userModalMode === 'create') {
        await adminApi.createUser({
          username: userForm.username.trim(),
          email: userForm.email.trim(),
          password: userForm.password,
          role: userForm.role,
          userType: userForm.role === 'admin' ? 'independent' : userForm.userType,
          libraryOwnerId: userForm.role === 'admin' || userForm.userType === 'independent' ? null : (userForm.libraryOwnerId || user?.id || null),
          categoryScopes: userForm.role === 'admin' || userForm.userType === 'independent' ? [] : userForm.categoryScopes,
          permissions: userForm.role === 'admin' ? ADMIN_PERMISSIONS : userForm.permissions,
        });
        toast.success('用户创建成功');
      } else if (editingUser) {
        const updateData: {
          username?: string;
          email?: string;
          password?: string;
          role?: 'admin' | 'user';
          userType?: 'independent' | 'integrated';
          libraryOwnerId?: string | null;
          categoryScopes?: string[];
          permissions?: UserPermissions;
        } = {
          username: userForm.username.trim(),
          email: userForm.email.trim(),
          role: userForm.role,
          userType: userForm.role === 'admin' ? 'independent' : userForm.userType,
          libraryOwnerId: userForm.role === 'admin' || userForm.userType === 'independent' ? null : (userForm.libraryOwnerId || user?.id || null),
          categoryScopes: userForm.role === 'admin' || userForm.userType === 'independent' ? [] : userForm.categoryScopes,
          permissions: userForm.role === 'admin' ? ADMIN_PERMISSIONS : userForm.permissions,
        };

        if (userForm.password.trim()) {
          updateData.password = userForm.password;
        }

        await adminApi.updateUser(editingUser.id, updateData);
        toast.success('用户信息已更新');
      }

      closeUserModal();
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存失败');
    }
  };

  const getPermissionSummary = (targetUser: User) => {
    if (targetUser.role === 'admin') {
      return ['全部权限'];
    }

    return PERMISSION_GROUPS.map((group) => {
      const enabledCount = group.keys.filter((key) => targetUser.permissions?.[key]).length;
      return enabledCount > 0 ? `${group.title} ${enabledCount}项` : null;
    }).filter(Boolean) as string[];
  };

  return (
    <div className="space-y-6">
      {canManageSystem ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="p-2 bg-gradient-to-br from-rose-500 to-pink-600 rounded-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">系统设置</h2>
          </div>

          <div className="p-6 space-y-6">
            <div className="space-y-3 rounded-xl bg-gray-50 p-4">
              <label htmlFor="login-session-duration" className="block font-medium text-gray-900">登录有效期</label>
              <p className="text-sm text-gray-500">适用于全站新登录；保存后同时更新当前登录的有效期。</p>
              <div className="flex flex-wrap items-center gap-3">
                <select id="login-session-duration" data-testid="login-session-duration" value={sessionDuration}
                  onChange={(event) => setSessionDuration(event.target.value)} disabled={!settingsReady || sessionUpdating}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="1h">1 小时</option>
                  <option value="1d">1 天</option>
                  <option value="7d">7 天</option>
                  <option value="30d">30 天</option>
                  <option value="90d">90 天</option>
                  <option value="365d">365 天</option>
                  <option value="forever">一直有效</option>
                  <option value="custom">自定义</option>
                </select>
                {sessionDuration === 'custom' && <>
                  <input aria-label="自定义登录时长" type="number" min="1" step="1" value={customSessionAmount}
                    onChange={(event) => setCustomSessionAmount(event.target.value)} disabled={sessionUpdating}
                    className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                  <select aria-label="登录时长单位" value={customSessionUnit} onChange={(event) => setCustomSessionUnit(event.target.value)}
                    disabled={sessionUpdating} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    <option value="s">秒</option><option value="m">分钟</option><option value="h">小时</option><option value="d">天</option>
                  </select>
                </>}
                <button type="button" data-testid="save-session-duration" onClick={handleSaveSessionDuration}
                  disabled={!settingsReady || sessionUpdating}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  {sessionUpdating ? '保存中…' : '保存登录有效期'}
                </button>
              </div>
              {sessionDuration === 'forever' && <p className="text-sm text-amber-700">一直有效会持续保留登录。主动退出、修改密码或清除浏览器数据后需要重新登录；浏览器可能限制长期未使用的 Cookie。</p>}
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pink-100 rounded-lg">
                  <UserCog size={20} className="text-pink-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">允许用户注册</p>
                  <p className="text-sm text-gray-500">关闭后登录页面将不显示注册链接</p>
                </div>
              </div>
              <button
                onClick={handleToggleRegister}
                disabled={updating}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  allowRegister ? 'bg-gradient-to-r from-rose-500 to-pink-600' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${allowRegister ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Play size={20} className="text-amber-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">清空学习相关信息</p>
                  <p className="text-sm text-gray-500">清除当前账号的背题/答题进度、已查看次数、收藏标记和最近学习记录。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetLearningProgress}
                disabled={resetLearningBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {resetLearningBusy ? '清空中...' : '一键清空'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canBackupRestore ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">备份与恢复</h2>
          </div>
          <div className="p-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="font-medium text-gray-900">导出完整备份</p>
              <p className="mt-1 text-sm text-gray-500">导出用户、分类、题目、学习记录、AI 配置和系统设置。</p>
              <button
                data-testid="backup-export-button"
                onClick={handleExportBackup}
                disabled={backupBusy}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <Download size={16} />
                {backupBusy ? '处理中...' : '导出备份'}
              </button>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="font-medium text-gray-900">恢复备份</p>
              <p className="mt-1 text-sm text-gray-500">上传备份 JSON 文件后会覆盖当前系统数据，请谨慎操作。</p>
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50">
                <Upload size={16} />
                <span>{backupBusy ? '处理中...' : '选择备份文件'}</span>
                <input
                  data-testid="backup-restore-input"
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  disabled={backupBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    handleRestoreBackup(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {canManageUsers ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg">
              <Users className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">用户管理</h2>
            <span className="ml-auto text-sm text-gray-500">共 {users.length} 个用户</span>
            <button
              onClick={openCreateUserModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl text-white text-sm font-medium hover:from-blue-600 hover:to-indigo-700 transition-all"
            >
              <Plus size={16} />
              创建用户
            </button>
          </div>

          {loading ? (
            <div className="p-6 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : users.length === 0 ? (
            <div className="p-6 text-center">
              <div className="p-4 bg-blue-50 rounded-2xl inline-flex mb-4">
                <Users size={32} className="text-blue-400" />
              </div>
              <p className="text-gray-600">暂无用户</p>
            </div>
          ) : (
            <>
            <div className="divide-y divide-gray-100 lg:hidden">
              {users.map((u) => (
                <article key={u.id} className="p-3.5">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-medium text-white">
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-gray-900">{u.username}</p>
                        <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {u.role === 'admin' ? '管理员' : '普通用户'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{u.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditUserModal(u)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 active:bg-blue-50"
                        aria-label={`编辑用户 ${u.username}`}
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(u.id, u.username)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-red-500 active:bg-red-50"
                        aria-label={`删除用户 ${u.username}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="rounded-lg bg-gray-50 px-3 py-2">
                      <span className="block text-[10px] text-gray-400">角色</span>
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="mt-0.5 w-full border-0 bg-transparent p-0 text-xs font-medium text-gray-700 focus:outline-none"
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </label>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <span className="block text-[10px] text-gray-400">题库模式</span>
                      <span className="mt-0.5 block text-xs font-medium text-gray-700">
                        {u.role === 'admin' ? '系统管理员' : u.user_type === 'independent' ? '独立题库' : '集成题库'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {getPermissionSummary(u).map((summary) => (
                      <span
                        key={summary}
                        className={`inline-flex rounded-md px-2 py-1 text-[10px] font-medium ${
                          u.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {summary}
                      </span>
                    ))}
                    {u.role !== 'admin' && getPermissionSummary(u).length === 0 ? (
                      <span className="inline-flex rounded-md bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500">未授权</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户名</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">邮箱</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">题库模式</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">权限</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">注册时间</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900">{u.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">{u.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className={`select-field px-3 pr-8 py-1 text-sm font-medium border-0 cursor-pointer ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          <option value="user">普通用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {u.role === 'admin' ? (
                          <span className="inline-flex rounded-lg bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">系统管理员</span>
                        ) : u.user_type === 'independent' ? (
                          <span className="inline-flex rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">独立题库</span>
                        ) : (
                          <span className="inline-flex rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">集成题库</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {getPermissionSummary(u).map((summary) => (
                            <span
                              key={summary}
                              className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}
                            >
                              {summary}
                            </span>
                          ))}
                          {u.role !== 'admin' && getPermissionSummary(u).length === 0 ? (
                            <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-500">未授权</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditUserModal(u)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="编辑用户"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除用户"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      ) : null}

      {userModalMode ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-transparent" onClick={closeUserModal} />
          <div className="relative flex min-h-full items-center justify-center px-4 py-6">
            <div className="app-modal-panel w-full max-w-2xl overflow-hidden max-h-[92vh]">
              <div className="app-modal-header flex items-center justify-between px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {userModalMode === 'create' ? '创建用户' : `编辑用户：${editingUser?.username}`}
                </h2>
                <button onClick={closeUserModal} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(92vh-72px)]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">用户名</label>
                    <input
                      type="text"
                      value={userForm.username}
                      onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">邮箱</label>
                    <input
                      type="email"
                      value={userForm.email}
                      onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {userModalMode === 'create' ? '初始密码' : '新密码（留空则不修改）'}
                    </label>
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                      placeholder={userModalMode === 'create' ? '请输入初始密码' : '输入后将重置密码'}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all"
                    />
                    <p className="text-xs text-gray-500 mt-1">密码需超过9位，且包含字母和数字</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">角色</label>
                    <select
                      value={userForm.role}
                      onChange={(e) => handleModalRoleChange(e.target.value as 'admin' | 'user')}
                      className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                </div>

                {userForm.role === 'user' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">用户模式</label>
                      <select
                        value={userForm.userType}
                        onChange={(e) => setUserForm((prev) => ({
                          ...prev,
                          userType: e.target.value as 'independent' | 'integrated',
                          libraryOwnerId: e.target.value === 'integrated' ? (prev.libraryOwnerId || user?.id || '') : '',
                          categoryScopes: e.target.value === 'integrated' ? prev.categoryScopes : [],
                        }))}
                        className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                      >
                        <option value="independent">独立题库用户</option>
                        <option value="integrated">集成题库用户</option>
                      </select>
                    </div>
                    {userForm.userType === 'integrated' ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">接入题库来源</label>
                        <select
                          value={userForm.libraryOwnerId || user?.id || ''}
                          onChange={(e) => setUserForm((prev) => ({ ...prev, libraryOwnerId: e.target.value, categoryScopes: [] }))}
                          className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                        >
                          {[user, ...users.filter((item) => item.id !== user?.id && item.user_type === 'independent')].filter(Boolean).map((ownerCandidate) => (
                            <option key={ownerCandidate!.id} value={ownerCandidate!.id}>
                              {ownerCandidate!.username}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {userForm.role === 'user' && userForm.userType === 'integrated' ? (
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <div className="mb-3">
                      <p className="font-medium text-gray-900">分类范围授权</p>
                      <p className="text-sm text-gray-500">不选表示可访问接入题库下的全部分类；选中后仅可访问这些分类。</p>
                    </div>
                    {assignableCategories.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                        当前接入题库下暂无可授权分类，不选则默认可访问全部分类。
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {assignableCategories.map((category) => {
                          const checked = userForm.categoryScopes.includes(category.id);
                          return (
                            <label key={category.id} className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${checked ? 'border-indigo-200 bg-indigo-50/60' : 'border-gray-200 bg-gray-50'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setUserForm((prev) => ({
                                  ...prev,
                                  categoryScopes: e.target.checked
                                    ? [...prev.categoryScopes, category.id]
                                    : prev.categoryScopes.filter((id) => id !== category.id),
                                }))}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <span>
                                <span className="block text-sm font-medium text-gray-900">{category.name}</span>
                                {category.description ? <span className="mt-1 block text-xs text-gray-500">{category.description}</span> : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="font-medium text-gray-900">权限配置</p>
                      <p className="text-sm text-gray-500">管理员默认拥有全部权限；普通用户默认全部不选，请按模块勾选。</p>
                    </div>
                    {userForm.role === 'admin' ? (
                      <span className="inline-flex px-3 py-1 rounded-lg text-sm font-medium bg-purple-100 text-purple-700">全部权限</span>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {PERMISSION_GROUPS.map((group) => (
                      <div key={group.title} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                        <div className="mb-3">
                          <p className="font-medium text-gray-900">{group.title}</p>
                          <p className="text-xs text-gray-500 mt-1">{group.description}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {group.keys.map((key) => {
                            const permission = PERMISSION_OPTIONS.find((item) => item.key === key)!;
                            return (
                              <label key={permission.key} className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${userForm.permissions[permission.key] ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-white'} ${userForm.role === 'admin' ? 'opacity-60' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={userForm.role === 'admin' ? true : userForm.permissions[permission.key]}
                                  disabled={userForm.role === 'admin'}
                                  onChange={(e) => handlePermissionChange(permission.key, e.target.checked)}
                                  className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span>
                                  <span className="block text-sm font-medium text-gray-900">{permission.label}</span>
                                  <span className="block text-xs text-gray-500 mt-1">{permission.description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeUserModal}
                    className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveUser}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl text-white hover:from-blue-600 hover:to-indigo-700 transition-all"
                  >
                    {userModalMode === 'create' ? '创建用户' : '保存修改'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
