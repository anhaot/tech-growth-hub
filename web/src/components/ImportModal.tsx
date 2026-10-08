import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, Download, Sparkles } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { importApi } from '@/api';
import { Category, ImportPreview, ImportResult } from '@/types';

const AI_IMPORT_PROMPT_TEMPLATE = `请按 JSON 返回一组适合记忆背题的题目，不要输出任何解释性文字。

要求：
1. 返回格式必须是 JSON 数组
2. 每一项包含 title、content、answer、explanation、difficulty、tags
3. difficulty 只能是 easy、medium、hard
4. answer 要准确、简洁、利于记忆
5. explanation 用于背题时快速理解
6. tags 为可选字段，如有标签，每题最多 5 个

示例：
[
  {
    "title": "HTTP 常见状态码",
    "content": "说出 200、301、404、500 的含义。",
    "answer": "200 成功；301 永久重定向；404 资源不存在；500 服务器内部错误。",
    "explanation": "这几个状态码是 Web 开发最常见的排障基础。",
    "difficulty": "easy",
    "tags": ["HTTP", "状态码"]
  },
  {
    "title": "什么是 Docker 镜像",
    "content": "说明 Docker 镜像的含义。",
    "answer": "Docker 镜像是用于创建容器的只读模板。",
    "explanation": "题目没有标签也可以正常导入。",
    "difficulty": "easy"
  }
]`;

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onSuccess: () => void;
}

const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, categories, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [importType, setImportType] = useState<'csv' | 'json' | 'markdown' | 'ai'>('markdown');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [aiText, setAiText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const previewSection = useRef<HTMLElement>(null);
  const resultSection = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const busy = useRef(false);
  const imported = useRef(false);
  const resetPreview = () => { requestSequence.current++; setPreview(null); setExcluded(new Set()); setResult(null); setError(''); };
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { requestSequence.current++; previous?.focus(); };
  }, [isOpen]);

  useEffect(() => {
    if (result) resultSection.current?.scrollIntoView({ block: 'start' });
    else previewSection.current?.scrollIntoView({ block: 'start' });
  }, [preview?.id, preview?.page, result]);

  const csvExample = `内容,答案,难度,解析,标签
什么是HTTP协议?,HTTP是HyperText Transfer Protocol的缩写，即超文本传输协议。,medium,HTTP协议定义了客户端和服务器之间的通信规则,"HTTP,协议"`;

  const jsonExample = `[
  {
    "content": "什么是Docker?",
    "answer": "Docker是一个开源的应用容器引擎。",
    "difficulty": "easy",
    "tags": ["docker", "容器"]
  },
  {
    "content": "什么是容器编排?",
    "answer": "容器编排是对多个容器进行自动化部署、调度和管理。",
    "difficulty": "medium"
  }
]`;

  const markdownExample = `**什么是Kubernetes?**
答案：Kubernetes是一个开源的容器编排平台。
标签：kubernetes, 容器

**Docker和K8s的区别是什么？**
答案：Docker是容器运行时，K8s是容器编排平台。
标签：docker, kubernetes`;

  const downloadExample = () => {
    let content = '';
    let filename = '';

    if (importType === 'csv') {
      content = csvExample;
      filename = '题目导入样例.csv';
    } else if (importType === 'json') {
      content = jsonExample;
      filename = '题目导入样例.json';
    } else if (importType === 'markdown') {
      content = markdownExample;
      filename = '题目导入样例.md';
    } else {
      content = AI_IMPORT_PROMPT_TEMPLATE;
      filename = 'AI生题提示词.txt';
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePreview = async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError('');
    const sequence = ++requestSequence.current;
    try {
      let response;
      if (importType === 'ai') {
        const parsed: unknown = JSON.parse(aiText.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const questions = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown[] } | null)?.questions;
        if (!Array.isArray(questions)) throw new Error('AI 内容必须是 JSON 数组或包含 questions 数组');
        response = await importApi.previewText(questions, categoryId || undefined);
      } else {
        if (!file) throw new Error('请选择文件');
        if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB');
        response = await importApi.previewFile(importType, file, categoryId || undefined);
      }
      if (sequence !== requestSequence.current) return;
      setPreview(response.data); setExcluded(new Set()); setResult(null);
    } catch (err: any) { if (sequence === requestSequence.current) setError(err.response?.data?.error || err.message || '无法解析预览'); }
    finally { busy.current = false; setLoading(false); }
  };
  const loadPage = async (page: number) => {
    if (!preview || busy.current) return;
    busy.current = true; setLoading(true); setError('');
    const sequence = ++requestSequence.current;
    try {
      const response = await importApi.getPreview(preview.id, page);
      if (sequence === requestSequence.current) setPreview(response.data);
    } catch (err: any) { if (sequence === requestSequence.current) setError(err.response?.data?.error || '预览加载失败，请重新解析'); }
    finally { busy.current = false; setLoading(false); }
  };
  const handleImport = async () => {
    if (!preview || busy.current || result) return;
    busy.current = true; setLoading(true); setError('');
    try {
      const response = await importApi.commitPreview(preview.id, [...excluded]);
      setResult(response.data);
      if (response.data.success) { imported.current = true; toast.success(`成功导入 ${response.data.success} 道题目`); }
      else toast.error('没有导入成功的题目，请查看错误信息');
    } catch (err: any) { setError(err.response?.data?.error || '导入请求失败，可再次确认以查询处理结果'); }
    finally { busy.current = false; setLoading(false); }
  };
  const handleClose = () => {
    if (busy.current) return;
    if (imported.current) { imported.current = false; onSuccess(); }
    resetPreview(); setFile(null); setAiText(''); onClose();
  };
  const downloadErrors = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.errors, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '导入错误.json'; anchor.click(); URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={handleClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="导入题目" className="app-modal-panel w-full max-w-3xl max-h-[90vh] overflow-hidden" onKeyDown={(event) => {
        if (event.key === 'Escape') handleClose();
        if (event.key === 'Tab') {
          const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary');
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <div className="app-modal-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">导入题目</h2>
          </div>
          <button aria-label="关闭导入" disabled={loading} onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(90vh-140px)]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['csv', 'json', 'markdown', 'ai'] as const).map((type) => (
            <button
              key={type}
              disabled={loading}
              onClick={() => { setImportType(type); setFile(null); resetPreview(); }}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
                  importType === type
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {type === 'csv' ? 'CSV格式' : type === 'json' ? 'JSON格式' : type === 'markdown' ? 'Markdown格式' : 'AI粘贴导入'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">导入到分类（可选）</label>
            <select
              value={categoryId}
              disabled={loading}
              aria-label="导入到分类"
              onChange={(e) => { setCategoryId(e.target.value); resetPreview(); }}
              className="select-field w-full px-4 pr-10 py-3 text-gray-700 bg-gray-50 focus:bg-white cursor-pointer"
            >
              <option value="">保留文件分类 / 无分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {importType === 'ai' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900">AI 生成后直接粘贴 JSON</p>
                    <p className="text-sm text-gray-600">先让 ChatGPT / DeepSeek / 豆包生成题目，再粘贴预览后确认导入。</p>
                  </div>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(AI_IMPORT_PROMPT_TEMPLATE);
                      toast.success('AI提示词已复制');
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    <Sparkles size={16} />
                    复制提示词
                  </button>
                </div>
              </div>
              <textarea
                value={aiText}
                aria-label="AI JSON 内容"
                disabled={loading}
                onChange={(e) => { setAiText(e.target.value); resetPreview(); }}
                rows={10}
                placeholder="把 AI 返回的 JSON 数组粘贴到这里"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all font-mono text-sm"
              />
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center hover:border-gray-300 transition-colors">
              <input
                key={importType}
                type="file"
                accept={importType === 'csv' ? '.csv' : importType === 'json' ? '.json' : '.md,.markdown,.txt'}
                disabled={loading}
                onChange={(e) => { setFile(e.target.files?.[0] || null); resetPreview(); }}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <div className="p-3 bg-gray-100 rounded-lg inline-flex mb-3">
                  <Upload className="h-6 w-6 text-gray-600" />
                </div>
                <p className="text-gray-700 font-medium">{file ? file.name : '点击上传文件'}</p>
                <p className="text-sm text-gray-400 mt-1">支持 {importType.toUpperCase()} 格式，最大 10 MB</p>
              </label>
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-gray-800">文件格式样例</p>
              <button onClick={downloadExample} className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
                <Download size={14} />
                下载样例
              </button>
            </div>
            <pre className="text-xs text-gray-700 bg-white p-3 rounded-lg overflow-x-auto max-h-32 whitespace-pre-wrap border border-gray-200">
              {importType === 'csv' ? csvExample : importType === 'json' ? jsonExample : importType === 'markdown' ? markdownExample : AI_IMPORT_PROMPT_TEMPLATE}
            </pre>
          </div>

          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><p role="alert" className="break-words">{error}</p>{preview && !result && <button disabled={loading} onClick={handlePreview} className="mt-2 min-h-11 text-primary-700">重新解析预览</button>}</div>}
          {preview && !result && <section ref={previewSection} aria-label="导入预览" className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
              <p className="font-medium">共 {preview.total} 道，可导入 {preview.valid} 道，错误 {preview.invalid} 道</p>
              <p className="mt-1">将导入 {preview.valid - excluded.size} 道；已排除 {excluded.size} 道。错误题目不会导入。</p>
              <p className="mt-1 text-gray-600">预览保留 15 分钟。核对题干、答案和分类后再确认；更换文件或分类需重新解析。</p>
            </div>
            {preview.rows.map(row => <article key={row.row} className={`rounded-lg border p-3 text-sm ${row.error ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
              <div className="flex items-start gap-2">
                {row.question && <input type="checkbox" aria-label={`导入第 ${row.row} 条题目`} checked={!excluded.has(row.row)} disabled={loading} onChange={(event) => {
                  const checked = event.target.checked; setExcluded(current => { const next = new Set(current); if (checked) next.delete(row.row); else next.add(row.row); return next; });
                }} className="mt-1 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1"><p className="font-medium break-words">第 {row.row} 条{row.question ? ` · ${row.question.title}` : ''}</p>
                  {row.error ? <p className="mt-1 text-red-700 break-words">{row.error}</p> : row.question && <>
                    <p className="mt-1 text-gray-500 break-words">分类：{row.question.categoryId ? categories.find(category => category.id === row.question!.categoryId)?.name || row.question.categoryId : '无分类'} · 难度：{({ easy: '简单', medium: '中等', hard: '困难' })[row.question.difficulty]} · 标签：{row.question.tags.join('、') || '无'}</p>
                    {row.warnings.map(warning => <p key={warning} className="mt-1 text-amber-700">{warning}</p>)}
                    <details className="mt-2"><summary className="cursor-pointer text-primary-700">查看题干、答案与解析</summary>
                      {([['题干', row.question.content], ['答案', row.question.answer], ['解析', row.question.explanation]] as const).map(([label, value]) => <div key={label} className="mt-2"><p className="text-gray-500">{label}</p><pre className="whitespace-pre-wrap break-words font-sans">{value || '（空）'}</pre></div>)}
                    </details>
                  </>}
                </div>
              </div>
            </article>)}
            <div className="flex items-center justify-between gap-2"><button disabled={loading || preview.page <= 1} onClick={() => loadPage(preview.page - 1)} className="min-h-11 disabled:opacity-40">上一页预览</button><span>{preview.page} / {preview.totalPages}</span><button disabled={loading || preview.page >= preview.totalPages} onClick={() => loadPage(preview.page + 1)} className="min-h-11 disabled:opacity-40">下一页预览</button></div>
          </section>}

          {result && (
            <div ref={resultSection} className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-green-700 font-medium">成功导入：{result.success} 道</p>
              {!!result.skipped && <p className="text-sm mt-1">主动排除：{result.skipped} 道</p>}
              {result.failed > 0 && <><p className="text-red-600 text-sm mt-1">未导入：{result.failed} 道</p><button onClick={downloadErrors} className="mt-2 text-sm text-primary-700">下载错误明细</button><ul className="mt-2 space-y-1 text-sm text-red-700">{result.errors.slice(0, 20).map(item => <li key={item.row} className="break-words">第 {item.row} 条：{item.error}</li>)}</ul></>}
              <p className="mt-2 text-sm text-gray-500">关闭后题库列表会刷新。</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-5 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            关闭
          </button>
          <button
            onClick={preview && !result ? handleImport : handlePreview}
            disabled={loading || (preview && !result ? preview.valid === excluded.size : (importType === 'ai' ? !aiText.trim() : !file))}
            className="px-5 py-2.5 bg-primary-600 rounded-lg text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '处理中...' : preview && !result ? `确认导入 ${preview.valid - excluded.size} 道题目` : result ? '重新解析预览' : '解析预览'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ImportModal;
