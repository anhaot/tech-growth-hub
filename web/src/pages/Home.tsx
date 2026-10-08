import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '@/api';
import { useAuthStore } from '@/store';
import { hasPermission } from '@/lib/permissions';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  CalendarDays,
  Clock3,
  GraduationCap,
  Layers3,
  Plus,
  Target,
  TrendingUp,
} from 'lucide-react';

interface Stats {
  questionCount: number;
  categoryCount: number;
  totalViewed: number;
  todayViewed: number;
  studyViewed: number;
  quizViewed: number;
  bookmarked: number;
  studyTime: number;
}

const defaultStats: Stats = {
  questionCount: 0,
  categoryCount: 0,
  totalViewed: 0,
  todayViewed: 0,
  studyViewed: 0,
  quizViewed: 0,
  bookmarked: 0,
  studyTime: 0,
};

const statsCache = new Map<string, { value: Stats; updatedAt: number }>();
const STATS_CACHE_TTL = 60_000;

export const HomePage: React.FC = () => {
  const { user } = useAuthStore();
  const userId = user?.id || '';
  const initialCache = userId ? statsCache.get(userId) : undefined;
  const [stats, setStats] = useState<Stats>(initialCache?.value || defaultStats);
  const [loading, setLoading] = useState(!initialCache);
  const canManageQuestions = hasPermission(user, 'question_view');

  useEffect(() => {
    if (!userId) return;

    const cached = statsCache.get(userId);
    if (cached) {
      setStats(cached.value);
      setLoading(false);
      if (Date.now() - cached.updatedAt < STATS_CACHE_TTL) return;
    } else {
      setLoading(true);
    }

    let active = true;
    adminApi.getStats()
      .then((response) => {
        if (!active) return;
        const nextStats = { ...defaultStats, ...response.data };
        statsCache.set(userId, { value: nextStats, updatedAt: Date.now() });
        setStats(nextStats);
      })
      .catch((error) => {
        console.error('Failed to fetch stats:', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const progressPercent = stats.questionCount === 0
    ? 0
    : Math.min(100, Math.round((stats.totalViewed / stats.questionCount) * 100));
  const remainingCount = Math.max(0, stats.questionCount - stats.totalViewed);
  const todayTarget = Math.min(20, remainingCount + stats.todayViewed);
  const todayRemaining = Math.max(0, todayTarget - stats.todayViewed);
  const todayPercent = todayTarget === 0
    ? (stats.questionCount > 0 ? 100 : 0)
    : Math.min(100, Math.round((stats.todayViewed / todayTarget) * 100));
  const dateLabel = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  const planTitle = stats.questionCount === 0
    ? '先录入第一道题目'
    : remainingCount === 0
      ? '题库已覆盖，开始答题巩固'
      : todayRemaining > 0
        ? `今天再学习 ${todayRemaining} 道题`
        : '今日学习目标已完成';
  const planDescription = stats.questionCount === 0
    ? '把工作、考试或面试中遇到的问题记录下来，建立自己的题库。'
    : remainingCount === 0
      ? '通过答题模式主动回忆，检查哪些内容还需要复习。'
      : todayRemaining > 0
        ? `题库还有 ${remainingCount} 道未覆盖，建议分小组完成，学完后再做一次答题测试。`
        : '可以复习收藏题，或进入答题模式检验今天的学习效果。';

  const displayValue = (value: number) => loading
    ? <span className="inline-block h-8 w-14 animate-pulse rounded-md bg-slate-200" aria-label="数据加载中" />
    : <>{value}</>;

  const metrics = [
    {
      label: '题目总数',
      value: stats.questionCount,
      note: `${stats.categoryCount} 个分类`,
      icon: BookOpen,
      tone: 'bg-blue-100 text-blue-700',
      surface: 'border-blue-100 bg-gradient-to-br from-blue-50/90 via-white to-white',
    },
    {
      label: '已学习',
      value: stats.totalViewed,
      note: `覆盖率 ${progressPercent}%`,
      icon: GraduationCap,
      tone: 'bg-teal-100 text-teal-700',
      surface: 'border-teal-100 bg-gradient-to-br from-teal-50/80 via-white to-white',
    },
    {
      label: '今日学习',
      value: stats.todayViewed,
      note: `目标 ${todayTarget} 道`,
      icon: TrendingUp,
      tone: 'bg-indigo-100 text-indigo-700',
      surface: 'border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-white',
    },
    {
      label: '收藏题目',
      value: stats.bookmarked,
      note: '集中复习重点',
      icon: Bookmark,
      tone: 'bg-amber-100 text-amber-700',
      surface: 'border-amber-100 bg-gradient-to-br from-amber-50/80 via-white to-white',
    },
  ];

  return (
    <>
      <div className="space-y-3 lg:hidden">
        <section className="px-1 pt-1">
          <p className="text-xs font-medium text-blue-600">{dateLabel}</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950">
            {greeting}，{user?.username || '学习者'}
          </h1>
        </section>

        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-4 text-white shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-100">
                <Target size={15} />
                今日计划
              </div>
              <h2 className="mt-2 text-lg font-semibold text-white">{loading ? '正在生成建议' : planTitle}</h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-blue-100">{planDescription}</p>
            </div>
            <div className="shrink-0 rounded-xl bg-white/15 px-2.5 py-1.5 text-xs font-semibold">
              {loading ? '—' : `${stats.todayViewed}/${todayTarget}`}
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${todayPercent}%` }} />
          </div>
          <Link
            to={stats.questionCount === 0 ? '/capture' : remainingCount === 0 ? '/quiz' : '/study'}
            className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 active:bg-blue-50"
          >
            {stats.questionCount === 0 ? '开始记题' : remainingCount === 0 ? '开始答题' : '继续学习'}
            <ArrowRight size={16} />
          </Link>
        </section>

        <section className="mobile-compact-card grid grid-cols-4 divide-x divide-slate-100 px-1 py-3">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="min-w-0 px-1 text-center">
                <Icon size={16} className="mx-auto text-slate-400" />
                <div className="mt-1.5 truncate text-lg font-bold text-slate-900">{displayValue(metric.value)}</div>
                <p className="mt-0.5 truncate text-[10px] text-slate-500">{metric.label}</p>
              </div>
            );
          })}
        </section>

        <section className="mobile-compact-card p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">快捷入口</h2>
            <span className="text-[11px] text-slate-400">保持每天一点进度</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Link to="/study" className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-blue-50 text-xs font-medium text-blue-700 active:bg-blue-100">
              <GraduationCap size={20} /> 背题
            </Link>
            <Link to="/quiz" className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-indigo-50 text-xs font-medium text-indigo-700 active:bg-indigo-100">
              <Brain size={20} /> 答题
            </Link>
            <Link to="/capture" className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-xs font-medium text-emerald-700 active:bg-emerald-100">
              <Plus size={20} /> 记题
            </Link>
          </div>
        </section>

        <section className="mobile-compact-card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">题库进度</h2>
              <p className="mt-0.5 text-xs text-slate-500">{loading ? '正在同步' : `已学习 ${stats.totalViewed} / ${stats.questionCount} 道`}</p>
            </div>
            <span className="text-xl font-bold text-teal-600">{loading ? '—' : `${progressPercent}%`}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </section>
      </div>

      <div className="hidden lg:block">
      <div className="page-shell">
      <header className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50 px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="pointer-events-none absolute -right-10 -top-20 h-40 w-40 rounded-full border-[26px] border-indigo-100/60" />
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-3 text-white shadow-md shadow-blue-600/15">
            <CalendarDays size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              {greeting}，{user?.username || '学习者'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{dateLabel} · 安排一个清晰的小目标，持续积累。</p>
          </div>
        </div>
        <div className="relative flex gap-2">
          <Link
            to="/study"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700"
          >
            <GraduationCap size={17} />
            开始背题
          </Link>
          <Link
            to="/quiz"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Brain size={17} />
            答题测试
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className={`rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${metric.surface}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                  <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{displayValue(metric.value)}</div>
                </div>
                <div className={`rounded-xl p-2.5 ${metric.tone}`}><Icon size={19} /></div>
              </div>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
                {loading ? '正在同步数据' : metric.note}
              </p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <article className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-blue-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/40 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">今日学习</h2>
              <p className="mt-1 text-sm text-slate-500">按当前进度生成的学习建议</p>
            </div>
            <span className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm">
              今日 {loading ? '—' : stats.todayViewed} 道
            </span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50/70 to-sky-50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 text-white shadow-sm"><Target size={20} /></div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{loading ? '正在生成建议' : planTitle}</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{planDescription}</p>
                </div>
              </div>
              <Link
                to={stats.questionCount === 0 ? '/capture' : remainingCount === 0 ? '/quiz' : '/study'}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:from-blue-700 hover:to-indigo-700"
              >
                {stats.questionCount === 0 ? '开始记题' : remainingCount === 0 ? '开始答题' : '继续学习'}
                <ArrowRight size={16} />
              </Link>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">今日目标</span>
                <span className="text-slate-500">{loading ? '—' : `${stats.todayViewed} / ${todayTarget} 道`}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-500" style={{ width: `${todayPercent}%` }} />
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Link to="/study" className="group flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4 transition-all hover:border-blue-200 hover:bg-blue-50">
                <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><GraduationCap size={18} /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">背题学习</p>
                  <p className="mt-0.5 text-xs text-slate-400">快速覆盖新内容</p>
                </div>
              </Link>
              <Link to="/quiz" className="group flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/35 p-4 transition-all hover:border-indigo-200 hover:bg-indigo-50">
                <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700"><Brain size={18} /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">答题测试</p>
                  <p className="mt-0.5 text-xs text-slate-400">检验掌握程度</p>
                </div>
              </Link>
              <Link to="/bookmarks" className="group flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/35 p-4 transition-all hover:border-amber-200 hover:bg-amber-50">
                <div className="rounded-lg bg-amber-50 p-2 text-amber-600"><Bookmark size={18} /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">复习收藏</p>
                  <p className="mt-0.5 text-xs text-slate-400">集中处理重点题</p>
                </div>
              </Link>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-teal-100 bg-gradient-to-b from-white via-white to-teal-50/40 p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">题库进度</h2>
              <p className="mt-1 text-sm text-slate-500">已学习题目占总题库的比例</p>
            </div>
            <div className="rounded-xl bg-teal-100 p-2.5 text-teal-700"><Layers3 size={20} /></div>
          </div>

          <div className="mt-6 flex items-end justify-between gap-3">
            <div className="text-4xl font-bold tracking-tight text-slate-950">{loading ? '—' : `${progressPercent}%`}</div>
            <div className="pb-1 text-sm text-slate-500">{loading ? '正在同步' : `${stats.totalViewed} / ${stats.questionCount} 道`}</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="mt-6 divide-y divide-slate-100">
            {[
              { label: '待学习', value: remainingCount, unit: '道' },
              { label: '背题记录', value: stats.studyViewed, unit: '道' },
              { label: '答题记录', value: stats.quizViewed, unit: '道' },
              { label: '累计查看', value: stats.studyTime, unit: '次' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-3">
                <span className="text-sm text-slate-500">{item.label}</span>
                <span className="text-sm font-semibold text-slate-900">{loading ? '—' : `${item.value} ${item.unit}`}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            {canManageQuestions ? (
              <Link to="/questions" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200">
                <BookOpen size={16} /> 查看题库
              </Link>
            ) : null}
            {canManageQuestions ? (
              <Link to="/capture" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200">
                <Plus size={16} /> 快速记题
              </Link>
            ) : null}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            <Clock3 size={15} className="mt-0.5 shrink-0 text-slate-400" />
            每次学习 15～20 分钟，比一次集中学习更容易形成稳定记忆。
          </div>
        </article>
      </section>
      </div>
      </div>
    </>
  );
};
