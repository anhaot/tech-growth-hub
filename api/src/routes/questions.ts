import { Router, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../database/index.js';
import { authMiddleware, AuthRequest, getLibraryOwnerId, hasCategoryScopeAccess, hasPermission, requirePermission } from '../middleware/auth.js';
import { Question, LearningProgress, PaginatedResult, QuestionFilter, TagSummary, TagHealthPair, TagHealthReport, User } from '../types/index.js';
import { normalizeTagName, normalizeTagsInput, parseStoredTags, parseTagAliasMap } from '../utils/tags.js';

import { scanDuplicates } from '../services/questionDuplicates.js';

const router = Router();
router.use(authMiddleware, requirePermission('question_view', '没有查看题目权限'));

function validateId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function levenshteinDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function simplifyTag(tag: string): string {
  return tag.replace(/[\s\-_./]/g, '');
}

const createQuestionSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  answer: z.string().max(50000).default(''),
  explanation: z.string().optional().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  categoryId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

const updateQuestionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).optional(),
  answer: z.string().max(50000).optional(),
  explanation: z.string().optional().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  categoryId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  source: z.enum(['edit', 'ai-polish', 'ai-answer']).optional(),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).min(1),
});

const batchTagsSchema = z.object({
  ids: z.array(z.string()).min(1),
  mode: z.enum(['add', 'remove', 'replace']),
  tags: z.array(z.string()).min(1),
});

const mergeDuplicateSchema = z.object({
  keepId: z.string().uuid(),
  removeId: z.string().uuid(),
}).refine((data) => data.keepId !== data.removeId, '不能将题目与自身合并');

const renameTagSchema = z.object({
  fromTag: z.string().min(1).max(100),
  toTag: z.string().min(1).max(100),
});

const deleteTagSchema = z.object({
  tagName: z.string().min(1).max(100),
});

const normalizeTagsSchema = z.object({});

function getAllowedCategoryIds(user: User): string[] | undefined {
  return user.user_type === 'integrated' && user.category_scopes.length > 0
    ? user.category_scopes
    : undefined;
}

async function ensureAccessibleCategory(user: User, ownerId: string, categoryId: string | null | undefined) {
  if (!categoryId) {
    if (!hasCategoryScopeAccess(user, null)) return { ok: false as const, status: 403, error: '不能操作未授权的无分类题目' };
    return { ok: true as const };
  }

  const category = await db.getCategoryById(categoryId);
  if (!category || category.user_id !== ownerId) {
    return { ok: false as const, status: 400, error: '分类不存在或不属于当前题库' };
  }

  if (!hasCategoryScopeAccess(user, categoryId)) {
    return { ok: false as const, status: 403, error: '没有该分类的操作权限' };
  }

  return { ok: true as const };
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

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pagination = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(1000).default(20),
    }).parse(req.query);
    const { page, pageSize } = pagination;
    const tagQuery = req.query.tags;
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const tags = typeof tagQuery === 'string'
      ? normalizeTagsInput(tagQuery, tagAliases)
      : Array.isArray(tagQuery)
        ? normalizeTagsInput(tagQuery, tagAliases)
        : [];
    const filter: QuestionFilter = {
      categoryId: req.query.categoryId as string,
      difficulty: req.query.difficulty as 'easy' | 'medium' | 'hard',
      keyword: req.query.keyword as string,
      tags,
    };
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const { questions, total } = await db.getQuestions(ownerId, page, pageSize, filter, allowedCategoryIds);
    
    const result: PaginatedResult<Question> = {
      data: questions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '分页参数无效', details: error.errors });
      return;
    }
    res.status(500).json({ error: '获取题目列表失败' });
  }
});

router.get('/tags', async (req: AuthRequest, res: Response) => {
  try {
    const filter = {
      categoryId: req.query.categoryId as string,
      difficulty: req.query.difficulty as 'easy' | 'medium' | 'hard',
      keyword: req.query.keyword as string,
    };

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const tags = await db.getQuestionTags(ownerId, filter, allowedCategoryIds);
    const result: TagSummary[] = tags;
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '获取标签失败' });
  }
});

router.get('/tags/health', requirePermission('tag_manage', '没有标签管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const tags = await db.getQuestionTags(ownerId, undefined, allowedCategoryIds);
    const aliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const lowFrequency = tags.filter((tag) => tag.count <= 1);
    const aliased = Object.entries(aliases).map(([alias, target]) => ({ alias, target }));
    const similarPairs: TagHealthPair[] = [];

    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const left = tags[i].name;
        const right = tags[j].name;
        const leftSimple = simplifyTag(left);
        const rightSimple = simplifyTag(right);

        let reason = '';
        if (leftSimple && leftSimple === rightSimple) {
          reason = '仅符号或空格不同';
        } else if (leftSimple.length >= 3 && rightSimple.length >= 3 && (leftSimple.includes(rightSimple) || rightSimple.includes(leftSimple))) {
          reason = '名称包含关系';
        } else if (Math.abs(left.length - right.length) <= 2 && levenshteinDistance(left, right) <= 2) {
          reason = '编辑距离较近';
        }

        if (reason) {
          similarPairs.push({ left, right, reason });
        }
      }
    }

    const report: TagHealthReport = {
      lowFrequency,
      aliased,
      similarPairs: similarPairs.slice(0, 20),
    };

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: '获取标签健康检查失败' });
  }
});

router.put('/tags/rename', requirePermission('tag_manage', '没有标签管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = renameTagSchema.parse(req.body);
    const fromTag = normalizeTagName(data.fromTag);
    const toTag = normalizeTagName(data.toTag);

    if (fromTag === toTag) {
      res.status(400).json({ error: '新旧标签不能相同' });
      return;
    }

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const questions = await db.getAllQuestions(ownerId, allowedCategoryIds);
    let updated = 0;

    for (const question of questions) {
      const parsedTags = parseStoredTags(question.tags);
      if (!parsedTags.includes(fromTag)) {
        continue;
      }

      const nextTags = Array.from(new Set(
        parsedTags
          .map((tag) => (tag === fromTag ? toTag : normalizeTagName(tag)))
          .filter(Boolean)
      ));
      await db.updateQuestion(question.id, { tags: JSON.stringify(nextTags) }, { actorId: req.user!.id, source: 'tags', expectedRevision: question.revision });
      updated += 1;
    }

    res.json({ updated, message: `已更新 ${updated} 道题目` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '重命名标签失败' });
  }
});

router.delete('/tags', requirePermission('tag_manage', '没有标签管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = deleteTagSchema.parse(req.body);
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const normalizedTagName = normalizeTagName(data.tagName);
    const questions = await db.getAllQuestions(ownerId, allowedCategoryIds);
    let updated = 0;

    for (const question of questions) {
      const parsedTags = parseStoredTags(question.tags);
      if (!parsedTags.includes(normalizedTagName)) {
        continue;
      }

      const nextTags = parsedTags.filter((tag) => tag !== normalizedTagName);
      await db.updateQuestion(question.id, { tags: JSON.stringify(nextTags) }, { actorId: req.user!.id, source: 'tags', expectedRevision: question.revision });
      updated += 1;
    }

    res.json({ updated, message: `已从 ${updated} 道题目中移除标签` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '删除标签失败' });
  }
});

router.post('/tags/normalize', requirePermission('tag_manage', '没有标签管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    normalizeTagsSchema.parse(req.body ?? {});
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const questions = await db.getAllQuestions(ownerId, allowedCategoryIds);
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    let updated = 0;

    for (const question of questions) {
      const normalizedTags = parseStoredTags(question.tags, tagAliases);
      const nextValue = JSON.stringify(normalizedTags);
      if (nextValue !== (question.tags || '[]')) {
        await db.updateQuestion(question.id, { tags: nextValue }, { actorId: req.user!.id, source: 'tags', expectedRevision: question.revision });
        updated += 1;
      }
    }

    res.json({ updated, message: `已规范化 ${updated} 道题目的标签` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '规范化标签失败' });
  }
});

router.post('/batch-tags', requirePermission('question_batch_edit', '没有批量编辑题目权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = batchTagsSchema.parse(req.body);
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const nextTagsInput = normalizeTagsInput(data.tags, tagAliases);
    let updated = 0;

    for (const id of data.ids) {
      const question = await getAccessibleQuestion(req.user!, id);
      if (!question) {
        continue;
      }

      const currentTags = parseStoredTags(question.tags, tagAliases);
      const resultTags = data.mode === 'add'
        ? normalizeTagsInput([...currentTags, ...nextTagsInput], tagAliases)
        : data.mode === 'remove'
          ? currentTags.filter((tag) => !nextTagsInput.includes(tag))
          : nextTagsInput;

      const nextValue = JSON.stringify(resultTags);
      if (nextValue !== (question.tags || '[]')) {
        await db.updateQuestion(question.id, { tags: nextValue }, { actorId: req.user!.id, source: 'tags', expectedRevision: question.revision });
        updated += 1;
      }
    }

    res.json({ updated, message: `已更新 ${updated} 道题目的标签` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '批量更新标签失败' });
  }
});

type ScanResult = Awaited<ReturnType<typeof scanDuplicates>>;
type ScanJob = { id: string; userId: string; scope: string; status: 'running' | 'completed' | 'failed'; processed: number; totalQuestions: number; createdAt: number; finishedAt?: number; result?: ScanResult };
const scanJobs = new Map<string, ScanJob>();
const scanScope = (user: User) => JSON.stringify([getLibraryOwnerId(user), getAllowedCategoryIds(user)]);
function cleanupScanJobs() {
  for (const [id, job] of scanJobs) if (Date.now() - (job.finishedAt || job.createdAt) > 15 * 60 * 1000 && job.status !== 'running') scanJobs.delete(id);
}
async function runScanJob(job: ScanJob, user: User) {
  try {
    const questions = await db.getAllQuestions(getLibraryOwnerId(user), getAllowedCategoryIds(user));
    job.totalQuestions = questions.length;
    job.result = await scanDuplicates(questions, (processed) => { job.processed = processed; });
    job.status = 'completed';
  } catch { job.status = 'failed'; }
  finally { job.finishedAt = Date.now(); }
}
function createScanJob(user: User): ScanJob | null {
  for (const [id, job] of scanJobs) if (job.userId === user.id && job.status !== 'running') scanJobs.delete(id);
  if (scanJobs.size >= 8) return null;
  const job: ScanJob = { id: randomUUID(), userId: user.id, scope: scanScope(user), status: 'running', processed: 0, totalQuestions: 0, createdAt: Date.now() };
  scanJobs.set(job.id, job);
  void runScanJob(job, user);
  return job;
}
router.post('/duplicates/scan', requirePermission('duplicate_manage', '没有查重权限'), async (req: AuthRequest, res: Response) => {
  cleanupScanJobs();
  const active = [...scanJobs.values()].find((job) => job.userId === req.user!.id && job.status === 'running');
  if (active) { res.json({ id: active.id }); return; }
  const job = createScanJob(req.user!);
  if (!job) { res.status(429).json({ error: '查重任务较多，请稍后重试' }); return; }
  res.status(202).json({ id: job.id });
});
router.get('/duplicates/scan/:jobId', requirePermission('duplicate_manage', '没有查重权限'), async (req: AuthRequest, res: Response) => {
  try {
    cleanupScanJobs();
    const job = scanJobs.get(req.params.jobId);
    if (!job || job.userId !== req.user!.id || job.scope !== scanScope(req.user!)) { res.status(404).json({ error: '查重任务不存在或已失效，请重新检查' }); return; }
    const { page, pageSize, memberPage } = z.object({ memberPage: z.coerce.number().int().min(1).default(1), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
    const result = job.result;
    res.json({ id: job.id, status: job.status, processed: job.processed, totalQuestions: job.totalQuestions,
      total: result?.total || 0, available: result?.pairs.length || 0, groupTotal: result?.groups.length || 0,
      pairs: result?.pairs.slice((page - 1) * pageSize, page * pageSize) || [], groups: result?.groups.slice((page - 1) * pageSize, page * pageSize).map((group) => ({ ...group, questions: group.questions.slice((memberPage - 1) * 20, memberPage * 20) })) || [], memberPage,
      truncated: result?.truncated || false, page, pageSize, totalPages: Math.ceil(Math.max(result?.pairs.length || 0, result?.groups.length || 0) / pageSize), comparisons: result?.comparisons || 0 });
  } catch (error) { res.status(error instanceof z.ZodError ? 400 : 500).json({ error: '获取查重结果失败' }); }
});
router.get('/duplicates/similar', requirePermission('duplicate_manage', '没有查重权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { page, pageSize } = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(50) }).parse(req.query);
    cleanupScanJobs();
    const active = [...scanJobs.values()].find((job) => job.userId === req.user!.id && job.scope === scanScope(req.user!) && job.status === 'running');
    const job = active || createScanJob(req.user!);
    if (!job) { res.status(429).json({ error: '查重任务较多，请稍后重试' }); return; }
    while (job.status === 'running') await new Promise((resolve) => setTimeout(resolve, 50));
    if (!job.result) { res.status(500).json({ error: '相似题查重失败' }); return; }
    const result = job.result;
    res.json({ total: result.total, pairs: result.pairs.slice((page - 1) * pageSize, page * pageSize), scanned: result.scanned, truncated: result.truncated, page, pageSize });
  } catch (error) { res.status(error instanceof z.ZodError ? 400 : 500).json({ error: '相似题查重失败' }); }
});

router.post('/duplicates/merge', requirePermission('duplicate_manage', '没有查重权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = mergeDuplicateSchema.parse(req.body);
    const keepQuestion = await getAccessibleQuestion(req.user!, data.keepId);
    const removeQuestion = await getAccessibleQuestion(req.user!, data.removeId);
    if (!keepQuestion || !removeQuestion) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    if (keepQuestion.user_id !== removeQuestion.user_id) { res.status(400).json({ error: '不能合并不同题库的题目' }); return; }
    if (!hasPermission(req.user, 'question_delete') || !hasPermission(req.user, 'question_edit_meta') || !hasPermission(req.user, 'question_edit_content')) { res.status(403).json({ error: '合并需要删除、内容和属性编辑权限' }); return; }
    const mergedTags = Array.from(new Set([...parseStoredTags(keepQuestion.tags), ...parseStoredTags(removeQuestion.tags)]));
    const keepExplanation = (keepQuestion.explanation || '').trim();
    const removeExplanation = (removeQuestion.explanation || '').trim();

    await db.updateQuestion(keepQuestion.id, {
      explanation: keepExplanation || removeExplanation || null,
      category_id: keepQuestion.category_id || removeQuestion.category_id,
      tags: JSON.stringify(mergedTags),
    }, { actorId: req.user!.id, source: 'merge', expectedRevision: keepQuestion.revision, removeId: removeQuestion.id });

    res.json({ message: '已合并题目并删除重复题', keepId: keepQuestion.id, removeId: removeQuestion.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '合并重复题失败' });
  }
});

router.get('/bookmarked', async (req: AuthRequest, res: Response) => {
  try {
    const mode = (req.query.mode as string) || 'study';
    const questions = await db.getBookmarkedQuestions(req.user!.id, mode);
    const ownerId = getLibraryOwnerId(req.user!);
    res.json(questions.filter((question) => question.user_id === ownerId && hasCategoryScopeAccess(req.user!, question.category_id)));
  } catch (error) {
    res.status(500).json({ error: '获取收藏题目失败' });
  }
});

router.get('/last-viewed', async (req: AuthRequest, res: Response) => {
  try {
    const mode = (req.query.mode as string) || 'study';
    const categoryId = req.query.categoryId as string | undefined;
    const progress = await db.getLastViewedQuestion(req.user!.id, mode, categoryId);
    const question = progress ? await getAccessibleQuestion(req.user!, progress.question_id) : null;
    res.json(question ? progress : null);
  } catch (error) {
    res.status(500).json({ error: '获取学习进度失败' });
  }
});

router.delete('/progress/reset', async (req: AuthRequest, res: Response) => {
  try {
    const cleared = await db.clearLearningProgress(req.user!.id);
    res.json({ cleared, message: `已清空 ${cleared} 条学习记录` });
  } catch (error) {
    res.status(500).json({ error: '清空学习记录失败' });
  }
});

router.delete('/clear-all', requirePermission('question_delete', '没有删题权限'), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    let deletedCount = 0;

    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      const questions = await db.getAllQuestions(ownerId, allowedCategoryIds);
      deletedCount = await db.deleteQuestions(questions.map((question) => question.id));
    } else {
      deletedCount = await db.clearAllQuestions(ownerId);
    }

    res.json({ message: `已清空 ${deletedCount} 道题目` });
  } catch (error) {
    res.status(500).json({ error: '清空题库失败' });
  }
});

router.get('/export', requirePermission('question_export', '没有导出权限'), async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId && !hasCategoryScopeAccess(req.user!, categoryId)) {
      res.status(403).json({ error: '没有该分类的导出权限' });
      return;
    }

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const first = await db.getQuestions(ownerId, 1, 1000, { categoryId }, allowedCategoryIds);
    const questions = [...first.questions];
    for (let page = 2; page <= Math.ceil(first.total / 1000); page++) {
      const batch = await db.getQuestions(ownerId, page, 1000, { categoryId }, allowedCategoryIds);
      questions.push(...batch.questions);
    }
    
    const exportData = questions.map(q => ({
      title: q.title,
      content: q.content,
      answer: q.answer,
      explanation: q.explanation,
      categoryId: q.category_id,
      difficulty: q.difficulty,
      tags: parseStoredTags(q.tags),
    }));
    
    res.json({ questions: exportData, total: exportData.length });
  } catch (error) {
    res.status(500).json({ error: '导出题目失败' });
  }
});

router.get('/position/:id', async (req: AuthRequest, res: Response) => {
  try {
    const tags = normalizeTagsInput(req.query.tags);
    const index = await db.getQuestionPosition(req.params.id, getLibraryOwnerId(req.user!), { categoryId: req.query.categoryId as string, tags }, getAllowedCategoryIds(req.user!));
    res.json({ index });
  } catch { res.status(500).json({ error: '获取题目位置失败' }); }
});

router.get('/:id/versions', async (req: AuthRequest, res: Response) => {
  try {
    if (!await getAccessibleQuestion(req.user!, req.params.id)) { res.status(404).json({ error: '题目不存在' }); return; }
    const { page, pageSize } = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const result = await db.getQuestionVersions(req.params.id, page, pageSize, getAllowedCategoryIds(req.user!));
    res.json({ ...result, page, pageSize, totalPages: Math.ceil(result.total / pageSize) });
  } catch (error) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ error: '获取版本历史失败' });
  }
});

router.post('/:id/versions/:version/restore', async (req: AuthRequest, res: Response) => {
  try {
    const version = z.coerce.number().int().min(1).parse(req.params.version);
    const { expectedRevision } = z.object({ expectedRevision: z.number().int().min(1) }).parse(req.body);
    const question = await getAccessibleQuestion(req.user!, req.params.id);
    if (!question) { res.status(404).json({ error: '题目不存在' }); return; }
    const record = await db.getQuestionVersion(question.id, version);
    if (!record) { res.status(404).json({ error: '版本不存在' }); return; }
    const snapshot = JSON.parse(record.snapshot) as Question;
    if (!hasPermission(req.user, 'question_edit_content') || !hasPermission(req.user, 'question_edit_meta')) { res.status(403).json({ error: '回退版本需要内容和属性编辑权限' }); return; }
    const categoryAccess = await ensureAccessibleCategory(req.user!, question.user_id, snapshot.category_id);
    if (!categoryAccess.ok) { res.status(categoryAccess.status).json({ error: categoryAccess.error }); return; }
    const updated = await db.updateQuestion(question.id, snapshot, { actorId: req.user!.id, source: `restore:${version}`, expectedRevision });
    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'QUESTION_CONFLICT') { res.status(409).json({ error: '题目已被修改，请刷新后再回退' }); return; }
    res.status(error instanceof z.ZodError ? 400 : 500).json({ error: '版本回退失败' });
  }
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!validateId(req.params.id)) {
      res.status(400).json({ error: '无效的题目ID' });
      return;
    }
    const question = await getAccessibleQuestion(req.user!, req.params.id);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }
    res.json(question);
  } catch (error) {
    res.status(500).json({ error: '获取题目失败' });
  }
});

router.post('/', requirePermission('question_create', '没有新增题目权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = createQuestionSchema.parse(req.body);
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const ownerId = getLibraryOwnerId(req.user!);
    const categoryAccess = await ensureAccessibleCategory(req.user!, ownerId, data.categoryId || null);
    if (!categoryAccess.ok) {
      res.status(categoryAccess.status).json({ error: categoryAccess.error });
      return;
    }

    const question = await db.createQuestion({
      id: randomUUID(),
      title: data.title,
      content: data.content,
      answer: data.answer,
      explanation: data.explanation || null,
      difficulty: data.difficulty,
      category_id: data.categoryId || null,
      user_id: ownerId,
      tags: JSON.stringify(normalizeTagsInput(data.tags || [], tagAliases)),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json(question);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '创建题目失败' });
  }
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!validateId(req.params.id)) {
      res.status(400).json({ error: '无效的题目ID' });
      return;
    }
    const data = updateQuestionSchema.parse(req.body);
    const question = await getAccessibleQuestion(req.user!, req.params.id);

    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    const nextTags = data.tags === undefined
      ? parseStoredTags(question.tags, tagAliases)
      : normalizeTagsInput(data.tags, tagAliases);
    const currentTags = parseStoredTags(question.tags, tagAliases);
    const contentChanged = (
      (data.title !== undefined && data.title !== question.title)
      || (data.content !== undefined && data.content !== question.content)
      || (data.answer !== undefined && data.answer !== question.answer)
      || (data.explanation !== undefined && data.explanation !== question.explanation)
    );
    const metaChanged = (
      (data.difficulty !== undefined && data.difficulty !== question.difficulty)
      || (data.categoryId !== undefined && (data.categoryId || null) !== question.category_id)
      || JSON.stringify(nextTags) !== JSON.stringify(currentTags)
    );

    if (contentChanged && !hasPermission(req.user, 'question_edit_content')) {
      res.status(403).json({ error: '没有编辑题目内容权限' });
      return;
    }
    if (metaChanged && !hasPermission(req.user, 'question_edit_meta')) {
      res.status(403).json({ error: '没有编辑题目属性权限' });
      return;
    }

    const nextCategoryId = data.categoryId !== undefined ? (data.categoryId || null) : question.category_id;
    const categoryAccess = await ensureAccessibleCategory(req.user!, question.user_id, nextCategoryId);
    if (!categoryAccess.ok) {
      res.status(categoryAccess.status).json({ error: categoryAccess.error });
      return;
    }

    const updateData: Partial<Question> = {
      title: data.title,
      content: data.content,
      answer: data.answer,
      explanation: data.explanation,
      difficulty: data.difficulty,
      category_id: data.categoryId === undefined ? undefined : (data.categoryId || null),
      tags: data.tags ? JSON.stringify(nextTags) : undefined,
    };

    const updatedQuestion = await db.updateQuestion(req.params.id, updateData, { actorId: req.user!.id, source: data.source || 'edit', expectedRevision: data.expectedRevision ?? question.revision });
    res.json(updatedQuestion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    if (error instanceof Error && error.message === 'QUESTION_CONFLICT') { res.status(409).json({ error: '题目已被修改，请刷新后再保存' }); return; }
    res.status(500).json({ error: '更新题目失败' });
  }
});

router.delete('/:id', requirePermission('question_delete', '没有删题权限'), async (req: AuthRequest, res: Response) => {
  try {
    if (!validateId(req.params.id)) {
      res.status(400).json({ error: '无效的题目ID' });
      return;
    }
    const question = await getAccessibleQuestion(req.user!, req.params.id);

    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    await db.deleteQuestion(req.params.id);
    res.json({ message: '题目已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除题目失败' });
  }
});

router.post('/batch-delete', requirePermission('question_delete', '没有删题权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = batchDeleteSchema.parse(req.body);
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedIds: string[] = [];

    for (const id of data.ids) {
      const question = await db.getQuestionByIdForUser(id, ownerId, req.user!.role === 'admin');
      if (!question || !hasCategoryScopeAccess(req.user!, question.category_id)) {
        continue;
      }
      allowedIds.push(id);
    }

    const deletedCount = await db.deleteQuestionsForUser(
      allowedIds,
      ownerId,
      req.user!.role === 'admin'
    );
    res.json({ message: `已删除 ${deletedCount} 道题目` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '批量删除失败' });
  }
});

router.post('/:id/progress', async (req: AuthRequest, res: Response) => {
  try {
    const { mode, isBookmarked } = z.object({ mode: z.enum(['study', 'quiz']).default('study'), isBookmarked: z.boolean().optional() }).parse(req.body);
    const questionId = req.params.id;

    const question = await getAccessibleQuestion(req.user!, questionId);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const progress: LearningProgress = {
      id: randomUUID(),
      user_id: req.user!.id,
      question_id: questionId,
      mode: mode || 'study',
      last_viewed_at: new Date().toISOString(),
      view_count: 0,
      is_bookmarked: isBookmarked || false,
    };

    const savedProgress = await db.upsertLearningProgress(progress, isBookmarked === undefined);
    res.json(savedProgress);
  } catch (error) {
    res.status(error instanceof z.ZodError ? 400 : 500).json({ error: '保存进度失败' });
  }
});

router.get('/:id/progress', async (req: AuthRequest, res: Response) => {
  try {
    const mode = (req.query.mode as string) || 'study';
    const question = await getAccessibleQuestion(req.user!, req.params.id);
    if (!question) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }
    const progress = await db.getLearningProgress(req.user!.id, req.params.id, mode);
    res.json(progress || null);
  } catch (error) {
    res.status(500).json({ error: '获取进度失败' });
  }
});

router.get('/navigate/:id/next', async (req: AuthRequest, res: Response) => {
  try {
    const currentId = req.params.id;
    const categoryId = req.query.categoryId as string;

    const currentQuestion = await getAccessibleQuestion(req.user!, currentId);
    if (!currentQuestion) {
      res.status(404).json({ error: '当前题目不存在' });
      return;
    }

    if (!hasCategoryScopeAccess(req.user!, categoryId || currentQuestion.category_id)) {
      res.status(403).json({ error: '没有该分类的访问权限' });
      return;
    }

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const nextQuestion = await db.getAdjacentQuestion(currentId, ownerId, 'next', { categoryId }, allowedCategoryIds);
    res.json({ nextQuestion });
  } catch (error) {
    res.status(500).json({ error: '获取下一题失败' });
  }
});

router.get('/navigate/:id/prev', async (req: AuthRequest, res: Response) => {
  try {
    const currentId = req.params.id;
    const categoryId = req.query.categoryId as string;

    const currentQuestion = await getAccessibleQuestion(req.user!, currentId);
    if (!currentQuestion) {
      res.status(404).json({ error: '当前题目不存在' });
      return;
    }

    if (!hasCategoryScopeAccess(req.user!, categoryId || currentQuestion.category_id)) {
      res.status(403).json({ error: '没有该分类的访问权限' });
      return;
    }

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const prevQuestion = await db.getAdjacentQuestion(currentId, ownerId, 'prev', { categoryId }, allowedCategoryIds);
    res.json({ prevQuestion });
  } catch (error) {
    res.status(500).json({ error: '获取上一题失败' });
  }
});

router.get('/navigate/random', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = req.query.categoryId as string;
    if (categoryId && !hasCategoryScopeAccess(req.user!, categoryId)) {
      res.status(403).json({ error: '没有该分类的访问权限' });
      return;
    }

    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = getAllowedCategoryIds(req.user!);
    const first = await db.getQuestions(ownerId, 1, 1, { categoryId }, allowedCategoryIds);
    if (!first.total) { res.json({ randomQuestion: null }); return; }
    const selected = await db.getQuestions(ownerId, Math.floor(Math.random() * first.total) + 1, 1, { categoryId }, allowedCategoryIds);
    res.json({ randomQuestion: selected.questions[0] || null });
  } catch (error) {
    res.status(500).json({ error: '获取随机题目失败' });
  }
});

export default router;
