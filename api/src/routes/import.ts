import { Router, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../database/index.js';
import { authMiddleware, AuthRequest, getLibraryOwnerId, requirePermission } from '../middleware/auth.js';
import { ImportResult, User } from '../types/index.js';
import { ImportFormat, ImportInputError, ImportRow, prepareImport, validateImportCategory, MAX_IMPORT_ROWS } from '../services/questionImport.js';

const router = Router();
const extensions: Record<Exclude<ImportFormat, 'text'>, string[]> = { csv: ['.csv'], json: ['.json'], markdown: ['.md', '.markdown', '.txt'] };
const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, callback) => {
  const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
  if (!Object.values(extensions).flat().includes(extension)) { callback(new ImportInputError('仅支持 csv、json、md、markdown、txt 文件')); return; }
  callback(null, true);
} });
const fileUpload = (req: AuthRequest, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) { res.status(400).json({ error: error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 10 MB' : (error as Error).message }); return; }
    next();
  });
};
router.use(authMiddleware, requirePermission('import_manage', '没有导入权限'));
interface Preview {
  id: string; userId: string; scope: string; expiresAt: number;
  rows: ImportRow[]; state: 'preparing' | 'ready' | 'committing' | 'complete'; result?: ImportResult & { skipped: number };
}
const previews = new Map<string, Preview>();
const PREVIEW_TTL = 15 * 60 * 1000;
function scope(user: User) { return JSON.stringify([user.role, user.user_type, getLibraryOwnerId(user), [...user.category_scopes].sort(), user.permissions]); }
function purgePreviews() { for (const [id, preview] of previews) if (preview.state !== 'committing' && preview.expiresAt <= Date.now()) previews.delete(id); }
const cleanup = setInterval(purgePreviews, 60000); cleanup.unref();
function readInput(req: AuthRequest, format: ImportFormat) {
  if (format === 'text') return req.body.questions;
  if (!req.file) throw new ImportInputError('请上传文件');
  const extension = req.file.originalname.slice(req.file.originalname.lastIndexOf('.')).toLowerCase();
  if (!extensions[format].includes(extension)) throw new ImportInputError('文件扩展名与所选格式不一致');
  return fs.readFileSync(req.file.path, 'utf-8');
}
function sendError(res: Response, error: unknown) {
  if (!(error instanceof ImportInputError)) console.error('Import error:', error);
  res.status(error instanceof ImportInputError ? 400 : 500).json({ error: error instanceof ImportInputError ? error.message : '导入失败，请重试' });
}
function removeUpload(req: AuthRequest) { if (req.file) fs.rmSync(req.file.path, { force: true }); }
async function importRows(user: User, rows: ImportRow[], excluded = new Set<number>()): Promise<ImportResult & { skipped: number }> {
  const result = { success: 0, failed: 0, skipped: 0, errors: [] as ImportResult['errors'] };
  const ownerId = getLibraryOwnerId(user);
  const categories = new Map<string | null, string | undefined>();
  for (const row of rows) {
    if (!row.question) { result.failed++; result.errors.push({ row: row.row, error: row.error || '题目格式错误' }); continue; }
    if (excluded.has(row.row)) { result.skipped++; continue; }
    try {
      const q = row.question;
      if (!categories.has(q.categoryId)) categories.set(q.categoryId, await validateImportCategory(user, ownerId, q.categoryId));
      const error = categories.get(q.categoryId);
      if (error) throw new Error(error);
      const now = new Date().toISOString();
      await db.createQuestion({ id: randomUUID(), title: q.title, content: q.content, answer: q.answer, explanation: q.explanation || null,
        difficulty: q.difficulty, category_id: q.categoryId, user_id: ownerId, tags: JSON.stringify(q.tags), created_at: now, updated_at: now });
      result.success++;
    } catch (error) { result.failed++; result.errors.push({ row: row.row, error: (error as Error).message }); }
    if ((result.success + result.failed) % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return result;
}
function previewPage(preview: Preview, page = 1) {
  const valid = preview.rows.filter(row => !!row.question).length;
  return { id: preview.id, expiresAt: new Date(preview.expiresAt).toISOString(), total: preview.rows.length, valid, invalid: preview.rows.length - valid,
    page, pageSize: 20, totalPages: Math.ceil(preview.rows.length / 20), rows: preview.rows.slice((page - 1) * 20, page * 20) };
}
function findPreview(req: AuthRequest, res: Response): Preview | undefined {
  purgePreviews();
  const preview = previews.get(req.params.id);
  if (!preview || preview.userId !== req.user!.id) { res.status(404).json({ error: '预览已失效，请重新解析预览' }); return; }
  if (preview.scope !== scope(req.user!)) { res.status(409).json({ error: '题库授权已变化，请重新解析预览' }); return; }
  return preview;
}
for (const format of ['csv', 'json', 'markdown', 'text'] as const) {
  router.post(`/preview/${format}`, ...(format === 'text' ? [] : [fileUpload]), async (req: AuthRequest, res: Response) => {
    let preview: Preview | undefined;
    try {
      purgePreviews();
      for (const [id, item] of previews) if (item.userId === req.user!.id && item.state !== 'committing' && item.state !== 'preparing') previews.delete(id);
      if (previews.size >= 8) { res.status(429).json({ error: '预览任务较多，请稍后重试' }); return; }
      preview = { id: randomUUID(), userId: req.user!.id, scope: scope(req.user!), expiresAt: Date.now() + PREVIEW_TTL, rows: [], state: 'preparing' };
      previews.set(preview.id, preview);
      preview.rows = await prepareImport(req.user!, format, readInput(req, format), req.body.categoryId);
      preview.state = 'ready'; preview.expiresAt = Date.now() + PREVIEW_TTL;
      res.json(previewPage(preview));
    } catch (error) { if (preview) previews.delete(preview.id); sendError(res, error); }
    finally { removeUpload(req); }
  });
  // Keep existing integrations compatible; the UI uses the two-step preview flow.
  router.post(`/${format}`, ...(format === 'text' ? [] : [fileUpload]), async (req: AuthRequest, res: Response) => {
    try { res.json(await importRows(req.user!, await prepareImport(req.user!, format, readInput(req, format), req.body.categoryId))); }
    catch (error) { sendError(res, error); }
    finally { removeUpload(req); }
  });
}
router.get('/preview/:id', (req: AuthRequest, res: Response) => {
  const preview = findPreview(req, res); if (!preview) return;
  if (preview.state !== 'ready') { res.status(409).json({ error: '预览正在导入或已完成，请重新解析' }); return; }
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > Math.ceil(preview.rows.length / 20)) { res.status(400).json({ error: '页码无效' }); return; }
  res.json(previewPage(preview, page));
});
router.post('/preview/:id/commit', async (req: AuthRequest, res: Response) => {
  const preview = findPreview(req, res); if (!preview) return;
  if (preview.result) { res.json(preview.result); return; }
  if (preview.state !== 'ready') { res.status(409).json({ error: '正在处理，请勿重复提交' }); return; }
  const parsed = z.object({ excludedRows: z.array(z.number().int().positive()).max(MAX_IMPORT_ROWS).default([]) }).safeParse(req.body);
  const validRows = new Set(preview.rows.filter(row => row.question).map(row => row.row));
  if (!parsed.success || parsed.data.excludedRows.some(row => !validRows.has(row))) { res.status(400).json({ error: '排除题目编号无效' }); return; }
  const excluded = new Set(parsed.data.excludedRows);
  if (!preview.rows.some(row => row.question && !excluded.has(row.row))) { res.status(400).json({ error: '请至少选择一道有效题目' }); return; }
  preview.state = 'committing';
  preview.result = await importRows(req.user!, preview.rows, excluded);
  preview.state = 'complete'; preview.rows = []; preview.expiresAt = Date.now() + PREVIEW_TTL;
  res.json(preview.result);
});
export default router;
