import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { categoryApi, questionApi } from '@/api';
import { Category, Question, QuestionVersion } from '@/types';
import { useAuthStore } from '@/store';
import { hasPermission } from '@/lib/permissions';
import { parseQuestionTags } from '@/lib/questionTags';

interface Props { question: Question | null; onClose: () => void; onRestored: (question: Question) => void }
const fields = [['title', '标题'], ['content', '题干'], ['answer', '答案'], ['explanation', '解析'], ['difficulty', '难度'], ['category_id', '分类'], ['tags', '标签']] as const;
export default function QuestionHistoryModal({ question, onClose, onRestored }: Props) {
  const { user } = useAuthStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [selected, setSelected] = useState<QuestionVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const canRestore = hasPermission(user, 'question_edit_content') && hasPermission(user, 'question_edit_meta');
  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    categoryApi.getAll().then(({ data }) => { if (!cancelled) setCategories(data); }).catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [question?.id]);
  useEffect(() => { setPage(1); setSelected(null); setConfirming(false); }, [question?.id]);
  useEffect(() => {
    if (!question) return;
    let cancelled = false;
    setLoading(true); setError('');
    questionApi.getVersions(question.id, page).then(({ data }) => {
      if (cancelled) return;
      setVersions(data.data); setTotalPages(data.totalPages); setSelected(data.data[0] || null); setConfirming(false);
    }).catch((err) => { if (!cancelled) setError(err.response?.data?.error || '无法读取版本，请重试'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [question?.id, question?.revision, page]);
  useEffect(() => {
    if (!question) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, [question?.id]);
  if (!question) return null;
  let snapshot: Question | null = null;
  try { snapshot = selected ? JSON.parse(selected.snapshot) as Question : null; } catch { /* Show malformed backup history instead of crashing. */ }
  const displayValue = (field: typeof fields[number][0], value: Question) => {
    if (field === 'difficulty') return ({ easy: '简单', medium: '中等', hard: '困难' })[value.difficulty] || value.difficulty;
    if (field === 'category_id') return value.category_id ? categories.find((category) => category.id === value.category_id)?.name || '已删除或不可见的分类' : '无分类';
    if (field === 'tags') return parseQuestionTags(value.tags).join('、') || '无标签';
    return value[field] || '（空）';
  };
  const restore = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const response = await questionApi.restoreVersion(question.id, selected.version, question.revision || 1);
      onRestored(response.data); setConfirming(false); toast.success('版本已回退，并保留了回退前的内容');
    } catch (err: any) { toast.error(err.response?.data?.error || '回退失败'); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/30 p-4">
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="题目版本历史" className="app-modal-panel mx-auto my-6 w-full max-w-4xl" onKeyDown={(event) => {
      if (event.key === 'Escape' && !saving) onClose();
      if (event.key === 'Tab') {
        const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="app-modal-header flex justify-between items-center p-4"><h2 className="font-semibold">题目版本历史 · 当前 v{question.revision || 1}</h2><button aria-label="关闭版本历史" disabled={saving} onClick={onClose}><X size={20} /></button></div>
      <div className="p-4 space-y-4">
        <p className="text-sm text-gray-500">选择历史版本查看差异。回退会生成新版本，可再次恢复到回退前的内容。</p>
        {loading ? <p role="status">正在读取版本…</p> : error ? <p role="alert" className="text-red-600">{error}</p> : <>
          <div className="flex flex-wrap gap-2">{versions.map((version) => <button key={version.version} onClick={() => { setSelected(version); setConfirming(false); }} className={`rounded-lg border px-3 py-2 text-sm ${version.version === selected?.version ? 'border-primary-500 bg-primary-50' : 'border-gray-200'}`}>
            v{version.version} · {version.source.startsWith('restore:') ? `回退自 v${version.source.split(':')[1]}` : version.source === 'initial' ? '初始记录' : version.source === 'merge' ? '合并' : version.source === 'ai-polish' ? 'AI 润色' : version.source === 'ai-answer' ? 'AI 答案' : version.source === 'ai-tags' ? 'AI 标签' : version.source === 'tags' ? '标签治理' : version.source.startsWith('script:') ? '脚本修订' : '修改'}<br />{new Date(version.created_at).toLocaleString('zh-CN')}
          </button>)}</div>
          <div className="flex justify-between text-sm"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页版本</button><span>{page}/{totalPages || 1}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页版本</button></div>
          {selected ? <p className="text-xs text-gray-500">操作者：{selected.actor_name || (selected.actor_id ? '操作者信息不可用' : '系统或初始记录')}；仅显示当前授权分类的历史版本。</p> : null}
          {snapshot ? <div className="max-h-[50vh] overflow-y-auto space-y-3">{fields.map(([field, label]) => {
            const changed = snapshot![field] !== question[field];
            return <div key={field} className="rounded-lg border p-3"><h3 className="text-sm font-medium">{label}{changed ? <span className="ml-2 text-amber-600">有差异</span> : <span className="ml-2 text-gray-400">相同</span>}</h3>
              <div className="grid gap-3 sm:grid-cols-2 mt-2 text-sm"><div><p className="text-gray-500 mb-1">当前内容</p><pre className="whitespace-pre-wrap break-words font-sans">{displayValue(field, question)}</pre></div><div><p className="text-gray-500 mb-1">v{selected?.version} 内容</p><pre className="whitespace-pre-wrap break-words font-sans">{displayValue(field, snapshot!)}</pre></div></div>
            </div>;
          })}</div> : <p>该版本数据无法读取。</p>}
          {confirming ? <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-3"><p>确认将标题、题干、答案、解析、分类、难度和标签全部回退到 v{selected?.version}？收藏和学习进度不受影响。</p><div className="flex gap-3"><button className="btn-primary" disabled={saving} onClick={restore}>{saving ? '正在回退…' : '确认回退'}</button><button disabled={saving} onClick={() => setConfirming(false)}>取消</button></div></div> : canRestore && snapshot && selected?.version !== (question.revision || 1) ? <button className="btn-primary" onClick={() => setConfirming(true)}>回退到此版本</button> : null}
        </>}
      </div>
    </div>
  </div>;
}
