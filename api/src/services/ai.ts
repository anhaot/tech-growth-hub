import { config } from '../config/index.js';
import { db } from '../database/index.js';
import { assertAIBaseUrlResolvesPublic, validateAIBaseUrl } from '../utils/aiConfigSecurity.js';

interface ProviderActor {
  userId?: string;
  role?: string;
}

export interface AIProvider {
  name: string;
  chat(messages: Array<{ role: string; content: string }>, options?: ChatOptions): Promise<string>;
}

interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

const defaultBaseUrls: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  wenxin: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
};

const AI_REQUEST_TIMEOUT_MS = 180000;

function getProviderErrorMessage(providerName: string, status: number, responseBody: string): string {
  let detail = responseBody;
  try {
    const parsed = JSON.parse(responseBody) as { detail?: string; error?: { message?: string } | string; message?: string };
    detail = parsed.detail
      || (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message)
      || parsed.message
      || responseBody;
  } catch {
    // Keep the plain-text response returned by the provider.
  }

  if (status === 404 && /Function ['"]?[^'"]+['"]?:? Not found for account/i.test(detail)) {
    return `${providerName} 当前账户无权调用该模型。NVIDIA 模型列表可见不代表可调用，请确认账户已开通 Public API Endpoints；若已开通，则该模型的托管端点可能暂不可用，请更换模型或联系 NVIDIA 支持。`;
  }

  const normalizedDetail = detail.replace(/\s+/g, ' ').trim().slice(0, 500);
  return `${providerName} API 请求失败（HTTP ${status}）${normalizedDetail ? `：${normalizedDetail}` : ''}`;
}

class OpenAICompatibleProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private timeout: number;

  constructor(name: string, apiKey: string, model: string, baseUrl?: string, timeout: number = AI_REQUEST_TIMEOUT_MS) {
    this.name = name;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl || defaultBaseUrls[name] || 'https://api.openai.com/v1';
    this.timeout = timeout;
  }

  async chat(messages: Array<{ role: string; content: string }>, options: ChatOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      validateAIBaseUrl(this.baseUrl, { role: 'admin' }, true, 'runtime');
      await assertAIBaseUrlResolvesPublic(this.baseUrl);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 4000,
        }),
        signal: controller.signal,
        redirect: 'error',
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(getProviderErrorMessage(this.name, response.status, error));
      }
      const data = await response.json() as ChatCompletionResponse;
      return data.choices[0].message.content;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`${this.name} 推理接口在 ${Math.round(this.timeout / 1000)} 秒内未响应。若模型列表可以正常读取，通常是上游账户权限、地区访问限制或托管推理服务异常，请更换网络/提供商或联系上游支持`);
      }
      
      if (error.message?.includes('ECONNREFUSED')) {
        throw new Error(`${this.name} 连接被拒绝，请检查API地址和端口`);
      }
      
      if (error.message?.includes('ENOTFOUND')) {
        throw new Error(`${this.name} 无法解析API地址，请检查base_url是否正确`);
      }
      
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export { OpenAICompatibleProvider };

class AIService {
  private providers: Map<string, AIProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    if (config.ai.openai.apiKey) {
      this.providers.set('openai', new OpenAICompatibleProvider('openai', config.ai.openai.apiKey, config.ai.openai.model, config.ai.openai.baseUrl));
    }
    if (config.ai.deepseek.apiKey) {
      this.providers.set('deepseek', new OpenAICompatibleProvider('deepseek', config.ai.deepseek.apiKey, config.ai.deepseek.model, config.ai.deepseek.baseUrl));
    }
    if (config.ai.qwen.apiKey) {
      this.providers.set('qwen', new OpenAICompatibleProvider('qwen', config.ai.qwen.apiKey, config.ai.qwen.model, config.ai.qwen.baseUrl));
    }
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  async getProvider(providerName: string, actor?: ProviderActor): Promise<AIProvider> {
    const defaultBaseUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      deepseek: 'https://api.deepseek.com/v1',
      qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      doubao: 'https://ark.cn-beijing.volces.com/api/v3',
      wenxin: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
      zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    };

    const userId = actor?.userId;
    const actorRole = actor?.role || 'user';

    if (userId && providerName) {
      const allConfigs = await db.getAIConfigsByUserId(userId);
      const normalizedProviderName = providerName.toLowerCase();
      const matchingConfigs = allConfigs.filter(c =>
        c.id === providerName
        || c.display_name === providerName
        || c.provider === providerName
        || c.display_name?.toLowerCase() === normalizedProviderName
        || c.provider.toLowerCase() === normalizedProviderName
      );
      // Configuration IDs are the only unambiguous selector. For legacy clients that
      // still send a provider/display name, prefer the active config instead of the
      // first row returned by the database.
      const targetConfig = matchingConfigs.find(c => c.id === providerName)
        || matchingConfigs.find(c => c.is_active)
        || matchingConfigs[0];
      if (targetConfig) {
        const baseUrl = validateAIBaseUrl(
          targetConfig.base_url || defaultBaseUrls[targetConfig.provider] || 'https://api.openai.com/v1',
          { role: actorRole },
          Boolean(targetConfig.is_custom),
          'runtime'
        );
        return new OpenAICompatibleProvider(
          targetConfig.display_name || targetConfig.provider,
          targetConfig.api_key,
          targetConfig.model,
          baseUrl,
          AI_REQUEST_TIMEOUT_MS
        );
      }
    }

    if (userId) {
      const userConfig = await db.getActiveAIConfig(userId);
      if (userConfig) {
        const baseUrl = validateAIBaseUrl(
          userConfig.base_url || defaultBaseUrls[userConfig.provider] || 'https://api.openai.com/v1',
          { role: actorRole },
          Boolean(userConfig.is_custom),
          'runtime'
        );
        return new OpenAICompatibleProvider(
          userConfig.display_name || userConfig.provider,
          userConfig.api_key,
          userConfig.model,
          baseUrl,
          AI_REQUEST_TIMEOUT_MS
        );
      }
    }

    const provider = this.providers.get(providerName);
    if (provider) {
      return provider;
    }
    
    throw new Error(`AI provider '${providerName}' is not configured. Please add an AI configuration in Settings.`);
  }

  async chat(messages: Array<{ role: string; content: string }>, providerName?: string, actor?: ProviderActor): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider, actor);
    return provider.chat(messages);
  }

  async analyzeQuestion(question: { title: string; content: string; answer: string }, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider);
    
    const prompt = `请分析以下题目，提供详细的解题思路和知识点：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请提供：
1. 题目分析
2. 解题思路
3. 相关知识点
4. 易错点提示`;

    return provider.chat([{ role: 'user', content: prompt }]);
  }

  async expandAnswer(question: { title: string; content: string; answer: string }, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider);
    
    const prompt = `请扩展以下题目的答案，提供更详细的解释：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请提供更详细的答案解释，包括：
1. 详细解答过程
2. 相关概念解释
3. 实际应用场景`;

    return provider.chat([{ role: 'user', content: prompt }]);
  }

  async recommendKnowledge(question: { title: string; content: string; answer: string }, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider);
    
    const prompt = `基于以下题目，推荐相关的学习知识点：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请推荐：
1. 相关知识点
2. 学习资源建议
3. 练习建议`;

    return provider.chat([{ role: 'user', content: prompt }]);
  }

  async generateSimilarQuestions(question: { title: string; content: string; answer: string }, count: number = 3, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider);
    
    const prompt = `请基于以下题目生成${count}道类似的练习题：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请生成${count}道类似的题目，每道题包含：
1. 题目内容
2. 参考答案
3. 解析`;

    return provider.chat([{ role: 'user', content: prompt }]);
  }

  async explainConcept(concept: string, context?: string, providerName?: string): Promise<string> {
    const provider = await this.getProvider(providerName || config.ai.defaultProvider);
    
    const prompt = context
      ? `请解释以下概念：${concept}

上下文：${context}

请提供详细的解释，包括定义、特点、应用场景等。`
      : `请解释以下概念：${concept}

请提供详细的解释，包括定义、特点、应用场景等。`;

    return provider.chat([{ role: 'user', content: prompt }]);
  }
}

export const aiService = new AIService();
