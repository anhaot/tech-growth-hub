import React, { useEffect, useState } from 'react';
import { aiApi, questionApi } from '@/api';
import { AIConfig, Question } from '@/types';
import { MAX_QUESTION_TAGS, parseQuestionTags } from '@/lib/questionTags';
import { renderSafeMarkdown } from '@/lib/renderMarkdown';
import { applyTagSuggestion, getFilteredTagSuggestions } from '@/lib/tagSuggestions';
import { formatStructuredDraftText } from '@/lib/aiDraftFormatting';
import { LoadingSpinner } from '@/components/ui';
import { toast } from 'react-hot-toast';
import { Cpu, Sparkles, X } from 'lucide-react';

export type AIGenerateMode = 'quick' | 'practice' | 'teaching';

const aiGenerateModes: Array<{ value: AIGenerateMode; label: string }> = [
  { value: 'quick', label: '速记版' },
  { value: 'practice', label: '练习版' },
  { value: 'teaching', label: '教学版' },
];

interface AIAnswerDraftModalProps {
  isOpen: boolean;
  question: Question | null;
  availableTags?: Array<{ name: string; count: number }>;
  onClose: () => void;
  onSaved: (payload: { answer: string; explanation: string }) => void;
  introText?: string;
}

const AIAnswerDraftModal: React.FC<AIAnswerDraftModalProps> = ({
  isOpen,
  question,
  availableTags = [],
  onClose,
  onSaved,
  introText = '只生成答案和解析，不改题干、标题和难度。',
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('ai_provider') || '');
  const [mode, setMode] = useState<AIGenerateMode>('practice');
  const [saveMode, setSaveMode] = useState<'replace' | 'append'>('replace');
  const [rawResult, setRawResult] = useState('');
  const [draft, setDraft] = useState<null | {
    answer: string;
    explanation: string;
    tags: string[];
    mode: AIGenerateMode;
  }>(null);
  const [tagsInput, setTagsInput] = useState('');

  useEffect(() => {
    if (!isOpen || !question) {
      setDraft(null);
      setTagsInput('');
      setRawResult('');
      setMode('practice');
      setSaveMode('replace');
    }
  }, [isOpen, question]);

  useEffect(() => {
    if (!isOpen) return;

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

  const currentModeMeta = aiGenerateModes.find((item) => item.value === mode);
  const existingTags = question ? parseQuestionTags(question.tags) : [];
  const selectedTags = parseQuestionTags(tagsInput);
  const matchedTags = getFilteredTagSuggestions(tagsInput, availableTags);

  const handleGenerate = async () => {
    if (!question) return;

    setLoading(true);
    try {
      const response = await aiApi.answerDraft(question.id, mode, provider || undefined);
      setDraft({
        ...response.data.draft,
        answer: formatStructuredDraftText(response.data.draft.answer),
        explanation: formatStructuredDraftText(response.data.draft.explanation),
      });
      setTagsInput((response.data.draft.tags || []).join(', '));
      setRawResult(response.data.raw);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'AI答案生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!question || !draft) return;

    setSaving(true);
    try {
      const nextExplanation = saveMode === 'append' && question.explanation
        ? `${question.explanation}\n\n---\nAI补充（${currentModeMeta?.label || '新版本'}）\n${draft.explanation}`.trim()
        : draft.explanation;
      const nextTags = Array.from(new Set([...existingTags, ...selectedTags])).slice(0, MAX_QUESTION_TAGS);

      await questionApi.update(question.id, {
          source: 'ai-answer',
          expectedRevision: question.revision,
        answer: draft.answer,
        explanation: nextExplanation,
        tags: nextTags,
      });
      toast.success('AI 答案已保存');
      onSaved({ answer: draft.answer, explanation: nextExplanation });
    } catch (error: any) {
      toast.error(error.response?.data?.error || '保存答案失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!draft) return;

    const payload = draft.explanation
      ? `答案：\n${draft.answer}\n\n解析：\n${draft.explanation}`
      : draft.answer;

    try {
      await navigator.clipboard.writeText(payload);
      toast.success(`已复制${currentModeMeta?.label || ''}`);
    } catch {
      toast.error('复制失败，请检查浏览器权限');
    }
  };

  const toggleTag = (tag: string) => {
    const current = parseQuestionTags(tagsInput);
    const next = current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag].slice(0, MAX_QUESTION_TAGS);
    setTagsInput(next.join(', '));
  };

  if (!isOpen || !question) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="app-modal-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
          <div className="app-modal-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI 答案生成</h2>
              <p className="text-sm text-gray-500">{introText}</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4 overflow-y-auto border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">当前题目</div>
                <div
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.content, 'compact') }}
                />
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">答案版本</div>
                <div className="grid grid-cols-3 gap-2">
                  {aiGenerateModes.map((modeOption) => {
                    const active = modeOption.value === mode;
                    return (
                      <button
                        key={modeOption.value}
                        type="button"
                        onClick={() => setMode(modeOption.value)}
                        className={`rounded-xl border px-3 py-3 text-center transition-all ${
                          active
                            ? 'border-primary-500 bg-primary-50 shadow-sm ring-2 ring-primary-500/10'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <span className="text-sm font-medium text-gray-900">{modeOption.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Cpu size={14} />
                  临时模型
                </div>
                {configsLoading ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    正在加载模型配置...
                  </div>
                ) : aiConfigs.length > 0 ? (
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="select-field w-full px-4 pr-10 py-3 bg-white text-gray-700"
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

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles size={18} />
                {loading ? '生成中...' : `生成${currentModeMeta?.label || ''}`}
              </button>
            </div>

            <div className="min-h-0 space-y-4 overflow-y-auto bg-gray-50/40 p-6">
              {loading && !draft ? (
                <div className="flex h-full min-h-[320px] items-center justify-center">
                  <LoadingSpinner size="lg" />
                </div>
              ) : !draft ? (
                <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-gray-500">
                  先选择版本，再生成当前版本的答案、解析和标签建议。
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/70 bg-white p-4 shadow-sm">
                    <div className="mb-2 text-sm font-semibold text-gray-900">原答案</div>
                    <div
                      className="prose prose-sm max-w-none text-sm leading-6 text-gray-700"
                      dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(question.answer, 'compact') }}
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">新答案</div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                          {currentModeMeta?.label}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopy}
                          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800"
                        >
                          复制当前版本
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={8}
                      value={draft.answer}
                      onChange={(e) => setDraft((current) => (current ? { ...current, answer: e.target.value } : current))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15"
                    />
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold text-gray-900">解析草稿</div>
                    <textarea
                      rows={6}
                      value={draft.explanation}
                      onChange={(e) => setDraft((current) => (current ? { ...current, explanation: e.target.value } : current))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15"
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">标签建议</div>
                      <span className="text-xs text-gray-500">可点选 AI 建议，也可手动补充标签</span>
                    </div>
                    {draft.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-4">
                        {draft.tags.map((tag) => {
                          const active = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                                active
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-white'
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-500">
                        当前版本未生成标签建议。
                      </div>
                    )}
                    <div className="mt-3 space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-700">手动补充标签</div>
                        <input
                          type="text"
                          value={tagsInput}
                          onChange={(e) => setTagsInput(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/15"
                          placeholder="多个标签用逗号分隔，最多 5 个"
                        />
                      </div>
                      {matchedTags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {matchedTags.map((tag) => (
                            <button
                              key={`manual-${tag.name}`}
                              type="button"
                              onClick={() => setTagsInput((current) => applyTagSuggestion(current, tag.name))}
                              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-white"
                            >
                              {tag.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {selectedTags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {selectedTags.map((tag) => (
                            <span
                              key={`selected-${tag}`}
                              className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold text-gray-900">保存方式</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setSaveMode('replace')}
                        className={`rounded-xl border px-4 py-3 text-left transition-all ${
                          saveMode === 'replace'
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/10'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-900">覆盖当前答案</div>
                        <div className="mt-1 text-xs leading-5 text-gray-500">用新答案和新解析直接替换原内容。</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveMode('append')}
                        className={`rounded-xl border px-4 py-3 text-left transition-all ${
                          saveMode === 'append'
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/10'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="text-sm font-medium text-gray-900">追加到原解析</div>
                        <div className="mt-1 text-xs leading-5 text-gray-500">答案更新为新版本，原解析保留并追加 AI 补充。</div>
                      </button>
                    </div>
                  </div>

                  <details className="rounded-2xl border border-gray-200 bg-white p-4">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">查看原始 AI 返回内容</summary>
                    <pre className="mt-3 whitespace-pre-wrap overflow-x-auto text-xs text-gray-700">{rawResult}</pre>
                  </details>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button onClick={onClose} className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-gray-700 transition-all hover:bg-gray-50">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!draft || loading || saving}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '只保存答案'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAnswerDraftModal;
