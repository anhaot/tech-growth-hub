import { Router, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../database/index.js';
import { authMiddleware, AuthRequest, getLibraryOwnerId, hasCategoryScopeAccess, requirePermission } from '../middleware/auth.js';
import { aiService } from '../services/ai.js';
import { config } from '../config/index.js';
import { AIConfig, User } from '../types/index.js';
import { assertAIBaseUrlResolvesPublic, validateAIBaseUrl } from '../utils/aiConfigSecurity.js';
import { normalizeTagsInput, parseStoredTags, parseTagAliasMap, TagAliasMap } from '../utils/tags.js';

const router = Router();
router.use(authMiddleware, requirePermission('ai_use', '没有AI使用权限'));

const inferencePaths = new Set(['/analyze', '/explain', '/expand', '/recommend', '/generate', '/chat', '/test-config', '/batch-generate', '/polish-question', '/answer-drafts/raw', '/answer-draft', '/batch-tags']);
async function isAIEnabled() {
  const stored = await db.getSetting('ai_enabled');
  return stored === null || stored === undefined ? config.ai.enabled : stored === 'true';
}
router.use(async (req, res, next) => {
  try {
    if (req.method === 'POST' && inferencePaths.has(req.path) && !await isAIEnabled()) { res.status(403).json({ error: 'AI 功能已关闭，请联系管理员开启' }); return; }
    next();
  } catch { res.status(500).json({ error: '读取 AI 设置失败' }); }
});

const aiConfigSchema = z.object({
  provider: z.string().min(1).max(50),
  displayName: z.string().max(100).optional(),
  baseUrl: z.string().url().max(500).optional().or(z.literal('')),
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().min(1).max(100),
  isCustom: z.boolean().optional(),
  sourceConfigId: z.string().uuid().optional(),
  credentialId: z.string().uuid().optional(),
});

const aiCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().trim().min(1).max(500),
});

const aiModelsSchema = z.object({
  configId: z.string().uuid().optional(),
  credentialId: z.string().uuid().optional(),
  baseUrl: z.string().url().max(500).optional().or(z.literal('')),
  apiKey: z.string().min(1).max(200).optional(),
  isCustom: z.boolean().optional(),
});

const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultProvider: z.string().max(50).optional(),
});

const batchGenerateSchema = z.object({
  topic: z.string().min(2).max(200),
  count: z.number().int().min(1).max(20).default(10),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  mode: z.enum(['quick', 'practice', 'teaching']).default('practice'),
  requirements: z.string().max(2000).optional(),
  provider: z.string().max(100).optional(),
  categoryName: z.string().max(100).optional(),
});

const polishQuestionSchema = z.object({
  questionId: z.string().uuid(),
  mode: z.enum(['light', 'deep']).default('light'),
  provider: z.string().max(100).optional(),
});

const answerDraftSchema = z.object({
  questionId: z.string().uuid(),
  mode: z.enum(['quick', 'practice', 'teaching']).default('practice'),
  provider: z.string().max(100).optional(),
});

const rawAnswerDraftSchema = z.object({
  questions: z.array(z.object({
    clientId: z.string().min(1).max(100),
    content: z.string().min(1).max(4000),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  })).min(1).max(20),
  mode: z.enum(['quick', 'practice', 'teaching']).default('practice'),
  provider: z.string().max(100).optional(),
});

type ModelStatus = 'unknown' | 'valid' | 'invalid';

const defaultBaseUrls: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  wenxin: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
};

function toPublicAIConfig(c: AIConfig) {
  return {
    id: c.id,
    provider: c.provider,
    displayName: c.display_name,
    baseUrl: c.base_url,
    model: c.model,
    isActive: Boolean(c.is_active),
    isCustom: Boolean(c.is_custom),
    credentialId: c.credential_id,
    modelStatus: c.model_status || 'unknown',
    lastCheckedAt: c.last_checked_at,
    lastCheckError: c.last_check_error,
    createdAt: c.created_at,
  };
}

function toPublicAICredential(c: { id: string; name: string; base_url: string; created_at: string }) {
  return { id: c.id, name: c.name, baseUrl: c.base_url, createdAt: c.created_at };
}

function validateCredentialKey(baseUrl: string, apiKey: string): string {
  const trimmed = apiKey.trim();
  if (new URL(baseUrl).hostname.toLowerCase() === 'integrate.api.nvidia.com' && !trimmed.startsWith('nvapi-')) {
    throw new Error('NVIDIA API Key 格式无效：应使用 build.nvidia.com 生成、以 nvapi- 开头的完整密钥');
  }
  return trimmed;
}

function getConfigBaseUrl(aiConfig: AIConfig): string {
  return aiConfig.base_url || defaultBaseUrls[aiConfig.provider] || 'https://api.openai.com/v1';
}

async function fetchAIModels(baseUrl: string, apiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    await assertAIBaseUrlResolvesPublic(baseUrl);
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`模型列表获取失败: HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    const data = JSON.parse(text) as {
      data?: Array<{ id?: string; object?: string; owned_by?: string }>;
    };
    const ids = Array.from(new Set((data.data || [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id))));

    return ids.sort((a, b) => a.localeCompare(b));
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('模型列表获取超时，请检查 API 地址或网络');
    }
    if (error instanceof SyntaxError) {
      throw new Error('模型列表返回格式无效');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function markAIConfigModelStatus(aiConfig: AIConfig): Promise<{
  id: string;
  model: string;
  status: ModelStatus;
  checkedAt: string;
  error?: string;
}> {
  const checkedAt = new Date().toISOString();
  try {
    const baseUrl = validateAIBaseUrl(getConfigBaseUrl(aiConfig), { role: 'admin' }, Boolean(aiConfig.is_custom), 'runtime');
    const models = await fetchAIModels(baseUrl!, aiConfig.api_key);
    const exists = models.includes(aiConfig.model);
    if (!exists) {
      const error = `模型不在当前 API 可用列表中：${aiConfig.model}`;
      await db.updateAIConfig(aiConfig.id, {
        model_status: 'invalid',
        last_checked_at: checkedAt,
        last_check_error: error,
      });
      return { id: aiConfig.id, model: aiConfig.model, status: 'invalid', checkedAt, error };
    }

    // /models is a provider-wide catalog on services such as NVIDIA. A tiny real
    // completion is required to verify that this account can actually invoke it.
    const baseUrlForRuntime = validateAIBaseUrl(getConfigBaseUrl(aiConfig), { role: 'admin' }, Boolean(aiConfig.is_custom), 'runtime');
    const { OpenAICompatibleProvider } = await import('../services/ai.js');
    const provider = new OpenAICompatibleProvider(
      aiConfig.display_name || aiConfig.provider,
      aiConfig.api_key,
      aiConfig.model,
      baseUrlForRuntime,
      90000
    );
    await provider.chat([{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 8, temperature: 0 });

    await db.updateAIConfig(aiConfig.id, {
      model_status: 'valid',
      last_checked_at: checkedAt,
      last_check_error: '',
    });

    return { id: aiConfig.id, model: aiConfig.model, status: 'valid', checkedAt };
  } catch (error) {
    const message = (error as Error).message;
    const status: ModelStatus = /当前账户无权调用|API 请求失败（HTTP 4(?!29)\d\d）/.test(message)
      ? 'invalid'
      : 'unknown';
    await db.updateAIConfig(aiConfig.id, {
      model_status: status,
      last_checked_at: checkedAt,
      last_check_error: message,
    });
    return { id: aiConfig.id, model: aiConfig.model, status, checkedAt, error: message };
  }
}

const batchTagsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  mode: z.enum(['add', 'replace']).default('add'),
  provider: z.string().max(100).optional(),
});

function sanitizePrompt(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .substring(0, 10000);
}

function tryParseJson<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function normalizeGeneratedQuestionList(parsed: unknown) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (
    parsed
    && typeof parsed === 'object'
    && 'questions' in parsed
    && Array.isArray((parsed as { questions?: unknown[] }).questions)
  ) {
    return (parsed as { questions: unknown[] }).questions;
  }

  return null;
}

function extractGeneratedQuestions(result: string): Array<{
  title: string;
  content: string;
  answer: string;
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  tags?: string[];
}> {
  const directParsed = normalizeGeneratedQuestionList(tryParseJson(result));
  const fencedParsed = normalizeGeneratedQuestionList(
    tryParseJson(result.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || '')
  );
  const objectParsed = normalizeGeneratedQuestionList(
    tryParseJson(result.match(/\{[\s\S]*\}/)?.[0] || '')
  );
  const arrayParsed = normalizeGeneratedQuestionList(
    tryParseJson(result.match(/\[[\s\S]*\]/)?.[0] || '')
  );

  const parsed = directParsed || fencedParsed || objectParsed || arrayParsed;
  if (!parsed) {
    throw new Error('AI 未返回可解析的题目数组');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AI 未返回有效题目');
  }

  return parsed.map((item: any, index: number) => {
    if (!item?.content || !item?.answer) {
      throw new Error(`第 ${index + 1} 道题缺少 content 或 answer`);
    }

    return {
      title: sanitizePrompt(item.title || item.content.slice(0, 100)),
      content: sanitizePrompt(item.content),
      answer: sanitizePrompt(item.answer),
      explanation: item.explanation ? sanitizePrompt(item.explanation) : '',
      difficulty: ['easy', 'medium', 'hard'].includes(item.difficulty) ? item.difficulty : 'medium',
      tags: normalizeTagsInput(Array.isArray(item.tags) ? item.tags.map((tag: string) => sanitizePrompt(String(tag))) : []),
    };
  });
}

function applyTagAliasesToGeneratedQuestions(
  questions: Array<{
    title: string;
    content: string;
    answer: string;
    explanation?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    tags?: string[];
  }>,
  aliases: TagAliasMap
) {
  return questions.map((question) => ({
    ...question,
    tags: normalizeTagsInput(question.tags || [], aliases),
  }));
}

function extractJsonObject(result: string, errorMessage: string) {
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(errorMessage);
  }
  return JSON.parse(jsonMatch[0]);
}

async function getAccessibleQuestion(user: User, questionId: string) {
  const ownerId = getLibraryOwnerId(user);
  const question = await db.getQuestionByIdForUser(questionId, ownerId, user.role === 'admin');
  if (!question) {
    return null;
  }

  if (!hasCategoryScopeAccess(user, question.category_id)) {
    return null;
  }

  return question;
}

router.get('/status', authMiddleware, requirePermission('ai_use', '没有AI使用权限'), async (req: AuthRequest, res: Response) => {
  const userConfigs = await db.getAIConfigsByUserId(req.user!.id);
  const activeConfig = userConfigs.find(c => c.is_active);
  const availableModels = userConfigs.map(c => ({
    id: c.id,
    label: `${c.display_name || c.provider} · ${c.model}`,
    provider: c.provider,
    model: c.model,
    isActive: Boolean(c.is_active),
  }));
  
  res.json({
    enabled: await isAIEnabled(),
    defaultProvider: activeConfig?.display_name || activeConfig?.provider || config.ai.defaultProvider,
    defaultConfigId: activeConfig?.id,
    availableProviders: userConfigs.map(c => c.display_name || c.provider),
    availableModels,
  });
});

router.put('/settings', authMiddleware, requirePermission('system_manage', '没有系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiSettingsSchema.parse(req.body);
    
    if (data.enabled !== undefined) {
      await db.setSetting('ai_enabled', String(data.enabled));
    }
    
    res.json({
      enabled: await isAIEnabled(),
      defaultProvider: config.ai.defaultProvider,
      availableProviders: aiService.getAvailableProviders(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '更新AI设置失败' });
  }
});

router.get('/config', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const configs = await db.getAIConfigsByUserId(req.user!.id);
    res.json(configs.map(toPublicAIConfig));
  } catch (error) {
    res.status(500).json({ error: '获取AI配置失败' });
  }
});

router.get('/credentials', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  const credentials = await db.getAICredentialsByUserId(req.user!.id);
  res.json(credentials.map(toPublicAICredential));
});

router.post('/credentials', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiCredentialSchema.parse(req.body);
    const baseUrl = validateAIBaseUrl(data.baseUrl, req.user!, true);
    const apiKey = validateCredentialKey(baseUrl!, data.apiKey);
    const credential = await db.createAICredential({
      id: randomUUID(),
      user_id: req.user!.id,
      name: data.name,
      base_url: baseUrl!,
      api_key: apiKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.status(201).json(toPublicAICredential(credential));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(400).json({ error: (error as Error).message || '创建 API 凭据失败' });
  }
});

router.put('/credentials/:id', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiCredentialSchema.partial().parse(req.body);
    const existing = await db.getAICredentialByIdForUser(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'API 凭据不存在' });
      return;
    }
    const baseUrl = data.baseUrl !== undefined
      ? validateAIBaseUrl(data.baseUrl, req.user!, true)!
      : existing.base_url;
    const apiKey = data.apiKey !== undefined
      ? validateCredentialKey(baseUrl, data.apiKey)
      : existing.api_key;
    const updated = await db.updateAICredential(req.params.id, req.user!.id, {
      name: data.name,
      base_url: baseUrl,
      api_key: apiKey,
    });
    res.json(toPublicAICredential(updated!));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(400).json({ error: (error as Error).message || '更新 API 凭据失败' });
  }
});

router.delete('/credentials/:id', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  const result = await db.deleteAICredentialForUser(req.params.id, req.user!.id);
  if (result === 'missing') {
    res.status(404).json({ error: 'API 凭据不存在' });
    return;
  }
  if (result === 'in_use') {
    res.status(409).json({ error: '该凭据仍被模型配置使用，请先删除或切换相关模型' });
    return;
  }
  res.json({ message: 'API 凭据已删除' });
});

router.post('/models', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiModelsSchema.parse(req.body);
    let baseUrl = data.baseUrl;
    let apiKey = data.apiKey;
    let isCustom = data.isCustom;

    if (data.credentialId) {
      const credential = await db.getAICredentialByIdForUser(data.credentialId, req.user!.id);
      if (!credential) {
        res.status(404).json({ error: 'API 凭据不存在' });
        return;
      }
      baseUrl = credential.base_url;
      apiKey = credential.api_key;
      isCustom = true;
    }

    if (data.configId) {
      const existing = await db.getAIConfigByIdForUser(data.configId, req.user!.id);
      if (!existing) {
        res.status(404).json({ error: '配置不存在' });
        return;
      }
      baseUrl = baseUrl || getConfigBaseUrl(existing);
      apiKey = apiKey || existing.api_key;
      isCustom = isCustom ?? Boolean(existing.is_custom);
    }

    if (!baseUrl || !apiKey) {
      res.status(400).json({ error: '请先填写 API 地址和 API 密钥' });
      return;
    }

    const normalizedBaseUrl = validateAIBaseUrl(baseUrl, req.user!, Boolean(isCustom), 'runtime');
    const models = await fetchAIModels(normalizedBaseUrl!, apiKey);
    res.json({ models: models.map((id) => ({ id })) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: (error as Error).message || '获取模型列表失败' });
  }
});

router.post('/config/check-all', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const configs = await db.getAIConfigsByUserId(req.user!.id);
    // Keep a small concurrency cap so a slow provider does not block every
    // other model, while avoiding an unbounded burst against the upstream API.
    const results = new Array<Awaited<ReturnType<typeof markAIConfigModelStatus>>>(configs.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < configs.length) {
        const index = cursor++;
        results[index] = await markAIConfigModelStatus(configs[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, configs.length) }, worker));

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: '检查模型失败: ' + (error as Error).message });
  }
});

router.delete('/config/invalid', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const configs = await db.getAIConfigsByUserId(req.user!.id);
    const invalidConfigs = configs.filter((aiConfig) => aiConfig.model_status === 'invalid');
    let deleted = 0;

    for (const aiConfig of invalidConfigs) {
      if (await db.deleteAIConfigForUser(aiConfig.id, req.user!.id)) {
        deleted += 1;
      }
    }

    res.json({ deleted });
  } catch (error) {
    res.status(500).json({ error: '清除失效模型失败: ' + (error as Error).message });
  }
});

router.post('/config', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiConfigSchema.parse(req.body);
    const sourceConfig = data.sourceConfigId
      ? await db.getAIConfigByIdForUser(data.sourceConfigId, req.user!.id)
      : undefined;

    if (data.sourceConfigId && !sourceConfig) {
      res.status(404).json({ error: '来源配置不存在' });
      return;
    }

    const credential = data.credentialId
      ? await db.getAICredentialByIdForUser(data.credentialId, req.user!.id)
      : undefined;
    if (data.credentialId && !credential) {
      res.status(404).json({ error: 'API 凭据不存在' });
      return;
    }

    const nextBaseUrl = credential?.base_url || data.baseUrl || (sourceConfig ? getConfigBaseUrl(sourceConfig) : undefined);
    const nextApiKey = credential?.api_key || data.apiKey || sourceConfig?.api_key;

    if (!nextApiKey) {
      res.status(400).json({ error: '请填写 API 密钥，或选择一个已有自定义提供商复用密钥' });
      return;
    }

    const normalizedBaseUrl = validateAIBaseUrl(nextBaseUrl, req.user!, Boolean(data.isCustom));

    await db.run('UPDATE ai_configs SET is_active = 0 WHERE user_id = ?', [req.user!.id]);

    const aiConfig = await db.createAIConfig({
      id: randomUUID(),
      user_id: req.user!.id,
      provider: data.provider,
      display_name: data.displayName,
      base_url: normalizedBaseUrl,
      api_key: nextApiKey,
      model: data.model,
      is_active: true,
      is_custom: data.isCustom ? true : false,
      credential_id: credential?.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json(toPublicAIConfig(aiConfig));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '创建AI配置失败: ' + (error as Error).message });
  }
});

router.put('/config/:id', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = aiConfigSchema.partial().parse(req.body);
    const existing = await db.getAIConfigByIdForUser(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }
    
    const nextIsCustom = data.isCustom ?? existing.is_custom;
    const credential = data.credentialId
      ? await db.getAICredentialByIdForUser(data.credentialId, req.user!.id)
      : undefined;
    if (data.credentialId && !credential) {
      res.status(404).json({ error: 'API 凭据不存在' });
      return;
    }
    const nextBaseUrl = credential?.base_url || (data.baseUrl !== undefined
      ? validateAIBaseUrl(data.baseUrl, req.user!, Boolean(nextIsCustom))
      : existing.base_url);
    const credentialChanged = data.credentialId !== undefined && data.credentialId !== existing.credential_id;

    const updated = await db.updateAIConfig(req.params.id, {
      provider: data.provider,
      display_name: data.displayName,
      base_url: nextBaseUrl,
      api_key: credential?.api_key || data.apiKey,
      model: data.model,
      is_custom: data.isCustom,
      credential_id: data.isCustom === false ? '' : data.credentialId,
      model_status: data.model !== undefined || data.baseUrl !== undefined || data.apiKey !== undefined || credentialChanged ? 'unknown' : undefined,
      last_checked_at: data.model !== undefined || data.baseUrl !== undefined || data.apiKey !== undefined || credentialChanged ? '' : undefined,
      last_check_error: data.model !== undefined || data.baseUrl !== undefined || data.apiKey !== undefined || credentialChanged ? '' : undefined,
    });

    if (!updated) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }

    res.json(toPublicAIConfig(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '更新AI配置失败: ' + (error as Error).message });
  }
});

router.post('/config/:id/check', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const aiConfig = await db.getAIConfigByIdForUser(req.params.id, req.user!.id);
    if (!aiConfig) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }

    res.json(await markAIConfigModelStatus(aiConfig));
  } catch (error) {
    res.status(500).json({ error: '检查模型失败: ' + (error as Error).message });
  }
});

router.delete('/config/:id', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await db.deleteAIConfigForUser(req.params.id, req.user!.id);
    if (!deleted) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }
    res.json({ message: '配置已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除AI配置失败' });
  }
});

router.put('/config/:id/active', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const configs = await db.getAIConfigsByUserId(req.user!.id);
    const config = configs.find(c => c.id === req.params.id);
    
    if (!config) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }
    
    await db.run('UPDATE ai_configs SET is_active = 0 WHERE user_id = ?', [req.user!.id]);
    await db.run('UPDATE ai_configs SET is_active = 1 WHERE id = ?', [req.params.id]);
    
    res.json({ message: '已切换为当前使用的配置' });
  } catch (error) {
    res.status(500).json({ error: '设置活跃配置失败' });
  }
});

router.post('/analyze', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { questionId, provider } = req.body;
    
    if (!questionId || typeof questionId !== 'string') {
      res.status(400).json({ error: '无效的题目ID' });
      return;
    }

    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = sanitizePrompt(provider || userConfig?.id || config.ai.defaultProvider);
    
    console.log('AI Analyze request:', { questionId, provider, providerName, hasUserConfig: Boolean(userConfig) });

    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });
    
    const prompt = `请分析以下题目，提供详细的解题思路和知识点：

题目：${sanitizePrompt(question.title)}
内容：${sanitizePrompt(question.content)}
答案：${sanitizePrompt(question.answer)}

请提供：
1. 题目分析
2. 解题思路
3. 相关知识点
4. 易错点提示`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    console.error('AI Analyze error:', error);
    res.status(500).json({ error: 'AI分析失败: ' + (error as Error).message });
  }
});

router.post('/expand', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { questionId, provider } = req.body;
    
    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = provider || userConfig?.id || config.ai.defaultProvider;
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const prompt = `请扩展以下题目的答案，提供更详细的解释：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请提供更详细的答案解释，包括：
1. 详细解答过程
2. 相关概念解释
3. 实际应用场景`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'AI扩展失败: ' + (error as Error).message });
  }
});

router.post('/recommend', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { questionId, provider } = req.body;
    
    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = provider || userConfig?.id || config.ai.defaultProvider;
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const prompt = `基于以下题目，推荐相关的学习知识点：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请推荐：
1. 相关知识点
2. 学习资源建议
3. 练习建议`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'AI推荐失败: ' + (error as Error).message });
  }
});

router.post('/generate', authMiddleware, requirePermission('ai_generate', '没有AI生题权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { questionId, count, provider } = req.body;
    
    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = provider || userConfig?.id || config.ai.defaultProvider;
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const prompt = `请基于以下题目生成${count || 3}道类似的练习题：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

请生成${count || 3}道类似的题目，每道题包含：
1. 题目内容
2. 参考答案
3. 解析`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'AI生成失败: ' + (error as Error).message });
  }
});

router.post('/explain', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { concept, context, provider } = req.body;

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = provider || userConfig?.id || config.ai.defaultProvider;
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const prompt = context
      ? `请解释以下概念：${concept}

上下文：${context}

请提供详细的解释，包括定义、特点、应用场景等。`
      : `请解释以下概念：${concept}

请提供详细的解释，包括定义、特点、应用场景等。`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'AI解释失败: ' + (error as Error).message });
  }
});

router.post('/chat', authMiddleware, requirePermission('ai_chat', '没有AI对话权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { questionId, message, provider } = req.body;
    
    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = provider || userConfig?.id || config.ai.defaultProvider;
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const prompt = `关于以下题目，用户提出了一个问题，请详细回答：

题目：${question.title}
内容：${question.content}
答案：${question.answer}

用户问题：${message}

请提供详细、有帮助的回答。`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'AI对话失败: ' + (error as Error).message });
  }
});

router.post('/test-config', authMiddleware, requirePermission('ai_config_manage', '没有AI配置权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { configId } = req.body;
    
    const configs = await db.getAIConfigsByUserId(req.user!.id);
    const config = configs.find(c => c.id === configId);
    
    if (!config) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }

    const { OpenAICompatibleProvider } = await import('../services/ai.js');
    const baseUrl = validateAIBaseUrl(config.base_url || defaultBaseUrls[config.provider] || 'https://api.openai.com/v1', req.user!, Boolean(config.is_custom));
    const aiProvider = new OpenAICompatibleProvider(
      config.display_name || config.provider,
      config.api_key,
      config.model,
      baseUrl,
      90000
    );
    
    const testPrompt = '请回复"测试成功"';
    const result = await aiProvider.chat([{ role: 'user', content: testPrompt }]);
    await db.updateAIConfig(config.id, {
      model_status: 'valid',
      last_checked_at: new Date().toISOString(),
      last_check_error: '',
    });
    
    res.json({ success: true, message: '配置测试成功', result });
  } catch (error) {
    console.error('Config test error:', error);
    const errorMessage = (error as Error).message;
    
    if (errorMessage.includes('连接超时')) {
      res.status(500).json({ error: '配置测试失败：连接超时，请检查网络或API地址是否正确' });
    } else if (errorMessage.includes('连接被拒绝')) {
      res.status(500).json({ error: '配置测试失败：连接被拒绝，请检查API地址和端口' });
    } else if (errorMessage.includes('无法解析API地址')) {
      res.status(500).json({ error: '配置测试失败：无法解析API地址，请检查base_url是否正确' });
    } else if (errorMessage.includes('API error')) {
      res.status(500).json({ error: '配置测试失败：API密钥无效或模型名称错误' });
    } else {
      res.status(500).json({ error: '配置测试失败：' + errorMessage });
    }
  }
});

router.post('/batch-generate', authMiddleware, requirePermission('ai_generate', '没有AI生题权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = batchGenerateSchema.parse(req.body);
    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = sanitizePrompt(data.provider || userConfig?.id || config.ai.defaultProvider);
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });

    const modeInstructionMap: Record<'quick' | 'practice' | 'teaching', string> = {
      quick: [
        '生成模式：速记版',
        'answer 以关键词、短句或结论为主，优先控制在 1 到 2 行内，便于快速记忆。',
        'explanation 保持简短，只补充最必要的理解线索，不要展开长篇说明。',
      ].join('\n'),
      practice: [
        '生成模式：练习版',
        'answer 保持完整、准确、适中，尽量比速记版更具体，可补足关键定义、结论或步骤，适合日常刷题和复习。',
        'explanation 提供中等偏丰富的解析，可包含 2 到 4 个关键点，适当补充背景、常见误区或记忆提示，但整体不要像教学版那样过长。',
      ].join('\n'),
      teaching: [
        '生成模式：教学版',
        'answer 需要更完整具体，尽量分点表达，说明关键步骤、要点或组成部分。',
        'explanation 需要明显更详细，可补充背景、易错点、对比说明或记忆提示，帮助初学者理解。',
      ].join('\n'),
    };

    const prompt = `你是一个专业出题助手。请围绕主题“${sanitizePrompt(data.topic)}”生成 ${data.count} 道适合记忆背题的题目。

输出要求：
1. 只返回 JSON 数组，不要输出 markdown，不要输出解释文字
2. 每道题包含 title、content、answer、explanation、difficulty、tags
3. difficulty 只能是 easy、medium、hard
4. answer 要准确、精炼、适合背诵
5. explanation 用于快速理解和记忆
6. tags 必须是字符串数组，且每道题最多 5 个标签
7. 题目不要重复，尽量覆盖不同考点

附加条件：
- 目标难度：${data.difficulty === 'mixed' ? '混合难度，按 easy/medium/hard 合理分布' : data.difficulty}
- ${modeInstructionMap[data.mode]}
- 目标分类：${sanitizePrompt(data.categoryName || '未指定')}
- 额外要求：${sanitizePrompt(data.requirements || '无')}

返回格式示例：
[
  {
    "title": "HTTP 常见状态码",
    "content": "说出 200、301、404、500 的含义。",
    "answer": "200 成功；301 永久重定向；404 资源不存在；500 服务器内部错误。",
    "explanation": "这是最常见的一组 HTTP 状态码，适合记忆排障。",
    "difficulty": "easy",
    "tags": ["HTTP", "状态码"]
  }
]`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const questions = applyTagAliasesToGeneratedQuestions(extractGeneratedQuestions(result), tagAliases);

    res.json({ questions, raw: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    console.error('AI batch generate error:', error);
    res.status(500).json({ error: 'AI批量生题失败: ' + (error as Error).message });
  }
});

router.post('/polish-question', authMiddleware, requirePermission('ai_polish', '没有AI润色权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = polishQuestionSchema.parse(req.body);
    const question = await getAccessibleQuestion(req.user!, data.questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = sanitizePrompt(data.provider || userConfig?.id || config.ai.defaultProvider);
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));

    const polishInstructionMap: Record<'light' | 'deep', string> = {
      light: [
        '润色模式：轻润色。',
        '优先做轻量优化，减少大改。',
        '主要修正表达、结构、可读性和明显遗漏。',
        'answer 和 explanation 保持精炼，不要过度展开。',
      ].join('\n'),
      deep: [
        '润色模式：深润色。',
        '可以在不改变核心考点的前提下更充分优化题干、答案和解析。',
        'answer 可以更完整，必要时分点。',
        'explanation 可以补充关键原理、背景、易错点和记忆提示。',
      ].join('\n'),
    };

    const prompt = `请润色这道题，返回 JSON 对象，不要输出解释文字。

只返回字段：title、content、answer、explanation、difficulty、tags

规则：
1. 不改变核心考点
2. 优化题干表达与结构
3. answer 要更清晰完整，不能比原题更简略
4. explanation 补充关键原理、易错点或记忆提示，控制在精炼范围内
5. difficulty 只能是 easy、medium、hard
6. tags 最多 5 个
7. ${polishInstructionMap[data.mode]}

原题：
title: ${sanitizePrompt(question.title)}
content: ${sanitizePrompt(question.content)}
answer: ${sanitizePrompt(question.answer)}
explanation: ${sanitizePrompt(question.explanation || '')}
difficulty: ${sanitizePrompt(question.difficulty)}
tags: ${JSON.stringify(parseStoredTags(question.tags, tagAliases))}`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    const parsed = extractJsonObject(result, 'AI 未返回可解析的题目对象');
    const draft = {
      title: sanitizePrompt(parsed.title || question.title),
      content: sanitizePrompt(parsed.content || question.content),
      answer: sanitizePrompt(parsed.answer || question.answer),
      explanation: parsed.explanation ? sanitizePrompt(parsed.explanation) : '',
      difficulty: ['easy', 'medium', 'hard'].includes(parsed.difficulty) ? parsed.difficulty : question.difficulty,
      tags: normalizeTagsInput(Array.isArray(parsed.tags) ? parsed.tags : parseStoredTags(question.tags, tagAliases), tagAliases),
    };
    res.json({ question, draft, raw: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'AI题目润色失败: ' + (error as Error).message });
  }
});

router.post('/answer-drafts/raw', authMiddleware, requirePermission('ai_polish', '没有AI润色权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = rawAnswerDraftSchema.parse(req.body);
    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = sanitizePrompt(data.provider || userConfig?.id || config.ai.defaultProvider);
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const detail = data.mode === 'quick'
      ? '给出适合地铁速记的精炼答案，用 4 到 6 个短分句覆盖关键点；解析只写记忆提示。'
      : data.mode === 'teaching'
        ? '给出教学级完整答案，包含原理、步骤、边界和常见误区。'
        : '给出适合刷题核对的完整答案，解析补充判断依据和易错点。';
    const source = data.questions.map((question, index) => ({
      index,
      content: sanitizePrompt(question.content),
      difficulty: question.difficulty,
    }));
    const prompt = `请为下面的技术题批量生成答案草稿，只返回合法 JSON，不要输出说明文字。

要求：
1. 返回 {"questions": [...]}，数量和顺序必须与输入完全一致
2. 每项必须包含 content、answer、explanation、difficulty、tags
3. content 原样返回，answer 必须准确且可独立理解
4. tags 为 2 到 5 个短标签，不要使用“题目”“答案”等空泛词
5. ${detail}

输入：${JSON.stringify(source)}
`;
    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    const generated = applyTagAliasesToGeneratedQuestions(extractGeneratedQuestions(result), tagAliases);
    if (generated.length !== data.questions.length) {
      throw new Error(`AI 返回 ${generated.length} 项，预期 ${data.questions.length} 项`);
    }
    res.json({
      drafts: generated.map((draft, index) => ({
        clientId: data.questions[index].clientId,
        answer: draft.answer,
        explanation: draft.explanation || '',
        difficulty: draft.difficulty || data.questions[index].difficulty,
        tags: draft.tags || [],
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '题目格式无效', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'AI批量生成答案失败: ' + (error as Error).message });
  }
});

router.post('/answer-draft', authMiddleware, requirePermission('ai_polish', '没有AI润色权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = answerDraftSchema.parse(req.body);
    const question = await getAccessibleQuestion(req.user!, data.questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const userConfig = await db.getActiveAIConfig(req.user!.id);
    const providerName = sanitizePrompt(data.provider || userConfig?.id || config.ai.defaultProvider);
    const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const existingTags = parseStoredTags(question.tags, tagAliases);

    const modeInstructionMap: Record<'quick' | 'practice' | 'teaching', string> = {
      quick: [
        '答案版本：速记版。',
        'answer 必须短，但必须是一句或两句完整、能独立理解的话，不能只堆关键词。',
        'answer 必须严格按“原有限制/问题 + 解决方式/能力 + 最终效果/意义”的顺序组织，允许压缩表达，但三段信息都不能缺。',
        'answer 必须写成约 5 个短分句，优先用分号、顿号或逗号连接；不要明显少于 4 个，也不要明显多于 6 个，每个短分句都要承载有效信息，避免空泛概括。',
        'explanation 仅补一段很短的记忆提示，可为空，不要展开。',
      ].join('\n'),
      practice: [
        '答案版本：练习版。',
        'answer 保持完整、准确，适合刷题后直接对照，可按要点分行。',
        'explanation 提供适中的补充说明，突出关键步骤、判断依据或易错点，不要过长。',
      ].join('\n'),
      teaching: [
        '答案版本：教学版。',
        'answer 需要更完整清晰，适合给学生讲解，可分点表达，覆盖定义、关键步骤、原因或注意事项。',
        'explanation 需要比练习版更详细，可补充背景、对比、常见误区和记忆方法，但仍要围绕当前题目。',
      ].join('\n'),
    };

    const prompt = `请只为这道题生成新的答案草稿，返回 JSON 对象，不要输出任何解释文字。

要求：
1. 返回字段必须包含 answer、explanation、tags
2. 只允许改写答案和解析，不要改写题目标题、题干、分类和难度
3. 答案必须准确，且严格围绕当前题干作答，不要发散
4. explanation 用于辅助理解，可为空字符串
5. 不要参考原题已有答案和解析，不要改写、压缩或复述原答案；你需要仅根据题目标题和题干独立作答
6. tags 为字符串数组，返回 0 到 5 个最合适的标签
7. 如果原题没有标签，请主动生成 2 到 5 个高相关标签；如果原题已有标签，可保留或补充更合适的标签建议
8. 输出必须是合法 JSON 对象

${modeInstructionMap[data.mode]}

当前题目：
title: ${sanitizePrompt(question.title)}
content: ${sanitizePrompt(question.content)}
difficulty: ${sanitizePrompt(question.difficulty)}
existingTags: ${JSON.stringify(existingTags)}

返回示例：
{
  "answer": "示例答案",
  "explanation": "示例解析",
  "tags": ["tag1", "tag2"]
}`;

    const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
    const parsed = extractJsonObject(result, 'AI 未返回可解析的答案对象');
    const draft = {
      answer: sanitizePrompt(parsed.answer || question.answer),
      explanation: parsed.explanation ? sanitizePrompt(parsed.explanation) : '',
      tags: normalizeTagsInput(Array.isArray(parsed.tags) ? parsed.tags : existingTags, tagAliases),
      mode: data.mode,
    };

    res.json({ question, draft, raw: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'AI答案生成失败: ' + (error as Error).message });
  }
});

router.post(
  '/batch-tags',
  authMiddleware,
  requirePermission('question_batch_edit', '没有批量编辑题目权限'),
  requirePermission('ai_polish', '没有AI润色权限'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = batchTagsSchema.parse(req.body);
      const userConfig = await db.getActiveAIConfig(req.user!.id);
      const providerName = sanitizePrompt(data.provider || userConfig?.id || config.ai.defaultProvider);
      const aiProvider = await aiService.getProvider(providerName, { userId: req.user!.id, role: req.user!.role });
      const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
      const results: Array<{ questionId: string; tags: string[] }> = [];
      let updated = 0;

      for (const questionId of data.ids) {
        const question = await getAccessibleQuestion(req.user!, questionId);
        if (!question) {
          continue;
        }

        const existingTags = parseStoredTags(question.tags, tagAliases);
        const prompt = `请只为这道题生成标签建议，返回 JSON 对象，不要输出任何解释文字。

要求：
1. 返回字段必须包含 tags
2. tags 为字符串数组，返回 2 到 5 个最合适的标签
3. 标签要短、清晰、可复用，优先使用知识点、技术名词、场景词
4. 不要返回“题目”“答案”“练习”这类空泛标签
5. 如果已有标签不准确，可以给出更合适的新标签
6. 输出必须是合法 JSON 对象

当前题目：
title: ${sanitizePrompt(question.title)}
content: ${sanitizePrompt(question.content)}
answer: ${sanitizePrompt(question.answer)}
explanation: ${sanitizePrompt(question.explanation || '')}
difficulty: ${sanitizePrompt(question.difficulty)}
existingTags: ${JSON.stringify(existingTags)}

返回示例：
{
  "tags": ["tag1", "tag2", "tag3"]
}`;

        const result = await aiProvider.chat([{ role: 'user', content: prompt }]);
        const parsed = extractJsonObject(result, 'AI 未返回可解析的标签对象');
        const generatedTags = normalizeTagsInput(Array.isArray(parsed.tags) ? parsed.tags : [], tagAliases);
        if (generatedTags.length === 0) {
          continue;
        }

        const nextTags = data.mode === 'replace'
          ? generatedTags
          : normalizeTagsInput([...existingTags, ...generatedTags], tagAliases);

        const nextValue = JSON.stringify(nextTags);
        if (nextValue !== (question.tags || '[]')) {
          await db.updateQuestion(question.id, { tags: nextValue }, { actorId: req.user!.id, source: 'ai-tags', expectedRevision: question.revision });
          updated += 1;
        }

        results.push({ questionId: question.id, tags: nextTags });
      }

      res.json({
        updated,
        total: data.ids.length,
        message: `已为 ${updated} 道题目更新 AI 标签`,
        results,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: '输入验证失败', details: error.errors });
        return;
      }
      res.status(500).json({ error: 'AI批量生成标签失败: ' + (error as Error).message });
    }
  }
);

export default router;
