import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { questionApi } from '@/api';
import { getTagColorClasses } from '@/lib/tagColors';
import { parseQuestionTags } from '@/lib/questionTags';
import { renderSafeMarkdown } from '@/lib/renderMarkdown';
import { useAuthStore } from '@/store';
import { Bookmark, BookOpen, Brain, Trash2, Star, Eye, EyeOff, Tags, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface Question {
  id: string;
  title: string;
  content: string;
  answer: string;
  explanation: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  category_id: string | null;
  tags: string;
}

const bookmarksCache = new Map<string, Question[]>();

export const BookmarksPage: React.FC = () => {
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'quiz' ? 'quiz' : 'study';
  const cacheScope = JSON.stringify([user?.id, user?.role, user?.user_type, user?.library_owner_id, user?.category_scopes, user?.permissions]);
  const initialCacheKey = `${cacheScope}|${mode}`;
  const currentCacheKey = useRef(initialCacheKey);
  currentCacheKey.current = initialCacheKey;
  const requestSequence = useRef(0);
  const initialBookmarks = bookmarksCache.get(initialCacheKey);
  const [questions, setQuestions] = useState<Question[]>(initialBookmarks || []);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(!initialBookmarks);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  const fetchBookmarks = async () => {
    const sequence = ++requestSequence.current;
    const cacheKey = initialCacheKey;
    const cached = bookmarksCache.get(cacheKey);
    if (cached) {
      setQuestions(cached);
      setLoading(false);
    } else {
      setQuestions([]);
      setLoading(true);
    }
    try {
      const response = await questionApi.getBookmarked(mode);
      if (sequence !== requestSequence.current) return;
      if (bookmarksCache.size >= 20) bookmarksCache.delete(bookmarksCache.keys().next().value!);
      bookmarksCache.set(cacheKey, response.data);
      setQuestions(response.data);
      setSelectedIds((current) => new Set(response.data.filter((q: Question) => current.has(q.id)).map((q: Question) => q.id)));
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error);
      if (sequence === requestSequence.current) toast.error('获取收藏失败，请稍后重试');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedIds(new Set());
    fetchBookmarks();
    return () => { requestSequence.current++; };
  }, [mode, cacheScope]);

  const handleRemoveBookmark = async (questionId: string) => {
    if (removing) return;
    if (!confirm('确定要取消收藏吗？')) return;

    const cacheKey = initialCacheKey;
    setRemoving(true);
    try {
      await questionApi.removeBookmarks([questionId], mode);
      bookmarksCache.delete(cacheKey);
      toast.success('已取消收藏');
    } catch (error) {
      toast.error('操作失败');
    } finally {
      if (cacheKey === currentCacheKey.current) await fetchBookmarks();
      setRemoving(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

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

  const removeFilterTag = (value: string) => {
    setSelectedTags((prev) => prev.filter((tag) => tag !== value));
  };

  const filteredQuestions = selectedTags.length === 0
    ? questions
    : questions.filter((question) => {
        const tags = parseQuestionTags(question.tags);
        return selectedTags.every((tag) => tags.includes(tag));
      });

  const removeSelected = async () => {
    if (!selectedIds.size || removing || !confirm(`取消选中的 ${selectedIds.size} 道题的收藏？题目仍保留在题库中。`)) return;
    setRemoving(true);
    const cacheKey = initialCacheKey;
    try {
      const ids = [...selectedIds];
      for (let offset = 0; offset < ids.length; offset += 500) {
        await questionApi.removeBookmarks(ids.slice(offset, offset + 500), mode);
        bookmarksCache.delete(cacheKey);
      }
      if (cacheKey === currentCacheKey.current) setSelectedIds(new Set());
      toast.success('已批量取消收藏');
    } catch (error) {
      toast.error('批量取消未全部完成，请刷新后重试');
    } finally {
      if (cacheKey === currentCacheKey.current) await fetchBookmarks();
      setRemoving(false);
    }
  };

  const availableTags = Array.from(
    questions.reduce((map, question) => {
      for (const tag of parseQuestionTags(question.tags)) {
        map.set(tag, (map.get(tag) || 0) + 1);
      }
      return map;
    }, new Map<string, number>())
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));

  return (
    <div className="page-shell">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="hidden rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 p-3 shadow-lg shadow-orange-500/20 lg:block">
            <Bookmark className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 lg:text-2xl">我的收藏</h1>
            <p className="text-xs text-gray-500 lg:text-sm">共 {questions.length} 道收藏题目<span className="hidden lg:inline">，支持按标签快速回看</span></p>
          </div>
        </div>
          <Link to={mode === 'study' ? '/study' : '/quiz'}>
            <button className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 lg:gap-2 lg:px-4 lg:text-sm">
              {mode === 'study' ? (
                <>
                  <BookOpen size={18} className="text-green-500" />
                  <span className="hidden min-[350px]:inline">继续背题</span>
                </>
              ) : (
                <>
                  <Brain size={18} className="text-blue-500" />
                  <span className="hidden min-[350px]:inline">继续答题</span>
                </>
              )}
            </button>
          </Link>
      </div>

      <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-3 lg:rounded-2xl lg:p-4">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center">
          <div className="flex rounded-xl bg-slate-100 p-1 xl:flex-none xl:gap-2 xl:bg-transparent xl:p-0">
            <button
              disabled={removing}
              onClick={() => setSearchParams({ mode: 'study' })}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all lg:gap-2 lg:px-5 lg:py-3 lg:text-sm ${
                mode === 'study'
                  ? 'bg-white text-emerald-700 shadow-sm lg:bg-gradient-to-r lg:from-green-500 lg:to-emerald-600 lg:text-white lg:shadow-lg lg:shadow-green-500/20'
                  : 'text-gray-600 lg:border lg:border-gray-200 lg:bg-white lg:text-gray-700 lg:hover:bg-gray-50'
              }`}
            >
              <BookOpen size={17} />
              背题收藏
            </button>
            <button
              disabled={removing}
              onClick={() => setSearchParams({ mode: 'quiz' })}
              className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all lg:gap-2 lg:px-5 lg:py-3 lg:text-sm ${
                mode === 'quiz'
                  ? 'bg-white text-blue-700 shadow-sm lg:bg-gradient-to-r lg:from-blue-500 lg:to-indigo-600 lg:text-white lg:shadow-lg lg:shadow-blue-500/20'
                  : 'text-gray-600 lg:border lg:border-gray-200 lg:bg-white lg:text-gray-700 lg:hover:bg-gray-50'
              }`}
            >
              <Brain size={17} />
              答题收藏
            </button>
          </div>
          {availableTags.length > 0 || selectedTags.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowMobileFilters((value) => !value)}
              className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium lg:hidden ${
                showMobileFilters || selectedTags.length > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              <Tags size={16} /> 标签筛选{selectedTags.length > 0 ? `（${selectedTags.length}）` : ''}
            </button>
          ) : null}
          <div className={`${showMobileFilters ? 'relative' : 'hidden'} flex-1 lg:relative lg:block`}>
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
            placeholder="标签筛选"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-3 text-gray-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />
          </div>
        </div>
        {selectedTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tag) => (
              <button
                key={tag}
                onClick={() => removeFilterTag(tag)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm ${getTagColorClasses(tag)}`}
              >
                {tag}
                <X size={14} />
              </button>
            ))}
          </div>
        ) : null}
        {availableTags.length > 0 ? (
          <div className={`${showMobileFilters || selectedTags.length > 0 ? 'mobile-scroll-row' : 'hidden'} lg:flex lg:flex-wrap lg:overflow-visible`}>
            {availableTags.slice(0, 12).map((tag) => (
              <button
                key={tag.name}
                onClick={() => addFilterTag(tag.name)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${getTagColorClasses(tag.name)} ${
                  selectedTags.includes(tag.name)
                    ? 'ring-2 ring-primary-200'
                    : 'hover:brightness-95'
                  }`}
              >
                <span>{tag.name}</span>
                <span className="text-xs text-gray-400">{tag.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {questions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3">
          <button disabled={removing} onClick={() => setSelectedIds(new Set(filteredQuestions.map((q) => q.id)))} className="text-sm text-primary-600">全选当前列表</button>
          <button disabled={removing} onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-500">取消全选</button>
          <span className="text-sm text-gray-500">已选 {selectedIds.size} 道</span>
          <button disabled={removing || !selectedIds.size} onClick={removeSelected} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 disabled:opacity-40">{removing ? '正在取消…' : '批量取消收藏'}</button>
        </div>
      )}

      {loading && questions.length === 0 ? (
        <div className="animate-pulse space-y-3" aria-label="收藏题目加载中">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-2xl border border-slate-100 bg-white p-5">
              <div className="h-5 w-24 rounded bg-slate-200" />
              <div className="mt-5 h-5 w-3/4 rounded bg-slate-100" />
              <div className="mt-3 h-5 w-1/2 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : filteredQuestions.length === 0 ? (
        <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 text-center text-gray-500 lg:h-64 lg:min-h-0 lg:rounded-2xl">
          <div className="mb-4 rounded-2xl bg-amber-50 p-4">
            <Star size={32} className="text-amber-400" />
          </div>
          <p className="mb-1 text-lg font-medium text-gray-700">{questions.length === 0 ? '暂无收藏题目' : '没有符合标签条件的收藏题目'}</p>
          <p className="mb-4 text-sm text-gray-500">{questions.length === 0 ? '在学习过程中点击收藏按钮添加题目' : '换一个标签试试，或清空当前标签筛选。'}</p>
          <Link to={mode === 'study' ? '/study' : '/quiz'}>
            <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 rounded-xl text-white hover:from-amber-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-500/20">
              {mode === 'study' ? '去背题' : '去答题'}
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3 lg:space-y-4">
          {filteredQuestions.map((question) => {
            const diffConfig = getDifficultyConfig(question.difficulty);
            const isExpanded = expandedIds.has(question.id);
            
            return (
              <div
                key={question.id}
                className="overflow-hidden rounded-xl border border-gray-100 bg-white transition-all hover:shadow-md lg:rounded-2xl lg:shadow-sm"
              >
                <div className="flex items-start justify-between px-3.5 pb-0 pt-3.5 lg:px-5 lg:pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" aria-label={`选择收藏：${question.title}`} checked={selectedIds.has(question.id)} disabled={removing} onChange={() => setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(question.id)) next.delete(question.id); else next.add(question.id);
                      return next;
                    })} className="h-5 w-5" />
                    <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border ${diffConfig.bg} ${diffConfig.text} ${diffConfig.border}`}>
                      {diffConfig.label}
                    </span>
                  </div>
                  <button
                    disabled={removing}
                    onClick={() => handleRemoveBookmark(question.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="取消收藏"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <div className="p-3.5 pt-2 lg:p-5 lg:pt-3">
                  <div 
                    className="text-gray-900 prose prose-sm max-w-none mb-4"
                    dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.content.substring(0, isExpanded ? undefined : 200), 'compact') }}
                  />
                  
                  {!isExpanded && (
                    <button
                      onClick={() => toggleExpand(question.id)}
                      className="mt-1 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-50 text-xs font-medium text-amber-700 active:bg-amber-100 lg:mt-0 lg:min-h-0 lg:w-auto lg:bg-transparent lg:text-sm lg:text-purple-600 lg:hover:text-purple-700"
                    >
                      <Eye size={14} />
                      查看答案
                    </button>
                  )}
                  
                  {isExpanded && (
                    <>
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-1 h-5 bg-gradient-to-b from-green-500 to-emerald-500 rounded-full" />
                          <h4 className="text-sm font-semibold text-gray-700">答案</h4>
                        </div>
                        <div 
                          className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 rounded-xl text-gray-700 prose prose-sm max-w-none border border-green-100"
                          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.answer, 'compact') }}
                        />
                      </div>
                      
                      {question.explanation && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-1 h-5 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                            <h4 className="text-sm font-semibold text-gray-700">解析</h4>
                          </div>
                          <div 
                            className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl text-gray-700 prose prose-sm max-w-none border border-blue-100"
                            dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.explanation, 'compact') }}
                          />
                        </div>
                      )}
                      
                      <button
                        onClick={() => toggleExpand(question.id)}
                        className="mt-4 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-50 text-xs font-medium text-slate-600 active:bg-slate-100 lg:min-h-0 lg:w-auto lg:bg-transparent lg:text-sm lg:text-gray-500 lg:hover:text-gray-700"
                      >
                        <EyeOff size={14} />
                        收起答案
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
