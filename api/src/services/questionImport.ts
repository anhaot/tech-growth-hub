import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { db } from '../database/index.js';
import { getLibraryOwnerId, hasCategoryScopeAccess, hasPermission } from '../middleware/auth.js';
import { User } from '../types/index.js';

export type ImportFormat = 'csv' | 'json' | 'markdown' | 'text';
export interface ImportQuestion {
  title: string; content: string; answer: string; explanation: string;
  difficulty: 'easy' | 'medium' | 'hard'; categoryId: string | null; categoryName?: string;
}
export interface ImportRow { row: number; question?: ImportQuestion; error?: string; warnings: string[] }
export class ImportInputError extends Error {}
export const MAX_IMPORT_ROWS = 10000;
const categoryNameSchema = z.string().trim().min(1, '分类名称不能为空').max(100, '分类名称不能超过 100 字');
function portableRecords(parsed: Record<string, unknown>): unknown[] {
  const bundle = z.object({
    formatVersion: z.literal(2),
    categories: z.array(z.object({ id: z.string().trim().min(1).max(100), name: categoryNameSchema })).max(1000),
    questions: z.array(z.unknown()).max(MAX_IMPORT_ROWS),
  }).safeParse(parsed);
  if (!bundle.success) throw new ImportInputError('带分类 JSON 格式错误：需要 formatVersion: 2、categories（id/name）和 questions 数组');
  const names = new Map<string, string>();
  const uniqueNames = new Set<string>();
  for (const category of bundle.data.categories) {
    if (names.has(category.id) || uniqueNames.has(category.name)) throw new ImportInputError('文件中的分类 ID 或名称重复');
    names.set(category.id, category.name); uniqueNames.add(category.name);
  }
  return bundle.data.questions.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    const question = record as Record<string, unknown>;
    if (question.categoryId == null || question.categoryId === '') {
      return { ...question, categoryId: null, categoryName: undefined };
    }
    if (typeof question.categoryId !== 'string' || !names.has(question.categoryId)) {
      throw new ImportInputError(`第 ${index + 1} 道题引用了文件中不存在的分类`);
    }
    return { ...question, categoryId: null, categoryName: names.get(question.categoryId) };
  });
}
const schema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(500, '标题不能超过 500 字'),
  content: z.string().refine(value => value.trim().length > 0, '题目内容不能为空'),
  answer: z.string().max(50000, '答案不能超过 50000 字'),
  explanation: z.string(), categoryId: z.string().nullable(),
});
function difficulty(value: unknown) {
  if (value == null || value === '') return { value: 'medium' as const };
  const key = typeof value === 'string' ? value.toLowerCase().trim() : '';
  const levels: Record<string, ImportQuestion['difficulty']> = { easy: 'easy', 简单: 'easy', medium: 'medium', 中等: 'medium', hard: 'hard', 困难: 'hard' };
  const mapped = Object.hasOwn(levels, key) ? levels[key] : undefined;
  return mapped ? { value: mapped } : { value: 'medium' as const, warning: '无法识别难度，已设为中等' };
}
function markdownRecords(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let current: Record<string, string> | null = null;
  let section = 'content';
  let fence = '';
  const save = () => { if (current) records.push(current); current = null; section = 'content'; };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    const marker = trimmed.match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      if (current) current[section] += (current[section] ? '\n' : '') + line;
      continue;
    }
    if (!fence && /^\*\*.+\*\*$/.test(trimmed)) {
      save(); current = { title: trimmed.slice(2, -2), content: '', answer: '', explanation: '', difficulty: '' }; continue;
    }
    if (!current) continue;
    const header = !fence && trimmed.match(/^(答案|解析)[：:]\s*(.*)$/);
    if (header) { section = header[1] === '答案' ? 'answer' : 'explanation'; current[section] += (current[section] ? '\n' : '') + header[2]; continue; }
    const metadata = !fence && trimmed.match(/^(标签|难度)[：:]\s*(.*)$/);
    // Skip retired tag metadata in legacy Markdown, while preserving fenced code.
    if (metadata) { if (metadata[1] === '难度') current.difficulty = metadata[2]; continue; }
    current[section] += (current[section] ? '\n' : '') + line;
  }
  save();
  return records.map(record => ({ ...record, content: String(record.content).trim() || record.title, answer: String(record.answer).trim(), explanation: String(record.explanation).trim() }));
}
export function parseImportRecords(format: ImportFormat, input: unknown): unknown[] {
  try {
    let records: unknown;
    if (format === 'csv') records = parse(String(input).replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true });
    else if (format === 'markdown') records = markdownRecords(String(input));
    else if (format === 'json') {
      const parsed = JSON.parse(String(input).replace(/^\uFEFF/, ''));
      if (parsed && !Array.isArray(parsed) && (parsed.formatVersion === 2 || Object.hasOwn(parsed, 'categories'))) {
        records = portableRecords(parsed);
      } else records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [parsed];
    } else records = input;
    if (!Array.isArray(records) || !records.length) throw new ImportInputError('没有识别到题目，请检查文件格式');
    if (records.length > MAX_IMPORT_ROWS) throw new ImportInputError(`一次最多导入 ${MAX_IMPORT_ROWS} 道题，请拆分文件`);
    return records;
  } catch (error) {
    if (error instanceof ImportInputError) throw error;
    throw new ImportInputError('文件无法解析：' + (error as Error).message);
  }
}
export async function validateImportCategory(user: User, ownerId: string, categoryId: string | null) {
  if (!categoryId) return hasCategoryScopeAccess(user, null) ? undefined : '导入题目必须选择已授权分类';
  const category = await db.getCategoryById(categoryId);
  if (!category || category.user_id !== ownerId) return '分类不存在或不属于当前题库';
  return hasCategoryScopeAccess(user, categoryId) ? undefined : '没有该分类的导入权限';
}
export function canCreateImportCategory(user: User): boolean {
  return hasPermission(user, 'category_manage')
    && (user.role === 'admin' || user.user_type !== 'integrated' || !user.category_scopes.length);
}
export async function resolveImportCategoryName(user: User, name: string): Promise<string | null> {
  const categories = (await db.getCategoriesByUserId(getLibraryOwnerId(user)))
    .filter(category => category.parent_id === null && category.name === name);
  if (categories.length > 1) throw new Error(`存在多个同名顶层分类“${name}”，请先整理或指定目标分类`);
  if (categories.length) {
    if (!hasCategoryScopeAccess(user, categories[0].id)) throw new Error('没有该分类的导入权限');
    return categories[0].id;
  }
  if (!canCreateImportCategory(user)) throw new Error(`缺少分类“${name}”：需要分类管理权限，且不能超出分类授权范围`);
  return null;
}
export async function prepareImport(user: User, format: ImportFormat, input: unknown, targetCategory: unknown): Promise<ImportRow[]> {
  if (targetCategory != null && typeof targetCategory !== 'string') throw new ImportInputError('分类 ID 格式错误');
  const records = parseImportRecords(format, input);
  const categories = new Map<string | null, string | undefined>();
  const namedCategories = new Map<string, string | null>();
  const rows: ImportRow[] = [];
  for (const [index, record] of records.entries()) {
    const row: ImportRow = { row: index + (format === 'csv' ? 2 : 1), warnings: [] };
    try {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('题目必须是对象');
      const q = record as Record<string, unknown>;
      const content = q.content ?? q.内容 ?? '';
      const answer = q.answer ?? q.答案 ?? '';
      if ((format === 'csv' || format === 'text') && (typeof answer !== 'string' || !answer.trim())) throw new Error('题目内容或答案不能为空');
      const data = schema.parse({
        title: q.title || q.标题 || (typeof content === 'string' ? content.slice(0, 100) : ''),
        content, answer, explanation: q.explanation ?? q.解析 ?? '',
        categoryId: targetCategory || q.categoryId || q.category_id || q.分类ID || null,
      });
      const level = difficulty(q.difficulty ?? q.难度);
      if (level.warning) row.warnings.push(level.warning);
      if (!data.answer.trim()) row.warnings.push('答案为空');
      const categoryName = !targetCategory && q.categoryName != null ? categoryNameSchema.parse(q.categoryName) : undefined;
      if (categoryName) {
        if (!namedCategories.has(categoryName)) namedCategories.set(categoryName, await resolveImportCategoryName(user, categoryName));
        row.question = { ...data, categoryId: namedCategories.get(categoryName)!, categoryName, difficulty: level.value };
      } else {
        if (!categories.has(data.categoryId)) categories.set(data.categoryId, await validateImportCategory(user, getLibraryOwnerId(user), data.categoryId));
        const categoryError = categories.get(data.categoryId);
        if (categoryError) throw new Error(categoryError);
        row.question = { ...data, difficulty: level.value };
      }
    } catch (error) {
      row.error = error instanceof z.ZodError ? error.errors.map(item => item.message).join('；') : (error as Error).message;
    }
    rows.push(row);
    if (index % 100 === 99) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return rows;
}
