import React, { useState, useEffect, useRef } from 'react';
import { questionApi, categoryApi, importApi, aiApi } from '@/api';
import { Question, Category, PaginatedResult, SimilarQuestionPair, DuplicateScanResult, AIConfig, AIModelOption } from '@/types';
import { useAuthStore } from '@/store';
import { hasPermission } from '@/lib/permissions';
import { getTagColorClasses } from '@/lib/tagColors';
import { MAX_QUESTION_TAGS, parseQuestionTags } from '@/lib/questionTags';
import { renderSafeMarkdown } from '@/lib/renderMarkdown';
import { applyTagSuggestion, getFilteredTagSuggestions } from '@/lib/tagSuggestions';
import { formatStructuredDraftText } from '@/lib/aiDraftFormatting';
import ImportModal from '@/components/ImportModal';
import QuestionHistoryModal from '@/components/QuestionHistoryModal';
import AIAnswerDraftModal from '@/components/AIAnswerDraftModal';
import { LoadingSpinner } from '@/components/ui';
import { toast } from 'react-hot-toast';
import {
  Plus,
  Edit,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
  Download,
  AlertTriangle,
  Search,
  Filter,
  BookOpen,
  X,
  Check,
  Sparkles,
  Tags,
  FileText,
  MoreHorizontal,
} from 'lucide-react';

interface QuestionListFilter {
  categoryId: string;
  difficulty: string;
  keyword: string;
  tags: string[];
}

const defaultQuestionFilter: QuestionListFilter = {
  categoryId: '',
  difficulty: '',
  keyword: '',
  tags: [],
};

const questionListCache = new Map<string, PaginatedResult<Question>>();

const getQuestionListCacheKey = (
  scope: string,
  page: number,
  pageSize: number,
  filter: QuestionListFilter
) => [
  scope,
  page,
  pageSize,
  filter.categoryId,
  filter.difficulty,
  filter.keyword,
  filter.tags.join(','),
].join('|');

export const QuestionsPage: React.FC = () => {
  const { user } = useAuthStore();
  const cacheScope = JSON.stringify([user?.id, user?.role, user?.user_type, user?.library_owner_id, user?.category_scopes, user?.permissions]);
  const canManageQuestions = hasPermission(user, 'question_view');
  const canCreateQuestions = hasPermission(user, 'question_create');
  const canEditQuestionContent = hasPermission(user, 'question_edit_content');
  const canEditQuestionMeta = hasPermission(user, 'question_edit_meta');
  const canEditQuestions = canEditQuestionContent || canEditQuestionMeta;
  const canDeleteQuestions = hasPermission(user, 'question_delete');
  const canBatchEditQuestions = hasPermission(user, 'question_batch_edit');
  const canExportQuestions = hasPermission(user, 'question_export');
  const canSelectQuestions = canBatchEditQuestions || canDeleteQuestions;
  const canImportQuestions = hasPermission(user, 'import_manage');
  const canUseAI = hasPermission(user, 'ai_use');
  const canGenerateQuestions = hasPermission(user, 'ai_generate');
  const canCheckDuplicates = hasPermission(user, 'duplicate_manage');
  const canAIPolish = canUseAI && hasPermission(user, 'ai_polish');
  const initialQuestionCache = questionListCache.get(getQuestionListCacheKey(cacheScope, 1, 50, defaultQuestionFilter));
  const [questions, setQuestions] = useState<PaginatedResult<Question> | null>(initialQuestionCache || null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(!initialQuestionCache);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<QuestionListFilter>(defaultQuestionFilter);
  const [tagInput, setTagInput] = useState('');
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([]);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAIGenerateModal, setShowAIGenerateModal] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [showBatchTagsModal, setShowBatchTagsModal] = useState(false);
  const [batchTagsMode, setBatchTagsMode] = useState<'add' | 'remove' | 'replace'>('add');
  const [showAIBatchTagsModal, setShowAIBatchTagsModal] = useState(false);
  const [showPolishModal, setShowPolishModal] = useState(false);
  const [polishQuestion, setPolishQuestion] = useState<Question | null>(null);
  const [showAnswerDraftModal, setShowAnswerDraftModal] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [openMobileQuestionMenuId, setOpenMobileQuestionMenuId] = useState<string | null>(null);
  const [answerDraftQuestion, setAnswerDraftQuestion] = useState<Question | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [historyQuestion, setHistoryQuestion] = useState<Question | null>(null);
  const [scanResult, setScanResult] = useState<DuplicateScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const scanSequence = useRef(0);
  const listSequence = useRef(0);
  const [duplicates, setDuplicates] = useState<Array<{ title: string; count: number; questions: Question[] }>>([]);
  const [similarDuplicates, setSimilarDuplicates] = useState<SimilarQuestionPair[]>([]);
  const [pageSize, setPageSize] = useState(50);
  const allPageSelected = Boolean(questions?.data.length && questions.data.every((question) => selectedIds.includes(question.id)));
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('json');

  const fetchQuestions = async () => {
    const sequence = ++listSequence.current;
    const cacheKey = getQuestionListCacheKey(cacheScope, page, pageSize, filter);
    const cached = questionListCache.get(cacheKey);
    if (cached) {
      setQuestions(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const response = await questionApi.getAll({
        page,
        pageSize,
        ...filter,
      });
      if (sequence !== listSequence.current) return;
      const lastPage = Math.max(1, response.data.totalPages);
      if (page > lastPage) { setPage(lastPage); return; }
      if (questionListCache.size >= 30) questionListCache.delete(questionListCache.keys().next().value!);
      questionListCache.set(cacheKey, response.data);
      setQuestions(response.data);
    } catch (error) {
      if (sequence === listSequence.current) toast.error('获取题目列表失败');
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  };

  const fetchTags = async () => {
    try {
      const response = await questionApi.getTags({
        categoryId: filter.categoryId || undefined,
        difficulty: filter.difficulty || undefined,
        keyword: filter.keyword || undefined,
      });
      setAvailableTags(response.data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await categoryApi.getAll();
      setCategories(response.data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const applyScanResult = (result: DuplicateScanResult) => {
    setScanResult(result); setDuplicates(result.groups); setSimilarDuplicates(result.pairs);
  };
  const checkDuplicates = async () => {
    const sequence = ++scanSequence.current;
    setShowDuplicateModal(true); setScanResult(null); setScanError(''); setDuplicates([]); setSimilarDuplicates([]);
    try {
      const { data } = await questionApi.startDuplicateScan();
      while (sequence === scanSequence.current) {
        const response = await questionApi.getDuplicateScan(data.id);
        if (sequence !== scanSequence.current) return;
        applyScanResult(response.data);
        if (response.data.status === 'failed') throw new Error('扫描失败，请重新检查');
        if (response.data.status === 'completed') break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    } catch (error: any) { if (sequence === scanSequence.current) setScanError(error.response?.data?.error || error.message || '检查重复题目失败'); }
  };
  const changeScanPage = async (nextPage: number, memberPage = 1) => {
    if (!scanResult) return;
    const sequence = scanSequence.current;
    try {
      const response = await questionApi.getDuplicateScan(scanResult.id, nextPage, memberPage);
      if (sequence === scanSequence.current) applyScanResult(response.data);
    } catch (error: any) { toast.error(error.response?.data?.error || '加载结果失败'); }
  };
  useEffect(() => () => { scanSequence.current++; listSequence.current++; }, []);

  const deleteDuplicate = async (_keepId: string, deleteIds: string[]) => {
    try {
      await questionApi.batchDelete(deleteIds);
      toast.success(`已删除 ${deleteIds.length} 道重复题目`);
      fetchQuestions();
      checkDuplicates();
    } catch (error) {
      toast.error('删除失败');
    }
  };

  useEffect(() => {
    setSelectedIds([]);
    fetchCategories();
  }, [cacheScope]);

  useEffect(() => {
    fetchQuestions();
  }, [page, filter, pageSize, cacheScope]);

  useEffect(() => {
    fetchTags();
  }, [filter.categoryId, filter.difficulty, filter.keyword]);

  const addFilterTag = (value: string) => {
    const nextTag = value.trim();
    if (!nextTag || filter.tags.includes(nextTag)) {
      setTagInput('');
      return;
    }
    setPage(1);
    setFilter((prev) => ({ ...prev, tags: [...prev.tags, nextTag] }));
    setTagInput('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这道题目吗？')) return;

    try {
      await questionApi.delete(id);
      toast.success('删除成功');
      fetchQuestions();
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      toast.error('请选择要删除的题目');
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedIds.length} 道题目吗？`)) return;

    try {
      await questionApi.batchDelete(selectedIds);
      toast.success('批量删除成功');
      setSelectedIds([]);
      fetchQuestions();
    } catch (error) {
      toast.error('批量删除失败');
    }
  };

  const openBatchTagsModal = (mode: 'add' | 'remove' | 'replace') => {
    if (selectedIds.length === 0) {
      toast.error('请先选择题目');
      return;
    }
    setBatchTagsMode(mode);
    setShowBatchTagsModal(true);
  };

  const openPolishModal = (question: Question) => {
    setPolishQuestion(question);
    setShowPolishModal(true);
  };

  const openAnswerDraftModal = (question: Question) => {
    setAnswerDraftQuestion(question);
    setShowAnswerDraftModal(true);
  };

  const handleMergeDuplicate = async (keepId: string, removeId: string) => {
    if (!confirm('确定保留当前题，并把另一题的标签/分类/解析合并后删除另一题吗？')) {
      return;
    }

    try {
      await questionApi.mergeDuplicate(keepId, removeId);
      toast.success('已合并重复题');
      fetchQuestions();
      checkDuplicates();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '合并重复题失败');
    }
  };

  const handleClearAll = async () => {
    const total = questions?.total || 0;
    if (total === 0) {
      toast.error('题库为空');
      return;
    }

    if (!confirm(`确定要清空所有 ${total} 道题目吗？此操作不可恢复！`)) return;

    try {
      const result = await questionApi.clearAll();
      toast.success(result.data.message);
      setSelectedIds([]);
      fetchQuestions();
    } catch (error) {
      toast.error('清空题库失败');
    }
  };

  const handleExport = async () => {
    try {
      const result = await questionApi.export(filter.categoryId);
      const exportData = result.data.questions;
      
      const markdown = exportData.map((q: any) => {
        let text = `**${q.title}**\n`;
        if (q.content && q.content !== q.title) {
          text += `${q.content}\n`;
        }
        text += `答案：${q.answer}\n`;
        if (q.explanation) {
          text += `解析：${q.explanation}\n`;
        }
        return text;
      }).join('\n');

      const serialized = exportFormat === 'json' ? JSON.stringify({ formatVersion: 1, questions: exportData }, null, 2) : markdown;
      const blob = new Blob([serialized], { type: exportFormat === 'json' ? 'application/json' : 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `题库导出_${new Date().toISOString().split('T')[0]}.${exportFormat === 'json' ? 'json' : 'md'}`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success(`已导出 ${result.data.total} 道题目`);
    } catch (error) {
      toast.error('导出失败');
    }
  };

  const handleSelectAll = () => {
    const pageIds = questions?.data.map((question) => question.id) || [];
    setSelectedIds((previous) => allPageSelected
      ? previous.filter((id) => !pageIds.includes(id))
      : Array.from(new Set([...previous, ...pageIds])));
  };

  const handleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const getDifficultyConfig = (difficulty: string) => {
    const configs: Record<string, { label: string; bg: string; text: string; border: string }> = {
      easy: { label: '简单', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
      medium: { label: '中等', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      hard: { label: '困难', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    };
    return configs[difficulty] || configs.medium;
  };

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId) return '未分类';
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || '未知分类';
  };

  if (!canManageQuestions) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <div className="mb-4 inline-flex rounded-2xl bg-gray-50 p-4">
          <BookOpen size={32} className="text-gray-400" />
        </div>
        <p className="text-lg font-medium text-gray-900">暂无题库管理权限</p>
        <p className="mt-2 text-sm text-gray-500">请联系管理员为当前账户分配题目管理权限。</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="flex items-center justify-between gap-3 lg:items-start">
        <div className="flex items-center gap-3">
          <div className="hidden rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 p-3 shadow-lg shadow-purple-500/20 lg:block">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">题库</h1>
            <p className="text-xs text-gray-500 lg:text-sm">共 {questions?.total || 0} 道题目<span className="hidden lg:inline"> · 管理题目、导入内容和标签筛选</span></p>
          </div>
        </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canCheckDuplicates ? (
              <button
                onClick={checkDuplicates}
                className={`${showMobileActions ? 'inline-flex' : 'hidden'} items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 lg:inline-flex lg:px-4`}
              >
                <AlertTriangle size={18} className="text-amber-500" />
                检查重复
              </button>
            ) : null}
            {canGenerateQuestions ? (
              <button
                onClick={() => setShowAIGenerateModal(true)}
                className={`${showMobileActions ? 'inline-flex' : 'hidden'} items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 lg:inline-flex lg:px-4`}
              >
                <Sparkles size={18} className="text-violet-500" />
                AI 生题
              </button>
            ) : null}
            {canImportQuestions ? (
              <button
                onClick={() => setShowImportModal(true)}
                className={`${showMobileActions ? 'inline-flex' : 'hidden'} items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 lg:inline-flex lg:px-4`}
              >
                <Upload size={18} className="text-blue-500" />
                导入题目
              </button>
            ) : null}
            {canExportQuestions ? (
              <><select aria-label="导出格式" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as 'json' | 'markdown')} className={`${showMobileActions ? 'inline-flex' : 'hidden'} rounded-xl border border-gray-200 px-2 text-sm lg:inline-flex`}><option value="json">JSON 完整字段</option><option value="markdown">Markdown 阅读版</option></select><button
                onClick={handleExport}
                className={`${showMobileActions ? 'inline-flex' : 'hidden'} items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 lg:inline-flex lg:px-4`}
              >
                <Download size={18} className="text-emerald-500" />
                导出
              </button></>
            ) : null}
            {canDeleteQuestions ? (
              <button
                onClick={handleClearAll}
                className={`${showMobileActions ? 'inline-flex' : 'hidden'} items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 transition-colors hover:bg-red-100 lg:inline-flex lg:px-4`}
              >
                <Trash2 size={18} className="text-red-500" />
                清空题库
              </button>
            ) : null}
            {canCreateQuestions ? (
              <button
                onClick={() => { setEditingQuestion(null); setShowModal(true); }}
                data-testid="question-add-button"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-2.5 text-sm font-medium text-white transition-all hover:from-violet-600 hover:to-purple-700 lg:gap-2 lg:px-4"
              >
                <Plus size={18} />
                <span className="hidden min-[360px]:inline">添加</span><span className="hidden lg:inline">题目</span>
              </button>
            ) : null}
            <button
              type="button"
              aria-label={showMobileActions ? '收起更多操作' : '展开更多操作'}
              onClick={() => setShowMobileActions((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden"
            >
              {showMobileActions ? <X size={19} /> : <MoreHorizontal size={20} />}
            </button>
          </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                data-testid="question-search-input"
                type="text"
                className="w-full rounded-xl border border-gray-200 bg-white pl-11 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all"
                placeholder="搜索题目内容、答案、解析..."
                value={filter.keyword}
                onChange={(e) => {
                  setPage(1);
                  setFilter({ ...filter, keyword: e.target.value });
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowMobileFilters((value) => !value)}
              className={`inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl border px-3 font-medium lg:hidden ${
                showMobileFilters || filter.tags.length > 0 || filter.categoryId || filter.difficulty
                  ? 'border-purple-200 bg-purple-50 text-purple-700'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
            >
              <Filter size={17} />
              筛选
            </button>
          </div>
          <div className={`${showMobileFilters ? 'grid' : 'hidden'} mt-3 gap-3 lg:grid lg:grid-cols-[1fr_1fr_1fr_auto]`}>
            <div className="relative">
              <Tags className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                    e.preventDefault();
                    addFilterTag(tagInput);
                  }
                }}
                onBlur={() => {
                  if (tagInput.trim()) {
                    addFilterTag(tagInput);
                  }
                }}
                className="w-full rounded-xl border border-gray-200 bg-white pl-11 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                placeholder="标签筛选"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <select
                value={filter.categoryId}
                onChange={(e) => {
                  setPage(1);
                  setFilter({ ...filter, categoryId: e.target.value });
                }}
                className="select-field min-w-0 w-full pl-9 pr-10 py-3 cursor-pointer"
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <select
              value={filter.difficulty}
              onChange={(e) => {
                setPage(1);
                setFilter({ ...filter, difficulty: e.target.value });
              }}
              className="select-field min-w-0 w-full px-4 pr-10 py-3 cursor-pointer"
            >
              <option value="">全部难度</option>
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
            {filter.tags.length > 0 ? (
              <button
                onClick={() => {
                  setPage(1);
                  setFilter((prev) => ({ ...prev, tags: [] }));
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-gray-600 transition-all hover:bg-gray-50"
              >
                清空标签
              </button>
            ) : null}
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex flex-col items-start gap-2 border-b border-purple-100 bg-gradient-to-r from-purple-50 to-violet-50 px-3 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-4">
            <span className="text-sm text-purple-700 font-medium">
              已选择 <span className="font-bold">{selectedIds.length}</span> 道题目
            </span>
            <div className="mobile-scroll-row w-full lg:w-auto lg:flex-wrap lg:items-center lg:justify-end lg:overflow-visible">
              {canBatchEditQuestions ? (
                <>
                  {canAIPolish ? (
                    <button
                      onClick={() => setShowAIBatchTagsModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-violet-700 border border-violet-200 rounded-lg text-sm hover:bg-violet-50 transition-colors"
                    >
                      <Sparkles size={14} />
                      AI批量标签
                    </button>
                  ) : null}
                  <button
                    onClick={() => openBatchTagsModal('add')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    <Tags size={14} />
                    批量加标签
                  </button>
                  <button
                    onClick={() => openBatchTagsModal('remove')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    <Tags size={14} />
                    批量删标签
                  </button>
                  <button
                    onClick={() => openBatchTagsModal('replace')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    <Tags size={14} />
                    批量替换标签
                  </button>
                </>
              ) : null}
              {canDeleteQuestions ? (
                <button
                  onClick={handleBatchDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors"
                >
                  <Trash2 size={14} />
                  批量删除
                </button>
              ) : null}
            </div>
          </div>
        )}

        {loading && !questions ? (
          <div className="animate-pulse space-y-3 p-4" aria-label="题目列表加载中">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="flex items-center gap-4 rounded-xl border border-slate-100 p-4">
                <div className="h-5 w-5 rounded bg-slate-200" />
                <div className="h-10 flex-1 rounded-lg bg-slate-100" />
                <div className="hidden h-8 w-24 rounded-lg bg-slate-100 sm:block" />
              </div>
            ))}
          </div>
        ) : questions?.data.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-gray-500">
            <div className="mb-4 rounded-2xl bg-gray-50 p-4">
              <BookOpen size={32} className="text-gray-400" />
            </div>
            <p className="mb-1 text-lg font-medium text-gray-700">暂无题目</p>
            <p className="mb-4 text-sm text-gray-500">点击上方按钮添加或导入题目</p>
            {canCreateQuestions ? (
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl text-white hover:from-violet-600 hover:to-purple-700 transition-all"
              >
                <Plus size={18} />
                添加题目
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid gap-2.5 p-3 lg:hidden">
              {questions?.data.map((question) => {
                const diffConfig = getDifficultyConfig(question.difficulty);
                const selected = selectedIds.includes(question.id);
                return (
                  <div key={question.id} className={`relative rounded-xl border p-3 transition-all ${selected ? 'border-purple-300 bg-purple-50/40' : 'border-gray-200 bg-white'}`}>
                    <div className="flex items-start gap-2.5">
                      {canSelectQuestions ? (
                        <button
                          aria-label={`${selectedIds.includes(question.id) ? '取消选择' : '选择'}题目：${question.title}`}
                              onClick={() => handleSelect(question.id)}
                          className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            selected ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-300'
                          }`}
                        >
                          {selected && <Check size={14} />}
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1 pr-8">
                        <p className="line-clamp-5 text-[14px] leading-6 text-gray-900">
                          {question.content.substring(0, 220)}
                          {question.content.length > 220 && '...'}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${diffConfig.bg} ${diffConfig.text} ${diffConfig.border}`}>
                            {diffConfig.label}
                          </span>
                          <span className="inline-flex rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                            {getCategoryName(question.category_id)}
                          </span>
                        </div>
                      </div>
                      {hasPermission(user, 'question_view') ? (
                        <button
                          type="button"
                          aria-label="打开题目操作"
                          onClick={() => setOpenMobileQuestionMenuId((current) => current === question.id ? null : question.id)}
                          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
                        >
                          {openMobileQuestionMenuId === question.id ? <X size={18} /> : <MoreHorizontal size={19} />}
                        </button>
                      ) : null}
                      {openMobileQuestionMenuId === question.id ? (
                        <div className="absolute right-2 top-12 z-20 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                          <button onClick={() => { setHistoryQuestion(question); setOpenMobileQuestionMenuId(null); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700">版本历史</button>
                          {canAIPolish ? (
                            <button
                              onClick={() => {
                                openAnswerDraftModal(question);
                                setOpenMobileQuestionMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 active:bg-emerald-50"
                            >
                              <FileText size={15} className="text-emerald-600" />
                              AI答案
                            </button>
                          ) : null}
                          {canAIPolish ? (
                            <button
                              onClick={() => {
                                openPolishModal(question);
                                setOpenMobileQuestionMenuId(null);
                              }}
                              data-testid={`question-polish-${question.id}`}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 active:bg-amber-50"
                            >
                              <Sparkles size={15} className="text-amber-600" />
                              AI润色
                            </button>
                          ) : null}
                          {canEditQuestions ? (
                            <button
                              onClick={() => {
                                setEditingQuestion(question);
                                setShowModal(true);
                                setOpenMobileQuestionMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 active:bg-blue-50"
                            >
                              <Edit size={15} className="text-blue-600" />
                              编辑
                            </button>
                          ) : null}
                          {canDeleteQuestions ? (
                            <button
                              onClick={() => {
                                setOpenMobileQuestionMenuId(null);
                                handleDelete(question.id);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-600 active:bg-red-50"
                            >
                              <Trash2 size={15} />
                              删除
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50/50">
                    {canSelectQuestions ? (
                      <th className="text-left py-4 px-4 w-12">
                        <button
                          aria-label={allPageSelected ? '取消选择本页全部题目' : '选择本页全部题目'}
                          onClick={handleSelectAll}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            allPageSelected
                              ? 'bg-purple-500 border-purple-500 text-white'
                              : 'border-gray-300 hover:border-purple-400'
                          }`}
                        >
                          {allPageSelected && <Check size={14} />}
                        </button>
                      </th>
                    ) : null}
                    <th className="text-left py-4 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      题目内容
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">
                      分类
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">
                      难度
                    </th>
                    <th className="text-left py-4 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-28">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {questions?.data.map((question) => {
                    const diffConfig = getDifficultyConfig(question.difficulty);
                    return (
                      <tr key={question.id} className="transition-colors hover:bg-gray-50/50">
                        {canSelectQuestions ? (
                          <td className="py-4 px-4">
                            <button
                              aria-label={`${selectedIds.includes(question.id) ? '取消选择' : '选择'}题目：${question.title}`}
                              onClick={() => handleSelect(question.id)}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                selectedIds.includes(question.id)
                                  ? 'bg-purple-500 border-purple-500 text-white'
                                  : 'border-gray-300 hover:border-purple-400'
                              }`}
                            >
                              {selectedIds.includes(question.id) && <Check size={14} />}
                            </button>
                          </td>
                        ) : null}
                        <td className="py-4 px-4">
                          <div className="max-w-lg space-y-2">
                            <p className="text-gray-900 font-medium line-clamp-2">
                              {question.content.substring(0, 150)}
                              {question.content.length > 150 && '...'}
                            </p>
                            {parseQuestionTags(question.tags).length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {parseQuestionTags(question.tags).map((tag) => (
                                  <span
                                    key={`${question.id}-${tag}`}
                                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${getTagColorClasses(tag)}`}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-gray-600">{getCategoryName(question.category_id)}</span>
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border ${diffConfig.bg} ${diffConfig.text} ${diffConfig.border}`}>
                            {diffConfig.label}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-1">
                            <button title="版本历史" aria-label={`版本历史：${question.title}`} onClick={() => setHistoryQuestion(question)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg text-xs">历史</button>
                            {canAIPolish ? (
                              <button
                                onClick={() => openAnswerDraftModal(question)}
                                className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="AI答案"
                              >
                                <FileText size={16} />
                              </button>
                            ) : null}
                            {canAIPolish ? (
                              <button
                                onClick={() => openPolishModal(question)}
                                data-testid={`question-polish-${question.id}`}
                                className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                title="AI润色"
                              >
                                <Sparkles size={16} />
                              </button>
                            ) : null}
                            {canEditQuestions ? (
                              <button
                                onClick={() => {
                                  setEditingQuestion(question);
                                  setShowModal(true);
                                }}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              >
                                <Edit size={16} />
                              </button>
                            ) : null}
                            {canDeleteQuestions ? (
                              <button
                                onClick={() => handleDelete(question.id)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="text-sm text-gray-600">
                  共 <span className="font-semibold text-gray-900">{questions?.total}</span> 道题目
                </div>
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="text-sm text-gray-500">每页</span>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="select-field px-3 pr-9 py-1.5 text-gray-700 cursor-pointer"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                  <span className="text-sm text-gray-500">条</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-4 py-2 text-sm text-gray-700 bg-white rounded-lg border border-gray-200">
                  {page} / {questions?.totalPages || 1}
                </span>
                <button
                  disabled={page === questions?.totalPages}
                  onClick={() => setPage(page + 1)}
                  className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <QuestionHistoryModal question={historyQuestion} onClose={() => setHistoryQuestion(null)} onRestored={(question) => { setHistoryQuestion(question); questionListCache.clear(); fetchQuestions(); }} />
      <QuestionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        question={editingQuestion}
        categories={categories}
        availableTags={availableTags}
        canEditContent={canEditQuestionContent}
        canEditMeta={canEditQuestionMeta}
        onSuccess={() => {
          setShowModal(false);
          fetchQuestions();
        }}
      />

      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        categories={categories}
        onSuccess={() => {
          setShowImportModal(false);
          fetchQuestions();
        }}
      />

      <AIGenerateModal
        isOpen={showAIGenerateModal}
        onClose={() => setShowAIGenerateModal(false)}
        categories={categories}
        onSuccess={fetchQuestions}
      />

      <DuplicateModal
        isOpen={showDuplicateModal}
        onClose={() => { setShowDuplicateModal(false); scanSequence.current++; }}
        scanResult={scanResult}
        error={scanError}
        onRetry={checkDuplicates}
        onPageChange={changeScanPage}
        canDelete={canDeleteQuestions}
        canMerge={canDeleteQuestions && canEditQuestions && hasPermission(user, 'question_edit_meta') && hasPermission(user, 'question_edit_content')}
        duplicates={duplicates}
        similarPairs={similarDuplicates}
        onDeleteDuplicate={deleteDuplicate}
        onMergeDuplicate={handleMergeDuplicate}
      />

      <BatchTagsModal
        isOpen={showBatchTagsModal}
        mode={batchTagsMode}
        selectedCount={selectedIds.length}
        availableTags={availableTags}
        onClose={() => setShowBatchTagsModal(false)}
        onSubmit={async (tags) => {
          const response = await questionApi.batchTags({ ids: selectedIds, mode: batchTagsMode, tags });
          toast.success(response.data.message);
          setShowBatchTagsModal(false);
          fetchQuestions();
        }}
      />

      <AIPolishModal
        isOpen={showPolishModal}
        question={polishQuestion}
        onClose={() => {
          setShowPolishModal(false);
          setPolishQuestion(null);
        }}
        onSaved={() => {
          setShowPolishModal(false);
          setPolishQuestion(null);
          fetchQuestions();
        }}
      />

      <AIAnswerDraftModal
        isOpen={showAnswerDraftModal}
        question={answerDraftQuestion}
        availableTags={availableTags}
        onClose={() => {
          setShowAnswerDraftModal(false);
          setAnswerDraftQuestion(null);
        }}
        onSaved={() => {
          setShowAnswerDraftModal(false);
          setAnswerDraftQuestion(null);
          fetchQuestions();
        }}
        introText="只生成答案和解析，可顺手补充标签，不改题干、标题和难度。"
      />

      <AIBatchTagsModal
        isOpen={showAIBatchTagsModal}
        selectedCount={selectedIds.length}
        onClose={() => setShowAIBatchTagsModal(false)}
        onSubmit={async (mode, provider) => {
          const response = await aiApi.batchGenerateTags({
            ids: selectedIds,
            mode,
            provider: provider || undefined,
          });
          toast.success(response.data.message);
          setShowAIBatchTagsModal(false);
          fetchQuestions();
        }}
      />
    </div>
  );
};

interface QuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: Question | null;
  categories: Category[];
  availableTags: Array<{ name: string; count: number }>;
  canEditContent: boolean;
  canEditMeta: boolean;
  onSuccess: () => void;
}

const QuestionModal: React.FC<QuestionModalProps> = ({
  isOpen,
  onClose,
  question,
  categories,
  availableTags,
  canEditContent,
  canEditMeta,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [generatingAnswer, setGeneratingAnswer] = useState(false);
  const [formData, setFormData] = useState({
    content: '',
    answer: '',
    explanation: '',
    difficulty: 'medium',
    categoryId: '',
    tags: '',
  });

  useEffect(() => {
    if (question) {
      setFormData({
        content: question.content,
        answer: question.answer,
        explanation: question.explanation || '',
        difficulty: question.difficulty,
        categoryId: question.category_id || '',
        tags: parseQuestionTags(question.tags).join(', '),
      });
    } else {
      setFormData({
        content: '',
        answer: '',
        explanation: '',
        difficulty: 'medium',
        categoryId: '',
        tags: '',
      });
    }
  }, [question]);

  const matchedTags = getFilteredTagSuggestions(formData.tags, availableTags);

  const handleGenerateAnswer = async () => {
    if (!formData.content.trim()) {
      toast.error('请先填写题目内容');
      return;
    }
    setGeneratingAnswer(true);
    try {
      const clientId = crypto.randomUUID();
      const response = await aiApi.answerDraftsRaw({
        questions: [{
          clientId,
          content: formData.content.trim(),
          difficulty: formData.difficulty as 'easy' | 'medium' | 'hard',
        }],
        mode: 'practice',
      });
      const draft = response.data.drafts[0];
      setFormData((current) => ({
        ...current,
        answer: draft.answer,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
        tags: draft.tags.join(', '),
      }));
      toast.success('AI 答案已生成，请检查后保存');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'AI 生成答案失败');
    } finally {
      setGeneratingAnswer(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (question) {
        const data: Partial<{
          title: string;
          content: string;
          answer: string;
          explanation: string;
          difficulty: string;
          categoryId: string;
          tags: string[];
        }> = {};
        if (canEditContent) {
          data.title = formData.content.substring(0, 100);
          data.content = formData.content;
          data.answer = formData.answer;
          data.explanation = formData.explanation;
        }
        if (canEditMeta) {
          data.difficulty = formData.difficulty;
          data.categoryId = formData.categoryId;
          data.tags = parseQuestionTags(formData.tags);
        }
        await questionApi.update(question.id, {
          ...data, expectedRevision: question.revision });
        toast.success('更新成功');
      } else {
        await questionApi.create({
          title: formData.content.substring(0, 100),
          content: formData.content,
          answer: formData.answer,
          explanation: formData.explanation || undefined,
          difficulty: formData.difficulty,
          categoryId: formData.categoryId || undefined,
          tags: parseQuestionTags(formData.tags),
        });
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
      <div data-testid="question-modal" className="app-modal-panel w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="app-modal-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{question ? '编辑题目' : '添加题目'}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">题目内容（支持Markdown格式）</label>
            <textarea
              data-testid="question-content-input"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all font-mono text-sm"
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              disabled={Boolean(question) && !canEditContent}
              rows={6}
              required
              placeholder="支持Markdown格式，如：**粗体**、`代码`、列表等"
            />
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-700">答案（可选，支持 Markdown）</label>
              {!question ? (
                <button type="button" onClick={handleGenerateAnswer} disabled={generatingAnswer || !formData.content.trim()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-fuchsia-50 px-3 py-2 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-100 disabled:opacity-50">
                  <Sparkles size={15} /> {generatingAnswer ? 'AI 生成中…' : 'AI 生成答案'}
                </button>
              ) : null}
            </div>
            <textarea
              data-testid="question-answer-input"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all font-mono text-sm"
              value={formData.answer}
              onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
              disabled={Boolean(question) && !canEditContent}
              rows={6}
              placeholder="可以留空后保存，也可以先让 AI 生成"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">解析（可选）</label>
            <textarea
              data-testid="question-explanation-input"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all font-mono text-sm"
              value={formData.explanation}
              onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
              disabled={Boolean(question) && !canEditContent}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
              <select
                value={formData.difficulty}
                onChange={(e) => setFormData({ ...formData, difficulty: e.target.value })}
                disabled={Boolean(question) && !canEditMeta}
                className="select-field w-full px-4 pr-10 py-3 text-gray-700 bg-gray-50 focus:bg-white cursor-pointer"
              >
                <option value="easy">简单</option>
                <option value="medium">中等</option>
                <option value="hard">困难</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">分类</label>
              <select
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                disabled={Boolean(question) && !canEditMeta}
                className="select-field w-full px-4 pr-10 py-3 text-gray-700 bg-gray-50 focus:bg-white cursor-pointer"
              >
                <option value="">请选择分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">标签</label>
            <input
              data-testid="question-tags-input"
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              disabled={Boolean(question) && !canEditMeta}
              placeholder="多个标签用逗号分隔，最多 5 个，例如：HTTP, 状态码, 基础"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all"
            />
            {matchedTags.length > 0 && (!question || canEditMeta) ? (
              <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
                <div className="flex flex-wrap gap-2">
                  {matchedTags.map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, tags: applyTagSuggestion(prev.tags, tag.name) }))}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                    >
                      <span>{tag.name}</span>
                      <span className="text-[11px] text-gray-400">{tag.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </form>

        <div className="flex flex-col-reverse justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-4 sm:flex-row sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all sm:w-auto"
          >
            取消
          </button>
          <button
            data-testid="question-save-button"
            onClick={handleSubmit}
            disabled={loading}
            className="min-h-11 w-full px-5 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl text-white hover:from-violet-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
          >
            {loading ? '保存中...' : question ? '更新' : '创建'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

interface DuplicateModalProps {
  scanResult: DuplicateScanResult | null;
  error: string;
  onRetry: () => void;
  onPageChange: (page: number, memberPage?: number) => void;
  canDelete: boolean;
  canMerge: boolean;
  isOpen: boolean;
  onClose: () => void;
  duplicates: Array<{ title: string; count: number; questions: Question[] }>;
  similarPairs: SimilarQuestionPair[];
  onDeleteDuplicate: (keepId: string, deleteIds: string[]) => void;
  onMergeDuplicate: (keepId: string, removeId: string) => void;
}

const DuplicateModal: React.FC<DuplicateModalProps> = ({ isOpen, onClose, duplicates, similarPairs, onDeleteDuplicate, onMergeDuplicate, scanResult, error, onRetry, onPageChange, canDelete, canMerge }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
      <div className="app-modal-panel w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="app-modal-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">重复题目检查</h2>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {error ? <div role="alert" className="text-red-600">{error}<button onClick={onRetry} className="ml-3 underline">重新检查</button></div> : !scanResult || scanResult.status === 'running' ? <p role="status">正在检查整个题库… 已扫描 {scanResult?.processed || 0} / {scanResult?.totalQuestions || 0} 道</p> : <>
          <p className="mb-4 text-sm text-gray-500">已扫描 {scanResult.totalQuestions} 道；同标题 {scanResult.groupTotal} 组，相似题 {scanResult.total} 对。{scanResult.truncated ? `相似结果过多，展示相似度最高的 ${scanResult.available} 对。` : ''}</p>
          {duplicates.length === 0 && similarPairs.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-3 bg-green-100 rounded-lg inline-flex mb-3">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-gray-600">没有发现重复或相似题目</p>
            </div>
          ) : (
            <div className="space-y-4">
              {duplicates.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    本页 <span className="font-semibold text-amber-600">{duplicates.length}</span> 组同标题题目，请核对内容后选择要保留的题目：
                  </p>
                  {duplicates.map((dup, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-gray-900 truncate flex-1">{dup.title}</h4>
                        <span className="ml-2 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">
                          {dup.count} 道重复
                        </span>
                      </div>
                      <p className="mb-2 text-xs text-gray-500">本组共 {dup.count} 道，每页最多显示 20 道；仅处理当前明细页。</p>
                      <div className="space-y-2">
                        {dup.questions.map((q) => (
                          <div key={q.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition-colors">
                            <div className="text-sm text-gray-500">
                              创建时间：{new Date(q.created_at).toLocaleString()}<p className="mt-2 text-gray-700 whitespace-pre-wrap break-words">{q.content}</p>
                            </div>
                            <button
                              disabled={!canDelete}
                              onClick={() => {
                                const deleteIds = dup.questions.filter(p => p.id !== q.id).map(p => p.id);
                                if (window.confirm(`保留此题并删除另外 ${deleteIds.length} 道同标题题目？请先确认题干内容。本操作只删除当前明细页的题目。`)) onDeleteDuplicate(q.id, deleteIds);
                              }}
                              className="px-3 py-1.5 bg-white border border-gray-200 text-primary-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                            >
                              保留此题，删除本页其余
                            </button>
                          </div>
                        ))}
                      </div>
                      {dup.count > 20 ? <div className="flex gap-4 items-center mt-3 text-xs"><button disabled={scanResult.memberPage <= 1} onClick={() => onPageChange(scanResult.page, scanResult.memberPage - 1)}>上一页同标题明细</button><span>{scanResult.memberPage}/{Math.ceil(dup.count / 20)}</span><button disabled={scanResult.memberPage * 20 >= dup.count} onClick={() => onPageChange(scanResult.page, scanResult.memberPage + 1)}>下一页同标题明细</button></div> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {similarPairs.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    本页 <span className="font-semibold text-amber-600">{similarPairs.length}</span> 组相似题目，可手动判断是否删除其中一题：
                  </p>
                  {similarPairs.map((pair, index) => (
                    <div key={`${pair.left.id}-${pair.right.id}-${index}`} className="border border-gray-200 rounded-lg p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 border border-amber-200">
                          综合相似度 {(pair.score * 100).toFixed(0)}%
                        </span>
                        <span>标题 {(pair.titleScore * 100).toFixed(0)}%</span>
                        <span>内容 {(pair.contentScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {[pair.left, pair.right].map((item, itemIndex) => (
                          <div key={item.id} className="rounded-lg bg-gray-50 p-3 border border-gray-200">
                            <div className="mb-2 text-sm font-medium text-gray-900 line-clamp-2">{item.title}</div>
                            <div className="text-sm text-gray-600 line-clamp-4">{item.content}</div>
                            <div className="mt-3 flex justify-end">
                              <div className="flex gap-2">
                                <button
                                  disabled={!canDelete}
                                  onClick={() => { if (window.confirm("确认删除这道题目？")) onDeleteDuplicate(itemIndex === 0 ? pair.right.id : pair.left.id, [item.id]); }}
                                  className="px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
                                >
                                  删除这题
                                </button>
                                <button
                                  disabled={!canMerge}
                                  onClick={() => { if (window.confirm("确认保留此题并合并标签、解析和分类，随后删除另一题？")) onMergeDuplicate(item.id, itemIndex === 0 ? pair.right.id : pair.left.id); }}
                                  className="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 transition-colors"
                                >
                                  保留并合并
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <div className="flex justify-between items-center mt-4 text-sm"><button disabled={scanResult.page <= 1} onClick={() => onPageChange(scanResult.page - 1)}>上一页结果</button><span>{scanResult.page}/{scanResult.totalPages || 1}</span><button disabled={scanResult.page >= scanResult.totalPages} onClick={() => onPageChange(scanResult.page + 1)}>下一页结果</button></div>
          </>}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

interface BatchTagsModalProps {
  isOpen: boolean;
  mode: 'add' | 'remove' | 'replace';
  selectedCount: number;
  availableTags: Array<{ name: string; count: number }>;
  onClose: () => void;
  onSubmit: (tags: string[]) => Promise<void>;
}

const BatchTagsModal: React.FC<BatchTagsModalProps> = ({ isOpen, mode, selectedCount, availableTags, onClose, onSubmit }) => {
  const [tagsInput, setTagsInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTagsInput('');
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const title = mode === 'add' ? '批量添加标签' : mode === 'remove' ? '批量移除标签' : '批量替换标签';
  const helperText = mode === 'add'
    ? '会把这些标签追加到已选题目上'
    : mode === 'remove'
      ? '会从已选题目中移除这些标签'
      : '会用这些标签替换已选题目的原有标签';
  const matchedTags = getFilteredTagSuggestions(tagsInput, availableTags);

  const handleSubmit = async () => {
    const tags = parseQuestionTags(tagsInput);
    if (tags.length === 0) {
      toast.error('请输入有效标签');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(tags);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="app-modal-panel w-full max-w-lg overflow-hidden">
          <div className="app-modal-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <p className="text-sm text-gray-500">已选 {selectedCount} 道题，{helperText}</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          <div className="space-y-4 p-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">标签</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="多个标签用逗号分隔，最多 5 个"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 placeholder-gray-400 transition-all focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              {matchedTags.length > 0 ? (
                <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
                  <div className="flex flex-wrap gap-2">
                    {matchedTags.map((tag) => (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => setTagsInput((current) => applyTagSuggestion(current, tag.name))}
                        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
                      >
                        <span>{tag.name}</span>
                        <span className="text-[11px] text-gray-400">{tag.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-gray-700 transition-all hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-xl bg-primary-600 px-5 py-2.5 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '处理中...' : '确认'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AIPolishModalProps {
  isOpen: boolean;
  question: Question | null;
  onClose: () => void;
  onSaved: () => void;
}

interface AIBatchTagsModalProps {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onSubmit: (mode: 'add' | 'replace', provider?: string) => Promise<void>;
}

const AIBatchTagsModal: React.FC<AIBatchTagsModalProps> = ({ isOpen, selectedCount, onClose, onSubmit }) => {
  const [loading, setLoading] = useState(false);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('ai_provider') || '');
  const [saveMode, setSaveMode] = useState<'add' | 'replace'>('add');

  useEffect(() => {
    if (!isOpen) {
      setSaveMode('add');
      return;
    }

    let active = true;
    setConfigsLoading(true);
    aiApi.getConfigs()
      .then((response) => {
        if (!active) return;
        setAiConfigs(response.data);
        if (!provider) {
          const activeConfig = response.data.find((config) => config.isActive);
          if (activeConfig) {
            setProvider(activeConfig.displayName || activeConfig.provider);
          }
        }
      })
      .catch(() => {
        if (active) {
          setAiConfigs([]);
        }
      })
      .finally(() => {
        if (active) {
          setConfigsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, provider]);

  useEffect(() => {
    if (provider) {
      localStorage.setItem('ai_provider', provider);
    }
  }, [provider]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit(saveMode, provider || undefined);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'AI批量标签失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="app-modal-panel flex w-full max-w-2xl flex-col overflow-hidden">
          <div className="app-modal-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI 批量标签</h2>
              <p className="text-sm text-gray-500">为已选择的 {selectedCount} 道题目批量生成标签并直接写回题库。</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>

          <div className="space-y-5 p-6">
            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">保存方式</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSaveMode('add')}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    saveMode === 'add'
                      ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/10'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900">追加到原标签</div>
                  <div className="mt-1 text-xs leading-5 text-gray-500">保留原有标签，并补充 AI 生成的新标签。</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSaveMode('replace')}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    saveMode === 'replace'
                      ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/10'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900">覆盖为 AI 标签</div>
                  <div className="mt-1 text-xs leading-5 text-gray-500">直接用 AI 标签替换当前标签，适合老题库统一整理。</div>
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">临时模型</div>
              {configsLoading ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  正在加载模型配置...
                </div>
              ) : aiConfigs.length > 0 ? (
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="select-field w-full px-4 py-3 pr-10 bg-white text-gray-700"
                >
                  {aiConfigs.map((config) => {
                    const value = config.displayName || config.provider;
                    return (
                      <option key={config.id} value={value}>
                        {config.displayName || config.provider}
                        {config.isActive ? '（当前默认）' : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  未读取到可用模型，将使用当前默认配置。
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/60 p-4 text-sm leading-6 text-violet-800">
              批量标签会根据题目内容、答案和解析生成更适合检索的知识点标签。批量处理可能需要几十秒，保存后会自动刷新列表。
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-gray-700 transition-all hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '处理中...' : '开始批量生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AIPolishModal: React.FC<AIPolishModalProps> = ({ isOpen, question, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [mode, setMode] = useState<'light' | 'deep'>('light');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [draft, setDraft] = useState<null | {
    title: string;
    content: string;
    answer: string;
    explanation: string;
    difficulty: 'easy' | 'medium' | 'hard';
    tags: string[];
  }>(null);

  useEffect(() => {
    if (!isOpen || !question) {
      setDraft(null);
      setSelectedTags([]);
      setMode('light');
      return;
    }
  }, [isOpen, question]);

  useEffect(() => {
    if (!isOpen || !question) {
      return;
    }
    let active = true;
    setLoading(true);
    setSlowLoading(false);
    const slowTimer = window.setTimeout(() => {
      if (active) {
        setSlowLoading(true);
      }
    }, 15000);
    aiApi.polishQuestion(question.id, mode)
      .then((response) => {
        if (active) {
          setDraft({
            ...response.data.draft,
            answer: formatStructuredDraftText(response.data.draft.answer),
            explanation: formatStructuredDraftText(response.data.draft.explanation),
          });
          setSelectedTags(response.data.draft.tags || []);
        }
      })
      .catch((error: any) => {
        toast.error(error.response?.data?.error || 'AI润色失败');
        onClose();
      })
      .finally(() => {
        if (slowTimer) {
          window.clearTimeout(slowTimer);
        }
        if (active) {
          setLoading(false);
          setSlowLoading(false);
        }
      });

    return () => {
      active = false;
      if (slowTimer) {
        window.clearTimeout(slowTimer);
      }
    };
  }, [isOpen, question, onClose, mode]);

  if (!isOpen || !question) return null;

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await questionApi.update(question.id, {
          source: 'ai-polish',
          expectedRevision: question.revision,
        title: draft.title,
        content: draft.content,
        answer: draft.answer,
        explanation: draft.explanation,
        difficulty: draft.difficulty,
        tags: selectedTags,
      });
      toast.success('AI 润色已保存');
      onSaved();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存润色结果失败');
    } finally {
      setSaving(false);
    }
  };

  const renderPreviewBlock = (title: string, value: string) => (
    <div>
      <div className="mb-2 text-sm font-medium text-gray-700">{title}</div>
      <div
        className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-700 prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(value, 'compact') }}
      />
    </div>
  );

  const renderDraftTextarea = (
    title: string,
    value: string,
    onChange: (nextValue: string) => void,
    rows: number
  ) => (
    <div>
      <div className="mb-2 text-sm font-medium text-gray-700">{title}</div>
      <textarea
        aria-label={title}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15"
      />
    </div>
  );

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => (
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag].slice(0, MAX_QUESTION_TAGS)
    ));
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div data-testid="ai-polish-modal" className="app-modal-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
          <div className="app-modal-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI 润色</h2>
              <p className="text-sm text-gray-500">先预览并编辑润色内容，再决定是否写回当前题目</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          {loading ? (
            <div className="flex h-80 flex-col items-center justify-center gap-4 px-6 text-center">
              <LoadingSpinner size="lg" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-700">AI 正在润色题目</p>
                <p className="text-sm text-gray-500">
                  {slowLoading ? '当前模型返回较慢，通常还在生成中，请再等待一会。' : '通常需要十几秒到几十秒。'}
                </p>
              </div>
            </div>
          ) : draft ? (
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-2">
              <div className="min-h-0 space-y-4 overflow-y-auto border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
                <h3 className="text-sm font-semibold text-gray-900">原题</h3>
                {renderPreviewBlock('题目内容', question.content)}
                {renderPreviewBlock('答案', question.answer)}
                {question.explanation ? renderPreviewBlock('解析', question.explanation) : null}
              </div>
              <div className="min-h-0 space-y-4 overflow-y-auto p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">润色</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-xl border border-gray-200 bg-white p-1">
                      {([
                        { value: 'light', label: '轻润色' },
                        { value: 'deep', label: '深润色' },
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMode(option.value)}
                          disabled={loading}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            mode === option.value
                              ? 'bg-primary-600 text-white'
                              : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <span className="inline-flex rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600">{draft.difficulty}</span>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium text-gray-700">标签建议</div>
                  {draft.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-3">
                      {draft.tags.map((tag) => {
                        const active = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                              active
                                ? 'border-violet-300 bg-violet-50 text-violet-700'
                                : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white'
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-sm text-gray-500">
                      当前润色结果没有标签建议。
                    </div>
                  )}
                </div>
                {renderDraftTextarea('题目内容', draft.content, (content) => setDraft((current) => (current ? { ...current, content } : current)), 4)}
                {renderDraftTextarea('答案', draft.answer, (answer) => setDraft((current) => (current ? { ...current, answer } : current)), 6)}
                {renderDraftTextarea('解析', draft.explanation || '', (explanation) => setDraft((current) => (current ? { ...current, explanation } : current)), 8)}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-gray-700 transition-all hover:bg-gray-50">
              取消
            </button>
            <button
              data-testid="ai-polish-save-button"
              onClick={handleSave}
              disabled={!draft || loading || saving}
              className="rounded-xl bg-primary-600 px-5 py-2.5 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '确认保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AIGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onSuccess: () => void;
}

type GeneratedQuestion = {
  title: string;
  content: string;
  answer: string;
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];
};

const batchGenerateModes = [
  {
    value: 'quick' as const,
    label: '速记版',
  },
  {
    value: 'practice' as const,
    label: '练习版',
  },
  {
    value: 'teaching' as const,
    label: '教学版',
  },
];

const AIGenerateModal: React.FC<AIGenerateModalProps> = ({ isOpen, onClose, categories, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);
  const [rawResult, setRawResult] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [modelOptions, setModelOptions] = useState<AIModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [formData, setFormData] = useState({
    topic: '',
    count: 10,
    difficulty: 'mixed' as 'easy' | 'medium' | 'hard' | 'mixed',
    mode: 'practice' as 'quick' | 'practice' | 'teaching',
    categoryId: '',
    requirements: '',
    provider: '',
  });

  const categoryName = categories.find((category) => category.id === formData.categoryId)?.name || '';

  useEffect(() => {
    if (!isOpen) return;
    setModelsLoading(true);
    aiApi.getStatus()
      .then((response) => {
        const models = response.data.availableModels?.length
          ? response.data.availableModels
          : [response.data.defaultProvider].filter(Boolean).map((name) => ({
              id: name,
              label: name,
              provider: name,
              model: '',
              isActive: true,
            }));
        setModelOptions(models);
        setFormData((current) => ({
          ...current,
          provider: response.data.defaultConfigId
            || models.find((model) => model.isActive)?.id
            || models[0]?.id
            || response.data.defaultProvider,
        }));
      })
      .catch((error) => {
        console.error('Failed to fetch AI models:', error);
        setModelOptions([]);
      })
      .finally(() => setModelsLoading(false));
  }, [isOpen]);

  const toImportPayload = (question: GeneratedQuestion) => ({
    title: question.title,
    content: question.content,
    answer: question.answer,
    explanation: question.explanation || '',
    difficulty: question.difficulty || 'medium',
    tags: (question.tags || []).slice(0, MAX_QUESTION_TAGS),
  });

  const handleGenerate = async () => {
    if (!formData.topic.trim()) {
      toast.error('请输入出题主题');
      return;
    }

    setLoading(true);
    setGeneratedQuestions([]);
    setRawResult('');
    try {
      const response = await aiApi.batchGenerate({
        topic: formData.topic,
        count: formData.count,
        difficulty: formData.difficulty,
        mode: formData.mode,
        requirements: formData.requirements || undefined,
        provider: formData.provider || undefined,
        categoryName: categoryName || undefined,
      });

      setGeneratedQuestions(response.data.questions);
      setRawResult(response.data.raw);
      toast.success(`已生成 ${response.data.questions.length} 道题目`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'AI生题失败');
    } finally {
      setLoading(false);
    }
  };

  const handleImportGenerated = async () => {
    if (generatedQuestions.length === 0) {
      toast.error('没有可导入的题目');
      return;
    }

    setImporting(true);
    try {
      const response = await importApi.importText(
        generatedQuestions.map(toImportPayload),
        formData.categoryId || undefined
      );

      toast.success(`成功导入 ${response.data.success} 道题目`);
      onSuccess();
      handleClose();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleImportSingle = async (question: GeneratedQuestion, index: number) => {
    setImportingIndex(index);
    try {
      const response = await importApi.importText(
        [toImportPayload(question)],
        formData.categoryId || undefined
      );

      toast.success(`成功导入 ${response.data.success} 道题目`);
      setGeneratedQuestions((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.error || '导入失败');
    } finally {
      setImportingIndex(null);
    }
  };

  const handleClose = () => {
    setGeneratedQuestions([]);
    setRawResult('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-transparent" onClick={handleClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
      <div className="app-modal-panel w-full max-w-5xl h-[92vh] overflow-hidden">
        <div className="app-modal-header flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-600 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI 批量生题</h2>
              <p className="text-sm text-gray-500">直接在系统内生成、预览并导入题目</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-0 lg:grid-cols-[360px_minmax(0,1fr)] h-[calc(92vh-76px)] min-h-0">
          <div className="border-b lg:border-b-0 lg:border-r border-gray-100 p-5 space-y-4 overflow-y-auto min-h-0">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">出题主题</label>
              <input
                type="text"
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                placeholder="例如：Python 装饰器、考研政治马原、驾考交规"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">数量</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={formData.count}
                  onChange={(e) => setFormData({ ...formData, count: Number(e.target.value) || 1 })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">难度</label>
                <select
                  value={formData.difficulty}
                  onChange={(e) => setFormData({ ...formData, difficulty: e.target.value as 'easy' | 'medium' | 'hard' | 'mixed' })}
                  className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
                >
                  <option value="mixed">混合难度</option>
                  <option value="easy">简单</option>
                  <option value="medium">中等</option>
                  <option value="hard">困难</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">生题模型</label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                disabled={modelsLoading || modelOptions.length === 0}
                className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelOptions.length === 0 ? (
                  <option value="">{modelsLoading ? '正在读取模型…' : '暂无可用模型'}</option>
                ) : modelOptions.map((modelOption) => (
                  <option key={modelOption.id} value={modelOption.id}>
                    {modelOption.label}{modelOption.isActive ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">生成模式</label>
              <div className="grid grid-cols-3 gap-2">
                {batchGenerateModes.map((modeOption) => {
                  const active = formData.mode === modeOption.value;
                  return (
                    <button
                      key={modeOption.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, mode: modeOption.value })}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        active
                          ? 'border-primary-500 bg-primary-50 shadow-sm ring-2 ring-primary-500/10'
                          : 'border-gray-200 bg-white/90 hover:border-gray-300 hover:bg-white'
                      }`}
                    >
                      <div className="flex min-h-[20px] items-center justify-center">
                        <span className={`text-sm font-medium ${active ? 'text-primary-700' : 'text-gray-900'}`}>
                          {modeOption.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">导入分类</label>
              <select
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="select-field w-full px-4 pr-10 py-3 bg-gray-50 text-gray-700 focus:bg-white cursor-pointer"
              >
                <option value="">不指定分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">额外要求</label>
              <textarea
                rows={5}
                value={formData.requirements}
                onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                placeholder="例如：更偏选择题；覆盖高频考点；题干更短；适合初学者；补充易错点"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 rounded-lg text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                <Sparkles size={18} />
                {loading ? '生成中...' : '开始生题'}
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-3 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
              >
                关闭
              </button>
            </div>

            {loading ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                AI 批量生题可能需要 1 到 3 分钟，请耐心等待，页面会在生成完成后自动展示结果。
              </div>
            ) : null}
          </div>

          <div className="p-5 overflow-y-auto bg-gray-50/40 min-h-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">生成预览</h3>
                <p className="text-sm text-gray-500">先检查题目质量，再决定是否导入。</p>
              </div>
              <button
                onClick={handleImportGenerated}
                disabled={importing || generatedQuestions.length === 0}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50"
              >
                <Download size={16} />
                {importing ? '导入中...' : `导入 ${generatedQuestions.length || 0} 道题`}
              </button>
            </div>

            {generatedQuestions.length === 0 ? (
              <div className="h-full min-h-[320px] rounded-2xl border border-dashed border-gray-200 bg-white flex items-center justify-center p-8 text-center text-gray-500">
                输入主题后开始生题。建议一次生成 5 到 10 道，先看质量，再继续扩充题库。
              </div>
            ) : (
              <div className="space-y-3">
                {generatedQuestions.map((question, index) => (
                  <div key={`${question.title}-${index}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
                          第 {index + 1} 题
                        </span>
                        <span className="inline-flex px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                          {question.difficulty || 'medium'}
                        </span>
                        {(question.tags || []).slice(0, 4).map((tag) => (
                          <span key={tag} className="inline-flex px-2 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleImportSingle(question, index)}
                        disabled={importing || importingIndex !== null}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-xl hover:bg-emerald-50 transition-all disabled:opacity-50"
                      >
                        <Download size={15} />
                        {importingIndex === index ? '导入中...' : '导入此题'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">题目</p>
                        <div
                          className="prose prose-sm max-w-none text-sm leading-6 text-gray-900"
                          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.content, 'compact') }}
                        />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">答案</p>
                        <div
                          className="prose prose-sm max-w-none text-sm leading-6 text-emerald-700"
                          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.answer, 'compact') }}
                        />
                      </div>
                      {question.explanation ? (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">解析</p>
                          <div
                            className="prose prose-sm max-w-none text-sm leading-6 text-gray-600"
                            dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.explanation, 'compact') }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}

                <details className="rounded-2xl border border-gray-200 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">查看原始 AI 返回内容</summary>
                  <pre className="mt-3 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto">{rawResult}</pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
