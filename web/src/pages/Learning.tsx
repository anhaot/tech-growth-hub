import React, { useState, useEffect, useCallback, useRef } from 'react';
import { questionApi, categoryApi } from '@/api';
import { Question, Category, LearningProgress } from '@/types';
import { useAIStore, useAuthStore } from '@/store';
import { hasPermission } from '@/lib/permissions';
import { getTagColorClasses } from '@/lib/tagColors';
import { parseQuestionTags } from '@/lib/questionTags';
import { renderSafeMarkdown } from '@/lib/renderMarkdown';
import { applyTagSuggestion, getFilteredTagSuggestions } from '@/lib/tagSuggestions';
import { toast } from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  Shuffle,
  Bookmark,
  BookmarkCheck,
  Brain,
  Sparkles,
  BookOpen,
  Eye,
  Filter,
  Edit,
  X,
  MapPin,
  Tags,
  MoreHorizontal,
} from 'lucide-react';
import AIAssistant from '@/components/AIAssistant';
import QuestionHistoryModal from '@/components/QuestionHistoryModal';

interface LearningPageProps {
  mode: 'study' | 'quiz';
}

export const LearningPage: React.FC<LearningPageProps> = ({ mode }) => {
  const { enabled: aiEnabled } = useAIStore();
  const { user } = useAuthStore();
  const canEditQuestionContent = hasPermission(user, 'question_edit_content');
  const canEditQuestionMeta = hasPermission(user, 'question_edit_meta');
  const canManageQuestions = canEditQuestionContent || canEditQuestionMeta;
  const canUseAI = hasPermission(user, 'ai_use');
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [pageStart, setPageStart] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestSequence = useRef(0);
  const navigationBusy = useRef(false);
  const PAGE_SIZE = 100;
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableTags, setAvailableTags] = useState<Array<{ name: string; count: number }>>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpPosition, setJumpPosition] = useState('1');
  const progressSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showAI, setShowAI] = useState(false);
  const [showMobileQuestionActions, setShowMobileQuestionActions] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const learningPageRef = useRef<HTMLDivElement>(null);
  const questionCardRef = useRef<HTMLDivElement>(null);
  const resetScrollAfterNavigationRef = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    content: '',
    answer: '',
    explanation: '',
    difficulty: 'medium' as 'easy' | 'medium' | 'hard',
    categoryId: '',
    tags: '',
  });

  const modeLabel = mode === 'study' ? '背题模式' : '答题模式';
  const modeIcon = mode === 'study' ? BookOpen : Brain;
  const autoShowAnswer = mode === 'study';

  const fetchQuestions = useCallback(async (restorePosition = true) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setInitialized(false);
    progressSequence.current++;
    setFetchError('');
    try {
      let index = 0;
      if (restorePosition) {
        const lastViewed = await questionApi.getLastViewed(mode, categoryId).catch(() => null);
        if (lastViewed?.data?.question_id) {
          const position = await questionApi.getPosition(lastViewed.data.question_id, { categoryId, tags: selectedTags }).catch(() => null);
          index = position?.data.index ?? 0;
        }
      }
      const response = await questionApi.getAll({ page: Math.floor(index / PAGE_SIZE) + 1, pageSize: PAGE_SIZE, categoryId, tags: selectedTags });
      if (sequence !== requestSequence.current) return;
      setQuestions(response.data.data);
      setTotalQuestions(response.data.total);
      setPageStart(Math.floor(index / PAGE_SIZE) * PAGE_SIZE);
      setCurrentIndex(index);
      setShowAnswer(autoShowAnswer);
      setProgress(null);
    } catch (error: any) {
      if (sequence !== requestSequence.current) return;
      const message = error.response?.data?.error || '无法连接题库服务，请稍后重试';
      setQuestions([]);
      setTotalQuestions(0);
      setFetchError(message);
      toast.error(`获取题目失败：${message}`);
    } finally {
      if (sequence === requestSequence.current) { setLoading(false); setInitialized(true); }
    }
  }, [categoryId, autoShowAnswer, mode, selectedTags]);

  const fetchTags = useCallback(async () => {
    try {
      const response = await questionApi.getTags({
        categoryId: categoryId || undefined,
      });
      setAvailableTags(response.data);
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  }, [categoryId]);

  const fetchCategories = async () => {
    try {
      const response = await categoryApi.getAll();
      setCategories(response.data);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const saveViewProgress = async (questionId: string) => {
    const sequence = ++progressSequence.current;
    try {
      const response = await questionApi.saveProgress(questionId, { mode });
      if (sequence === progressSequence.current) setProgress(response.data);
    } catch (error) { console.error('Failed to save view progress:', error); }
  };

  const saveProgress = async (isBookmarked: boolean) => {
    if (!currentQuestion) return;

    try {
      const sequence = ++progressSequence.current;
      const response = await questionApi.saveProgress(currentQuestion.id, { mode, isBookmarked });
      if (sequence === progressSequence.current) setProgress(response.data);
      toast.success(isBookmarked ? '已收藏' : '已取消收藏');
    } catch (error) {
      toast.error('操作失败');
    }
  };

  const startEdit = () => {
    if (currentQuestion) {
      setEditForm({
        title: currentQuestion.title,
        content: currentQuestion.content,
        answer: currentQuestion.answer,
        explanation: currentQuestion.explanation || '',
        difficulty: currentQuestion.difficulty,
        categoryId: currentQuestion.category_id || '',
        tags: parseQuestionTags(currentQuestion.tags).join(', '),
      });
      setIsEditing(true);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const saveEdit = async () => {
    if (!currentQuestion) return;

    try {
      const response = await questionApi.update(currentQuestion.id, {
        expectedRevision: currentQuestion.revision,
        ...(canEditQuestionContent ? {
          title: editForm.title,
          content: editForm.content,
          answer: editForm.answer,
          explanation: editForm.explanation,
        } : {}),
        ...(canEditQuestionMeta ? {
          difficulty: editForm.difficulty,
          categoryId: editForm.categoryId,
          tags: parseQuestionTags(editForm.tags),
        } : {}),
      });
      
      setQuestions(prev => prev.map(q => q.id === currentQuestion.id ? response.data : q));
      
      setIsEditing(false);
      toast.success('保存成功');
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存失败');
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  useEffect(() => {
    if (totalQuestions > 0 && questions[currentIndex - pageStart] && initialized) {
      saveViewProgress(questions[currentIndex - pageStart].id);
      setShowAnswer(autoShowAnswer);
    }
  }, [questions, currentIndex, pageStart, autoShowAnswer, initialized, mode]);

  useEffect(() => {
    if (!resetScrollAfterNavigationRef.current) return;
    resetScrollAfterNavigationRef.current = false;

    const frame = window.requestAnimationFrame(() => {
      questionCardRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex]);

  useEffect(() => { setJumpPosition(String(currentIndex + 1)); }, [currentIndex]);

  const currentQuestion = questions[currentIndex - pageStart];
  const currentQuestionTags = currentQuestion ? parseQuestionTags(currentQuestion.tags) : [];
  const matchedEditTags = getFilteredTagSuggestions(editForm.tags, availableTags);
  const browsePositionPercent = totalQuestions > 0
    ? Math.round(((currentIndex + 1) / totalQuestions) * 100)
    : 0;
  const ModeIcon = modeIcon;
  const navigateToIndex = async (nextIndex: number) => {
    if (navigationBusy.current || loading) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, totalQuestions - 1));
    if (boundedIndex === currentIndex) return;
    navigationBusy.current = true;
    progressSequence.current++;
    const sequence = requestSequence.current;
    try {
      if (boundedIndex < pageStart || boundedIndex >= pageStart + questions.length) {
        setLoading(true);
        const response = await questionApi.getAll({ page: Math.floor(boundedIndex / PAGE_SIZE) + 1, pageSize: PAGE_SIZE, categoryId, tags: selectedTags });
        if (sequence !== requestSequence.current) return;
        if (!response.data.data.length) { await fetchQuestions(false); return; }
        setQuestions(response.data.data);
        setTotalQuestions(response.data.total);
        setPageStart(Math.floor(boundedIndex / PAGE_SIZE) * PAGE_SIZE);
      }
      resetScrollAfterNavigationRef.current = true;
      setShowMobileQuestionActions(false);
      setProgress(null);
      setCurrentIndex(boundedIndex);
    } catch { toast.error('加载题目失败，请重试'); }
    finally { navigationBusy.current = false; if (sequence === requestSequence.current) setLoading(false); }
  };

  const jumpToQuestion = () => {
    const position = Number(jumpPosition);
    if (!Number.isInteger(position) || position < 1 || position > totalQuestions) { toast.error(`请输入 1 到 ${totalQuestions} 的题号`); return; }
    void navigateToIndex(position - 1);
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      navigateToIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      navigateToIndex(currentIndex + 1);
    }
  };

  const handleRandom = () => {
    if (totalQuestions <= 1) return;
    let randomIndex = currentIndex;
    while (randomIndex === currentIndex) {
      randomIndex = Math.floor(Math.random() * totalQuestions);
    }
    navigateToIndex(randomIndex);
  };

  useEffect(() => {
    const mobileMain = learningPageRef.current?.closest('main');
    if (!mobileMain) return;

    const isInteractiveTarget = (target: EventTarget | null) => (
      target instanceof Element
      && Boolean(target.closest(
        'button, input, select, textarea, a, pre, [contenteditable="true"], [role="dialog"], [role="slider"]'
      ))
    );

    const handleSwipeStart = (event: TouchEvent) => {
      if (
        !window.matchMedia('(max-width: 1023px)').matches
        || isEditing
        || event.touches.length !== 1
        || isInteractiveTarget(event.target)
      ) {
        swipeStartRef.current = null;
        return;
      }

      const touch = event.touches[0];
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleSwipeEnd = (event: TouchEvent) => {
      const start = swipeStartRef.current;
      const touch = event.changedTouches[0];
      swipeStartRef.current = null;
      if (!start || !touch || isEditing) return;

      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;

      if (deltaX < 0) {
        handleNext();
      } else {
        handlePrev();
      }
    };

    const resetSwipe = () => {
      swipeStartRef.current = null;
    };

    mobileMain.addEventListener('touchstart', handleSwipeStart, { passive: true });
    mobileMain.addEventListener('touchend', handleSwipeEnd, { passive: true });
    mobileMain.addEventListener('touchcancel', resetSwipe, { passive: true });

    return () => {
      mobileMain.removeEventListener('touchstart', handleSwipeStart);
      mobileMain.removeEventListener('touchend', handleSwipeEnd);
      mobileMain.removeEventListener('touchcancel', resetSwipe);
    };
  }, [currentIndex, isEditing, totalQuestions]);

  const getDifficultyConfig = (difficulty: string) => {
    const configs: Record<string, { label: string; bg: string; text: string; border: string }> = {
      easy: { label: '简单', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
      medium: { label: '中等', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
      hard: { label: '困难', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    };
    return configs[difficulty] || configs.medium;
  };

  const addFilterTag = (value: string) => {
    const nextTag = value.trim();
    if (!nextTag || selectedTags.includes(nextTag)) {
      setTagInput('');
      return;
    }
    setSelectedTags((prev) => [...prev, nextTag]);
    setTagInput('');
  };

  const applyQuestionTagFilter = (tag: string) => {
    setSelectedTags((prev) => (prev.length === 1 && prev[0] === tag ? [] : [tag]));
    setTagInput('');
  };

  const mobileQuestionToolbar = (
    <div
      aria-label="学习题目操作"
      className="surface-card relative z-20 overflow-visible lg:hidden"
      data-testid="learning-mobile-toolbar"
    >
      <div className="flex min-h-11 items-center gap-1 px-2">
        <select
          aria-label="筛选题目分类"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="select-field h-8 min-w-0 flex-1 cursor-pointer border-0 bg-slate-50 py-0 pl-2 pr-6 text-xs font-medium text-slate-700 shadow-none"
        >
          <option value="">全部题目</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>

        <div className="flex shrink-0 items-center overflow-hidden rounded-lg bg-slate-50">
          <button
            type="button"
            aria-label="上一题"
            onClick={handlePrev}
            disabled={currentIndex === 0 || totalQuestions === 0}
            className="flex h-8 w-7 items-center justify-center text-slate-600 disabled:opacity-30"
          >
            <ChevronLeft size={17} />
          </button>
          <span className={`min-w-[2.8rem] text-center text-[11px] font-semibold ${mode === 'study' ? 'text-emerald-700' : 'text-blue-700'}`}>
            {totalQuestions > 0 ? currentIndex + 1 : 0}/{totalQuestions}
          </span>
          <button
            type="button"
            aria-label="下一题"
            onClick={handleNext}
            disabled={currentIndex >= totalQuestions - 1 || totalQuestions === 0}
            className="flex h-8 w-7 items-center justify-center text-slate-600 disabled:opacity-30"
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <button
          type="button"
          aria-label={progress?.is_bookmarked ? '取消收藏当前题目' : '收藏当前题目'}
          onClick={() => saveProgress(!progress?.is_bookmarked)}
          disabled={!currentQuestion}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-30 ${
            progress?.is_bookmarked
              ? 'bg-amber-50 text-amber-600'
              : 'text-slate-400 active:bg-slate-100'
          }`}
        >
          {progress?.is_bookmarked ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
        </button>

        {aiEnabled && canUseAI ? (
          <button
            type="button"
            aria-label={showAI ? '收起 AI 助手' : '打开 AI 助手'}
            onClick={() => setShowAI((value) => !value)}
            disabled={!currentQuestion}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-30 ${
              showAI ? 'bg-violet-50 text-violet-600' : 'text-slate-400 active:bg-violet-50'
            }`}
          >
            <Sparkles size={18} />
          </button>
        ) : null}

        {mode === 'study' || canManageQuestions ? (
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={showMobileQuestionActions ? '收起题目操作' : '更多题目操作'}
              onClick={() => setShowMobileQuestionActions((value) => !value)}
              disabled={!currentQuestion}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100 disabled:opacity-30"
            >
              {showMobileQuestionActions ? <X size={17} /> : <MoreHorizontal size={18} />}
            </button>
            {showMobileQuestionActions ? (
              <div className="absolute bottom-9 right-0 z-30 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                {mode === 'study' ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleRandom();
                      setShowMobileQuestionActions(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 active:bg-emerald-50"
                  >
                    <Shuffle size={15} className="text-emerald-600" />
                    随机一题
                  </button>
                ) : null}
                {canManageQuestions ? (
                  <button
                    type="button"
                    onClick={() => {
                      startEdit();
                      setShowMobileQuestionActions(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 active:bg-blue-50"
                  >
                    <Edit size={15} className="text-blue-500" />
                    编辑题目
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="h-0.5 bg-slate-100">
        <div
          className={`h-full ${mode === 'study' ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${browsePositionPercent}%` }}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="page-shell animate-pulse" aria-label={`${modeLabel}加载中`}>
        <div className="h-11 rounded-xl border border-slate-200 bg-white lg:hidden" />
        <div className="page-header hidden flex-col gap-5 lg:flex xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-3 text-white ${mode === 'study' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              <ModeIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{modeLabel}</h1>
              <div className="mt-2 h-4 w-64 max-w-full rounded bg-slate-200" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:w-[500px]">
            <div className="h-12 rounded-xl bg-slate-200" />
            <div className="h-12 rounded-xl bg-slate-200" />
          </div>
        </div>
        <div className="hidden h-20 rounded-2xl border border-slate-100 bg-white lg:block" />
        <div className="h-96 rounded-2xl border border-slate-100 bg-white" />
      </div>
    );
  }

  return (
    <div
      ref={learningPageRef}
      className="learning-mobile-swipe-region page-shell touch-pan-y"
      data-testid="learning-swipe-region"
    >
      <div className="page-header hidden items-center justify-between gap-5 lg:flex">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
              <div className={`rounded-xl p-3 text-white ${mode === 'study' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
                <ModeIcon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{modeLabel}</h1>
                <p className="mt-1 text-sm text-slate-500">{mode === 'study' ? '题目与答案同屏展示' : '先思考，再查看答案'}</p>
              </div>
          </div>
        </div>
          <div className="grid w-[500px] grid-cols-2 gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="select-field min-w-0 w-full pl-9 pr-10 py-3 cursor-pointer"
              >
                <option value="">全部分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="relative min-w-0">
              <Tags className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
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
                  if (tagInput.trim()) addFilterTag(tagInput);
                }}
                placeholder="按标签学习"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-4 text-slate-700 shadow-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              />
            </div>
          </div>
      </div>

      {currentQuestion ? <div className="flex justify-between items-center gap-2"><div className="flex items-center gap-2 lg:hidden"><input type="number" min={1} max={totalQuestions} value={jumpPosition} aria-label="跳转题号" onChange={(event) => setJumpPosition(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') jumpToQuestion(); }} className="input-field w-20" /><span className="text-sm">/{totalQuestions}</span><button className="text-sm text-primary-600" onClick={jumpToQuestion}>跳转</button></div><button className="text-sm text-primary-600 px-3 py-2" onClick={() => setHistoryOpen(true)}>版本历史</button></div> : null}
      <QuestionHistoryModal question={historyOpen ? currentQuestion : null} onClose={() => setHistoryOpen(false)} onRestored={(question) => { setQuestions((items) => items.map((item) => item.id === question.id ? question : item)); }} />
      {fetchError ? (
        <div className="surface-card flex min-h-64 flex-col items-center justify-center p-8 text-center">
          <div className="mb-4 rounded-2xl bg-rose-50 p-4">
            <BookOpen size={32} className="text-rose-500" />
          </div>
          <p className="text-lg font-medium text-slate-900">题库暂时加载失败</p>
          <p className="mt-2 max-w-md text-sm text-slate-500">{fetchError}</p>
          <button
            type="button"
            onClick={() => fetchQuestions()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            重新加载
          </button>
        </div>
      ) : totalQuestions === 0 ? (
        <div className="h-64 bg-white rounded-2xl border border-gray-100 flex flex-col items-center justify-center text-gray-500">
          <div className="mb-4 rounded-2xl bg-gray-50 p-4">
            <BookOpen size={32} className="text-gray-400" />
          </div>
          <p className="mb-1 text-lg font-medium text-gray-700">暂无题目</p>
          <p className="text-sm text-gray-500">请先在题库管理中添加题目</p>
        </div>
      ) : (
        <>
          <div className="surface-card hidden p-4 lg:flex lg:items-center lg:justify-between lg:gap-3">
            <div className="flex items-center justify-between gap-3 lg:justify-start">
              <div className="flex items-center gap-1.5 border-gray-200 bg-white lg:rounded-xl lg:border lg:px-4 lg:py-2 lg:shadow-sm">
                <span className="text-sm text-gray-500">题目</span>
                <input
                  type="number"
                  min={1}
                  max={totalQuestions}
                  value={jumpPosition}
                  aria-label="跳转题号"
                  onChange={(e) => setJumpPosition(e.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') jumpToQuestion(); }}
                  className="w-20 border-0 bg-transparent text-center text-base font-bold text-gray-900 focus:outline-none focus:ring-0 lg:w-20 lg:text-lg"
                />
                <span className="text-sm text-gray-400">/ {totalQuestions}</span>
                <button className="text-sm text-primary-600" onClick={jumpToQuestion}>跳转</button>
              </div>
              <div className="hidden items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-sm lg:flex">
                <Eye size={16} className="text-gray-400" />
                <span className="text-sm text-gray-600">已查看 {progress?.view_count || 0} 次</span>
              </div>
              <div className="hidden items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-sm lg:flex">
                <MapPin size={16} className="text-blue-500" />
                <span className="text-sm text-gray-600">浏览位置 {browsePositionPercent}%</span>
              </div>
              <span className="text-xs font-semibold text-blue-600 lg:hidden">{browsePositionPercent}%</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 lg:gap-3 lg:items-end">
              {currentQuestionTags.length > 0 ? (
                <div className="mobile-scroll-row lg:flex lg:flex-wrap lg:justify-end lg:overflow-visible">
                  {currentQuestionTags.map((tag) => (
                    <button
                      key={`${currentQuestion?.id}-${tag}`}
                      onClick={() => applyQuestionTagFilter(tag)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all lg:px-3 lg:py-1.5 lg:text-xs ${getTagColorClasses(tag)} ${
                        selectedTags.includes(tag)
                          ? 'ring-2 ring-primary-300 shadow-sm scale-[1.02]'
                          : 'opacity-80 hover:opacity-100 hover:brightness-95'
                      }`}
                      title={selectedTags.includes(tag) ? '再次点击取消该标签筛选' : '点击按该标签筛选'}
                    >
                      {selectedTags.includes(tag) ? (
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/80 text-[10px] text-primary-700">
                          ✓
                        </span>
                      ) : null}
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 lg:h-2 lg:w-48">
                <div
                  aria-label="当前浏览位置"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={browsePositionPercent}
                  className={`h-full rounded-full transition-all duration-300 ${mode === 'study' ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                  role="progressbar"
                  style={{ width: `${browsePositionPercent}%` }}
                />
              </div>
            </div>
          </div>

          <div
            ref={questionCardRef}
            className="surface-card touch-pan-y scroll-mt-[4.25rem] overflow-hidden"
            data-testid="learning-question-card"
          >
            {isEditing ? (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">编辑题目</h3>
                  <button
                    aria-label="关闭题目编辑"
                    onClick={cancelEdit}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">题目内容</label>
                  <textarea
                    value={editForm.content}
                    onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                    disabled={!canEditQuestionContent}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all resize-none"
                    rows={4}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">答案</label>
                  <textarea
                    value={editForm.answer}
                    onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
                    disabled={!canEditQuestionContent}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all resize-none"
                    rows={4}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">解析（可选）</label>
                  <textarea
                    value={editForm.explanation}
                    onChange={(e) => setEditForm({ ...editForm, explanation: e.target.value })}
                    disabled={!canEditQuestionContent}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all resize-none"
                    rows={3}
                  />
                </div>
                
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">难度</label>
                    <select
                      value={editForm.difficulty}
                      onChange={(e) => setEditForm({ ...editForm, difficulty: e.target.value as 'easy' | 'medium' | 'hard' })}
                      disabled={!canEditQuestionMeta}
                      className="select-field w-full px-4 pr-10 py-2.5 text-gray-900 bg-gray-50 focus:bg-white"
                    >
                      <option value="easy">简单</option>
                      <option value="medium">中等</option>
                      <option value="hard">困难</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                    <select
                      value={editForm.categoryId}
                      onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}
                      disabled={!canEditQuestionMeta}
                      className="select-field w-full px-4 pr-10 py-2.5 text-gray-900 bg-gray-50 focus:bg-white"
                    >
                      <option value="">无分类</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
                  <input
                    value={editForm.tags}
                    onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                    disabled={!canEditQuestionMeta}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white transition-all"
                    placeholder="多个标签用逗号分隔，最多 5 个"
                  />
                  {matchedEditTags.length > 0 && canEditQuestionMeta ? (
                    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2">
                      <div className="flex flex-wrap gap-2">
                        {matchedEditTags.map((tag) => (
                          <button
                            key={tag.name}
                            type="button"
                            onClick={() => setEditForm((prev) => ({ ...prev, tags: applyTagSuggestion(prev.tags, tag.name) }))}
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
                
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveEdit}
                    className="px-4 py-2.5 bg-primary-600 rounded-lg text-white hover:bg-primary-700 transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="lg:p-6">
                <div className="p-3.5 lg:p-0">
                <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
                  <div
                    data-testid="learning-question-content"
                    className="prose prose-sm max-w-none flex-1 text-[15px] leading-7 text-gray-900 lg:text-lg lg:leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(currentQuestion?.content || '', 'rich') }}
                  />
                  <div className="hidden flex-shrink-0 flex-wrap items-center gap-2 lg:flex">
                    {currentQuestion && (
                      <>
                        <span className={`hidden rounded-lg border px-2.5 py-1 text-xs font-medium lg:inline-flex ${getDifficultyConfig(currentQuestion.difficulty).bg} ${getDifficultyConfig(currentQuestion.difficulty).text} ${getDifficultyConfig(currentQuestion.difficulty).border}`}>
                          {getDifficultyConfig(currentQuestion.difficulty).label}
                        </span>
                        {currentQuestion.category_id && (
                          <span className="hidden rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 lg:inline-flex">
                            {categories.find((c) => c.id === currentQuestion.category_id)?.name}
                          </span>
                        )}
                      </>
                    )}
                    {aiEnabled && canUseAI ? (
                      <button
                        aria-label={showAI ? '收起 AI 助手' : '打开 AI 助手'}
                        onClick={() => setShowAI(!showAI)}
                        className={`rounded-lg p-2 transition-colors ${showAI ? 'bg-violet-50 text-violet-600' : 'text-gray-400 hover:bg-violet-50 hover:text-violet-600'}`}
                      >
                        <Sparkles size={19} />
                      </button>
                    ) : null}
                    {canManageQuestions ? (
                      <button
                        aria-label="编辑当前题目"
                        onClick={startEdit}
                        className="p-2 rounded-lg transition-colors text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      >
                        <Edit size={20} />
                      </button>
                    ) : null}
                    <button
                      aria-label={progress?.is_bookmarked ? '取消收藏当前题目' : '收藏当前题目'}
                      onClick={() => saveProgress(!progress?.is_bookmarked)}
                      className={`rounded-lg p-2 transition-colors ${progress?.is_bookmarked ? 'text-primary-600 bg-gray-100' : 'text-gray-400 hover:text-primary-600 hover:bg-gray-100'}`}
                    >
                      {progress?.is_bookmarked ? <BookmarkCheck size={20} /> : <Bookmark size={20} />}
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4">
                  {mode === 'quiz' && !showAnswer ? (
                    <button
                      onClick={() => setShowAnswer(true)}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 lg:w-auto lg:bg-primary-600 lg:hover:bg-primary-700"
                    >
                      <Brain size={20} />
                      查看答案
                    </button>
                  ) : (
                    <div className="space-y-3 lg:space-y-4">
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <div className="h-4 w-1 rounded-full bg-emerald-500" />
                          <h4 className="text-sm font-semibold text-gray-800">答案</h4>
                        </div>
                        <div
                          data-testid="learning-question-answer"
                          className="prose prose-sm max-w-none rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-gray-700 lg:p-4"
                          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(currentQuestion?.answer || '', 'rich') }}
                        />
                      </div>
                      {currentQuestion?.explanation && (
                        <div>
                          <div className="mb-2 flex items-center gap-2">
                            <div className="h-4 w-1 rounded-full bg-sky-500" />
                            <h4 className="text-sm font-semibold text-gray-800">解析</h4>
                          </div>
                          <div 
                            className="prose prose-sm max-w-none rounded-xl border border-sky-200 bg-sky-50 p-3 text-gray-700 lg:p-4"
                            dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(currentQuestion.explanation, 'rich') }}
                          />
                        </div>
                      )}
                      {mode === 'quiz' ? (
                        <button
                          type="button"
                          onClick={() => setShowAnswer(false)}
                          className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 lg:hidden"
                        >
                          收起答案
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                </div>
              </div>
            )}
          </div>

          {mobileQuestionToolbar}

          <div className="hidden lg:flex lg:flex-col lg:gap-3">
            <div className="items-center justify-center gap-2 lg:flex lg:w-auto">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <ChevronLeft size={18} />
                <span className="sm:inline">上一题</span>
              </button>
              <button
                onClick={handleRandom}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors active:scale-95"
              >
                <Shuffle size={18} />
                <span className="sm:inline">随机</span>
              </button>
              <button
                onClick={handleNext}
                disabled={currentIndex === totalQuestions - 1}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-3 sm:py-2.5 bg-white border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                <span className="sm:inline">下一题</span>
                <ChevronRight size={18} />
              </button>
              {aiEnabled && canUseAI ? (
                <button
                  onClick={() => setShowAI(!showAI)}
                  className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-lg transition-colors ${showAI ? 'text-primary-600 bg-gray-100 border border-gray-200' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  <Sparkles size={20} />
                  <span className="text-sm font-medium">{showAI ? '收起AI' : 'AI助手'}</span>
                </button>
              ) : null}
            </div>
          </div>

          {aiEnabled && canUseAI && currentQuestion && showAI && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-24 lg:mb-0">
              <AIAssistant
                question={currentQuestion}
                onClose={() => setShowAI(false)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};
