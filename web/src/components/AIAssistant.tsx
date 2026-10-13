import React, { useState, useEffect, useRef } from 'react';
import { AIModelOption, Question } from '@/types';
import { aiApi, importApi } from '@/api';
import { useAuthStore } from '@/store';
import { hasPermission } from '@/lib/permissions';
import { getAvailableAIModels, getPreferredAIModel, resolveAIModel, savePreferredAIModel } from '@/lib/aiModels';
import { buildChatMessage } from '@/lib/aiChat';
import { normalizeAIResponse, renderSafeMarkdown, renderMultilineText } from '@/lib/renderMarkdown';
import { Button, LoadingSpinner } from '@/components/ui';
import { toast } from 'react-hot-toast';
import {
  Sparkles,
  Copy,
  Download,
  Cpu,
  BookOpen,
  Lightbulb,
  MessageCircle,
  MessageSquare,
} from 'lucide-react';

interface AIAssistantProps {
  question: Question;
  onClose?: () => void;
}

const tabs = [
  { id: 'analyze', label: '题目解析', icon: BookOpen },
  { id: 'expand', label: '答案扩展', icon: Sparkles },
  { id: 'recommend', label: '知识推荐', icon: Lightbulb },
  { id: 'generate', label: '相似题目', icon: Download },
  { id: 'concise', label: '精简版', icon: MessageSquare },
  { id: 'casual', label: '口语化', icon: MessageCircle },
  { id: 'structured', label: '结构化', icon: BookOpen },
  { id: 'chat', label: '深度对话', icon: MessageCircle },
] as const;

const AIAssistant: React.FC<AIAssistantProps> = ({ question }) => {
  const { user } = useAuthStore();
  const canImportQuestions = hasPermission(user, 'import_manage');
  const canGenerateQuestions = hasPermission(user, 'ai_generate');
  const canChat = hasPermission(user, 'ai_chat');
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'generate') return canGenerateQuestions;
    if (['concise', 'casual', 'structured', 'chat'].includes(tab.id)) return canChat;
    return true;
  });
  const [activeTab, setActiveTab] = useState<'analyze' | 'expand' | 'recommend' | 'generate' | 'concise' | 'casual' | 'structured' | 'chat'>('analyze');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [provider, setProvider] = useState(getPreferredAIModel);
  const requestSequence = useRef(0);
  const [importing, setImporting] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [generatedQuestions, setGeneratedQuestions] = useState<Array<any>>([]);
  const [availableModels, setAvailableModels] = useState<AIModelOption[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);

  const applyAIResult = (content: string) => {
    setResult(normalizeAIResponse(content));
  };

  useEffect(() => {
    let active = true;
    const fetchProviders = async () => {
      try {
        const response = await aiApi.getStatus();
        if (!active) return;
        const models = getAvailableAIModels(response.data);
        setAvailableModels(models);
        setProvider((current) => resolveAIModel(response.data, current));
      } catch (error) {
        console.error('Failed to fetch AI providers:', error);
        if (active) setAvailableModels([]);
      } finally {
        if (active) setConfigsLoading(false);
      }
    };
    fetchProviders();
    return () => { active = false; requestSequence.current++; };
  }, []);

  useEffect(() => {
    savePreferredAIModel(provider);
  }, [provider]);

  const handleAction = async () => {
    if (loading || importing) return;
    if (!provider) {
      toast.error('请先选择AI模型');
      return;
    }

    const sequence = ++requestSequence.current;
    setLoading(true);
    setResult('');
    setGeneratedQuestions([]);

    try {
      let response;
      switch (activeTab) {
        case 'analyze':
          response = await aiApi.analyze(question.id, provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
        case 'expand':
          response = await aiApi.expand(question.id, provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
        case 'recommend':
          response = await aiApi.recommend(question.id, provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
        case 'generate':
          response = await aiApi.generate(question.id, 3, provider);
          if (sequence !== requestSequence.current) return;
          {
            const resultText = normalizeAIResponse(response.data.result);
            setResult(resultText);
            try {
              const jsonMatch = resultText.match(/\{[\s\S]*"questions"[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.questions && Array.isArray(parsed.questions)) {
                  setGeneratedQuestions(parsed.questions);
                }
              }
            } catch (e) {
              console.error('Failed to parse generated questions:', e);
            }
          }
          break;
        case 'concise':
          response = await aiApi.chat(question.id, '请用精简版回答这道题目，要求：回答文字在100-300字左右，简洁明了。', provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
        case 'casual':
          response = await aiApi.chat(question.id, '请用口语化方式回答这道题目，要求：自然流畅，像在说话，通俗易懂。', provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
        case 'structured':
          response = await aiApi.chat(question.id, '请用结构化方式回答这道题目，要求：分条阐述，条理分明，逻辑清晰。', provider);
          if (sequence !== requestSequence.current) return;
          applyAIResult(response.data.result);
          break;
      }
    } catch (error: any) {
      if (sequence !== requestSequence.current) return;
      console.error('AI action failed:', error);
      const errorMsg = error.response?.data?.error || error.message || 'AI请求失败';
      const shortError = errorMsg.includes('API error') 
        ? 'API调用失败，请检查配置或稍后重试' 
        : (errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg);
      toast.error(shortError);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || loading || !provider) return;

    const userMessage = chatInput.trim();
    if (userMessage.length > 12000) { toast.error('问题不能超过 12000 字'); return; }
    const sequence = ++requestSequence.current;
    const previousMessages = chatMessages;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await aiApi.chat(question.id, buildChatMessage(previousMessages, userMessage), provider);
      if (sequence !== requestSequence.current) return;
      setChatMessages(prev => [...prev, { role: 'assistant', content: normalizeAIResponse(response.data.result) }]);
    } catch (error: any) {
      if (sequence !== requestSequence.current) return;
      setChatMessages(previousMessages);
      setChatInput(userMessage);
      console.error('AI chat failed:', error);
      const errorMsg = error.response?.data?.error || 'AI请求失败';
      const shortError = errorMsg.includes('API error') 
        ? 'API调用失败，请检查配置或稍后重试' 
        : (errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg);
      toast.error(shortError);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const importGeneratedQuestions = async () => {
    if (importing || loading) return;
    if (generatedQuestions.length === 0) {
      toast.error('没有可导入的题目');
      return;
    }

    setImporting(true);
    try {
      const response = await importApi.importText(
        generatedQuestions.map(q => ({
          title: q.title,
          content: q.content,
          answer: q.answer,
          difficulty: q.difficulty || 'medium',
          explanation: q.explanation || '',
        })),
        question.category_id || undefined
      );
      toast.success(`成功导入 ${response.data.success} 道题目`);
      setGeneratedQuestions([]);
    } catch (error: any) {
      toast.error(error.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  if (configsLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                disabled={loading || importing}
                onClick={() => {
                  setActiveTab(tab.id);
                  setResult('');
                  setGeneratedQuestions([]);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-purple-500/20'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-gray-400" />
          <select
            value={provider}
            disabled={loading || importing}
            onChange={(e) => setProvider(e.target.value)}
            className="select-field px-2 pr-8 py-1 bg-white text-gray-700 text-xs cursor-pointer"
          >
            {availableModels.map((modelOption) => (
              <option key={modelOption.id} value={modelOption.id}>
                {modelOption.label}{modelOption.isActive ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </div>
        {activeTab !== 'chat' && (
          <Button onClick={() => handleAction()} loading={loading} size="sm" className="px-3 py-1 text-xs">
            生成
          </Button>
        )}
      </div>

      {activeTab !== 'chat' ? (
        <>
          {result ? (
            <div className="relative">
              <div 
                className="bg-gray-50 rounded-xl p-3 text-gray-700 max-h-96 overflow-y-auto prose prose-sm text-sm"
                dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(result, 'compact') }}
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result);
                    toast.success('已复制到剪贴板');
                  } catch (err) {
                    const textArea = document.createElement('textarea');
                    textArea.value = result;
                    textArea.style.position = 'fixed';
                    textArea.style.left = '-999999px';
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    toast.success('已复制到剪贴板');
                  }
                }}
                className="absolute top-2 right-2 p-1.5 bg-white rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
              >
                <Copy size={14} />
              </button>
            </div>
          ) : null}

          {generatedQuestions.length > 0 && canImportQuestions && (
            <div className="p-2 bg-green-50 rounded-xl border border-green-200">
              <div className="flex items-center justify-between mb-1">
                <p className="text-green-700 font-medium text-xs">已生成 {generatedQuestions.length} 道相似题目</p>
                <Button size="sm" onClick={importGeneratedQuestions} loading={importing}>
                  <Download size={14} className="mr-1" />
                  导入
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="bg-gray-50 rounded-xl p-3 h-64 overflow-y-auto">
            {chatMessages.length === 0 ? (
              <p className="text-gray-500 text-center text-sm">开始与AI深度讨论这道题目吧...</p>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
                >
                  <div
                    className={`inline-block max-w-[80%] p-2 rounded-xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white'
                        : 'bg-white border border-gray-200'
                    }`}
                    dangerouslySetInnerHTML={{ __html: msg.role === 'assistant' ? renderSafeMarkdown(msg.content, 'compact') : renderMultilineText(msg.content) }}
                  />
                </div>
              ))
            )}
            {loading && (
              <div className="text-center">
                <LoadingSpinner />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 focus:bg-white transition-all"
              placeholder="输入您的问题..."
              value={chatInput}
              maxLength={12000}
              disabled={loading}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleChat()}
            />
            <Button onClick={handleChat} loading={loading} size="sm">
              发送
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIAssistant;
