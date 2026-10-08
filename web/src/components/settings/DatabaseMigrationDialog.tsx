import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Edit3,
  Loader2,
  PlugZap,
  Plus,
  Power,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { adminApi } from '@/api';
import {
  DatabaseCounts,
  DatabaseProfile,
  DatabaseProfilesResponse,
  DatabaseValidationReport,
} from '@/types';

const migrationToastId = 'database-migration-operation';

interface DatabaseMigrationDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

type MigrationForm = {
  name: string;
  type: 'sqlite' | 'mysql';
  sqlitePath: string;
  mysqlHost: string;
  mysqlPort: string;
  mysqlUser: string;
  mysqlPassword: string;
  mysqlDatabase: string;
};

const defaultForm: MigrationForm = {
  name: '迁移目标',
  type: 'mysql',
  sqlitePath: './data/tech-growth-hub-migration.db',
  mysqlHost: '127.0.0.1',
  mysqlPort: '3306',
  mysqlUser: 'root',
  mysqlPassword: '',
  mysqlDatabase: 'tech_growth_hub',
};

const countLabels: Record<keyof DatabaseCounts, string> = {
  users: '用户',
  categories: '分类',
  questions: '题目',
  question_versions: '题目版本',
  learning_progress: '学习记录',
  review_states: '复习状态',
  review_events: '复习事件',
  ai_credentials: 'AI 凭据',
  ai_configs: 'AI 配置',
  system_settings: '系统设置',
};

export const DatabaseMigrationDialog: React.FC<DatabaseMigrationDialogProps> = ({
  open,
  onClose,
  onChanged,
}) => {
  const [data, setData] = useState<DatabaseProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operating, setOperating] = useState<string | null>(null);
  const [editing, setEditing] = useState<DatabaseProfile | null>(null);
  const [form, setForm] = useState<MigrationForm>(defaultForm);
  const [validation, setValidation] = useState<DatabaseValidationReport | null>(null);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getDatabaseProfiles();
      setData(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || '加载数据库迁移配置失败', { id: migrationToastId });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadProfiles();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setValidation(null);
      setOperating(null);
    }
  }, [open]);

  const resetForm = () => {
    setEditing(null);
    setForm(defaultForm);
  };

  const editProfile = (profile: DatabaseProfile) => {
    setEditing(profile);
    setForm({
      name: profile.name,
      type: profile.type,
      sqlitePath: profile.sqlite?.path || defaultForm.sqlitePath,
      mysqlHost: profile.mysql?.host || defaultForm.mysqlHost,
      mysqlPort: String(profile.mysql?.port || 3306),
      mysqlUser: profile.mysql?.user || defaultForm.mysqlUser,
      mysqlPassword: '',
      mysqlDatabase: profile.mysql?.database || defaultForm.mysqlDatabase,
    });
  };

  const saveProfile = async () => {
    if (!form.name.trim()) {
      toast.error('请输入迁移目标名称', { id: migrationToastId });
      return;
    }

    const payload = {
      name: form.name.trim(),
      type: form.type,
      sqlite: form.type === 'sqlite' ? { path: form.sqlitePath.trim() } : undefined,
      mysql: form.type === 'mysql'
        ? {
            host: form.mysqlHost.trim(),
            port: Number(form.mysqlPort || 3306),
            user: form.mysqlUser.trim(),
            password: form.mysqlPassword || undefined,
            database: form.mysqlDatabase.trim(),
          }
        : undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await adminApi.updateDatabaseProfile(editing.id, payload);
        toast.success('迁移目标已更新', { id: migrationToastId });
      } else {
        await adminApi.createDatabaseProfile(payload);
        toast.success('迁移目标已保存', { id: migrationToastId });
      }
      resetForm();
      await loadProfiles();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存迁移目标失败', { id: migrationToastId });
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    profile: DatabaseProfile,
    actionKey: string,
    action: () => Promise<any>,
    successMessage?: string,
  ) => {
    setOperating(`${profile.id}:${actionKey}`);
    try {
      const response = await action();
      toast.success(successMessage || response.data?.message || '操作完成', { id: migrationToastId });
      return response;
    } catch (error: any) {
      toast.error(error.response?.data?.error || '数据库操作失败', { id: migrationToastId });
      return null;
    } finally {
      setOperating(null);
    }
  };

  const removeProfile = async (profile: DatabaseProfile) => {
    if (!window.confirm(`确定删除迁移目标“${profile.name}”吗？`)) return;
    const response = await runAction(profile, 'delete', () => adminApi.deleteDatabaseProfile(profile.id));
    if (response) {
      if (editing?.id === profile.id) resetForm();
      await loadProfiles();
    }
  };

  const migrate = async (profile: DatabaseProfile, overwrite: boolean) => {
    if (overwrite && !window.confirm('覆盖迁移会清空目标数据库中的现有数据，确定继续吗？')) return;
    const response = await runAction(
      profile,
      overwrite ? 'overwrite' : 'migrate',
      () => adminApi.migrateDatabaseProfile(profile.id, overwrite),
    );
    if (response?.data?.report) setValidation(response.data.report);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-migration-title"
        data-testid="database-migration-dialog"
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white">
              <ArrowRightLeft size={20} />
            </div>
            <div>
              <h2 id="database-migration-title" className="text-xl font-semibold text-slate-950">数据库迁移</h2>
              <p className="mt-1 text-sm text-slate-500">Database migration · 配置目标库、迁移数据并校验结果</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭数据库迁移"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6">
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-5">
              迁移不会立即切换当前连接。请先测试、迁移并校验，确认无误后再设置为重启后使用。覆盖迁移会清空目标库现有数据。
            </p>
          </div>

          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-950">{editing ? '编辑迁移目标' : '添加迁移目标'}</h3>
                  <p className="mt-1 text-xs text-slate-500">仅保存连接参数，不会自动迁移</p>
                </div>
                {editing ? (
                  <button type="button" onClick={resetForm} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                    取消编辑
                  </button>
                ) : null}
              </div>

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">目标名称</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">数据库类型</span>
                  <select
                    value={form.type}
                    onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as 'sqlite' | 'mysql' }))}
                    className="select-field mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                  >
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </label>

                {form.type === 'sqlite' ? (
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">数据库文件路径</span>
                    <input
                      value={form.sqlitePath}
                      onChange={(event) => setForm((current) => ({ ...current, sqlitePath: event.target.value }))}
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"
                    />
                  </label>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="col-span-2 block">
                      <span className="text-sm font-medium text-slate-700">主机地址</span>
                      <input value={form.mysqlHost} onChange={(event) => setForm((current) => ({ ...current, mysqlHost: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white" />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">端口</span>
                      <input type="number" value={form.mysqlPort} onChange={(event) => setForm((current) => ({ ...current, mysqlPort: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white" />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-700">用户名</span>
                      <input value={form.mysqlUser} onChange={(event) => setForm((current) => ({ ...current, mysqlUser: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white" />
                    </label>
                    <label className="col-span-2 block">
                      <span className="text-sm font-medium text-slate-700">数据库名</span>
                      <input value={form.mysqlDatabase} onChange={(event) => setForm((current) => ({ ...current, mysqlDatabase: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white" />
                    </label>
                    <label className="col-span-2 block">
                      <span className="text-sm font-medium text-slate-700">
                        密码 {editing?.mysql?.hasPassword ? '（留空保持原密码）' : ''}
                      </span>
                      <input type="password" value={form.mysqlPassword} onChange={(event) => setForm((current) => ({ ...current, mysqlPassword: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white" />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {editing ? '保存修改' : '保存迁移目标'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="font-semibold text-slate-950">迁移流程</h3>
                <p className="mt-1 text-xs text-slate-500">按顺序执行连接测试、初始化、迁移、校验和切换</p>
              </div>

              <div className="space-y-4 p-5">
                {loading ? (
                  <div className="flex justify-center py-12 text-blue-600"><Loader2 className="animate-spin" /></div>
                ) : !data || data.profiles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                    <Database className="mx-auto text-slate-300" size={28} />
                    <p className="mt-3 text-sm font-medium text-slate-700">还没有迁移目标</p>
                    <p className="mt-1 text-xs text-slate-500">先填写左侧连接信息并保存。</p>
                  </div>
                ) : data.profiles.map((profile) => {
                  const selected = data.selectedProfileId === profile.id;
                  const busy = operating?.startsWith(`${profile.id}:`) || false;
                  return (
                    <article key={profile.id} className={`rounded-xl border p-4 ${selected ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-slate-900">{profile.name}</h4>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {profile.type === 'sqlite' ? 'SQLite' : 'MySQL / MariaDB'}
                            </span>
                            {selected ? (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">重启后使用</span>
                            ) : null}
                          </div>
                          <p className="mt-1 break-all text-xs text-slate-500">
                            {profile.type === 'sqlite'
                              ? profile.sqlite?.path
                              : `${profile.mysql?.host}:${profile.mysql?.port}/${profile.mysql?.database}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => editProfile(profile)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600" aria-label={`编辑 ${profile.name}`}><Edit3 size={15} /></button>
                          <button type="button" onClick={() => removeProfile(profile)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`删除 ${profile.name}`}><Trash2 size={15} /></button>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
                        <MigrationButton icon={PlugZap} label="1. 测试连接" disabled={busy} onClick={() => runAction(profile, 'test', () => adminApi.testDatabaseProfile(profile.id))} />
                        <MigrationButton icon={Wrench} label="2. 初始化" disabled={busy} onClick={() => runAction(profile, 'init', () => adminApi.initDatabaseProfile(profile.id))} />
                        <MigrationButton icon={ArrowRightLeft} label="3. 迁移数据" primary disabled={busy} onClick={() => migrate(profile, false)} />
                        <MigrationButton icon={ClipboardCheck} label="4. 校验数据" disabled={busy} onClick={async () => {
                          const response = await runAction(profile, 'validate', () => adminApi.validateDatabaseProfile(profile.id), '数据校验完成');
                          if (response) setValidation(response.data);
                        }} />
                        <MigrationButton icon={Power} label="5. 重启后使用" disabled={busy || selected} onClick={async () => {
                          const response = await runAction(profile, 'select', () => adminApi.selectDatabaseProfile(profile.id));
                          if (response) {
                            await loadProfiles();
                            onChanged();
                          }
                        }} />
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <span className="text-[11px] text-slate-400">目标库已有数据时，普通迁移会停止并提示。</span>
                        <button type="button" disabled={busy} onClick={() => migrate(profile, true)} className="shrink-0 text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50">
                          覆盖迁移
                        </button>
                      </div>
                    </article>
                  );
                })}

                {data?.selectedProfileId ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setOperating('env:restore');
                      try {
                        const response = await adminApi.useEnvDatabase();
                        toast.success(response.data.message, { id: migrationToastId });
                        await loadProfiles();
                        onChanged();
                      } catch (error: any) {
                        toast.error(error.response?.data?.error || '取消数据库切换失败', { id: migrationToastId });
                      } finally {
                        setOperating(null);
                      }
                    }}
                    disabled={operating === 'env:restore'}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                  >
                    取消切换，继续使用部署环境中的数据库
                  </button>
                ) : null}
              </div>
            </section>
          </div>

          {validation ? (
            <section className={`mt-5 rounded-2xl border p-5 ${validation.matches ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className={validation.matches ? 'text-emerald-600' : 'text-amber-600'} />
                <h3 className="font-semibold text-slate-900">{validation.matches ? '数据校验通过' : '数据数量存在差异'}</h3>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {(Object.keys(countLabels) as Array<keyof DatabaseCounts>).map((key) => (
                  <div key={key} className="rounded-lg border border-white/80 bg-white/75 p-3">
                    <p className="text-[11px] text-slate-500">{countLabels[key]}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{validation.source[key]} / {validation.target[key]}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">数值顺序：源数据库 / 目标数据库</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

interface MigrationButtonProps {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}

const MigrationButton: React.FC<MigrationButtonProps> = ({ icon: Icon, label, disabled, primary, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      primary
        ? 'bg-blue-600 text-white hover:bg-blue-700'
        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
    }`}
  >
    {disabled ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
    {label}
  </button>
);
