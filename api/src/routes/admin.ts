import { Router, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { db, DatabaseManager } from '../database/index.js';
import {
  authMiddleware,
  adminMiddleware,
  AuthRequest,
  getLibraryOwnerId,
  requirePermission,
  getSessionLifetime,
} from '../middleware/auth.js';
import { parseSessionLifetime } from '../utils/sessionLifetime.js';
import { DatabaseProfile, DatabaseValidationReport, DatabaseTableCountSummary, UserPermissions } from '../types/index.js';
import { parseTagAliasMap } from '../utils/tags.js';
import {
  buildDatabaseConnectionConfig,
  readDatabaseRuntimeState,
  sanitizeDatabaseProfile,
  writeDatabaseRuntimeState,
} from '../config/databaseRuntime.js';

const router = Router();

const updateSettingSchema = z.object({
  value: z.string().max(1000),
});

const permissionsSchema = z.object({
  question_view: z.boolean(),
  question_create: z.boolean(),
  question_edit_content: z.boolean(),
  question_edit_meta: z.boolean(),
  question_delete: z.boolean(),
  question_batch_edit: z.boolean(),
  category_view: z.boolean(),
  category_manage: z.boolean(),
  import_manage: z.boolean(),
  question_export: z.boolean(),
  ai_use: z.boolean(),
  ai_generate: z.boolean(),
  ai_config_manage: z.boolean(),
  ai_chat: z.boolean(),
  tag_manage: z.boolean(),
  duplicate_manage: z.boolean(),
  backup_export: z.boolean(),
  backup_restore: z.boolean(),
  ai_polish: z.boolean(),
  system_manage: z.boolean(),
  user_manage: z.boolean(),
});

const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email().max(100),
  password: z.string().min(9).max(100).regex(/[a-zA-Z]/, '密码必须包含字母').regex(/[0-9]/, '密码必须包含数字'),
  role: z.enum(['admin', 'user']).default('user'),
  userType: z.enum(['independent', 'integrated']).default('independent'),
  libraryOwnerId: z.string().uuid().nullable().optional(),
  categoryScopes: z.array(z.string().uuid()).optional(),
  permissions: permissionsSchema.optional(),
});

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().max(100).optional(),
  password: z.string().min(9).max(100).regex(/[a-zA-Z]/, '密码必须包含字母').regex(/[0-9]/, '密码必须包含数字').optional(),
  role: z.enum(['admin', 'user']).optional(),
  userType: z.enum(['independent', 'integrated']).optional(),
  libraryOwnerId: z.string().uuid().nullable().optional(),
  categoryScopes: z.array(z.string().uuid()).optional(),
  permissions: permissionsSchema.optional(),
});

const databaseProfileSchema = z.object({
  name: z.string().min(2).max(50),
  type: z.enum(['sqlite', 'mysql']),
  sqlite: z.object({
    path: z.string().min(1).max(500),
  }).optional(),
  mysql: z.object({
    host: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
    user: z.string().min(1).max(255),
    password: z.string().max(255).optional(),
    database: z.string().min(1).max(255),
  }).optional(),
});

const migrationSchema = z.object({
  overwrite: z.boolean().optional(),
});

const backupRestoreSchema = z.object({
  dataset: z.object({
    users: z.array(z.object({
      id: z.string().uuid(),
      username: z.string().min(1),
      email: z.string().min(1),
      password_hash: z.string().min(1),
      role: z.enum(['admin', 'user']),
    }).passthrough()).min(1).refine((users) => users.some((user) => user.role === 'admin'), '备份必须包含管理员账户'),
    categories: z.array(z.record(z.unknown())).optional(),
    questions: z.array(z.record(z.unknown())).optional(),
    question_versions: z.array(z.record(z.unknown())).optional(),
    learning_progress: z.array(z.record(z.unknown())).optional(),
    review_states: z.array(z.record(z.unknown())).optional(),
    review_events: z.array(z.record(z.unknown())).optional(),
    ai_credentials: z.array(z.record(z.unknown())).optional(),
    ai_configs: z.array(z.record(z.unknown())).optional(),
    system_settings: z.array(z.record(z.unknown())).optional(),
  }),
});

const DEFAULT_USER_PERMISSIONS: UserPermissions = {
  question_view: true,
  question_create: true,
  question_edit_content: true,
  question_edit_meta: true,
  question_delete: true,
  question_batch_edit: true,
  category_view: true,
  category_manage: true,
  import_manage: true,
  question_export: true,
  ai_use: true,
  ai_generate: true,
  ai_config_manage: true,
  ai_chat: true,
  tag_manage: true,
  duplicate_manage: true,
  backup_export: false,
  backup_restore: false,
  ai_polish: true,
  system_manage: false,
  user_manage: false,
};

const ADMIN_PERMISSIONS: UserPermissions = {
  question_view: true,
  question_create: true,
  question_edit_content: true,
  question_edit_meta: true,
  question_delete: true,
  question_batch_edit: true,
  category_view: true,
  category_manage: true,
  import_manage: true,
  question_export: true,
  ai_use: true,
  ai_generate: true,
  ai_config_manage: true,
  ai_chat: true,
  tag_manage: true,
  duplicate_manage: true,
  backup_export: true,
  backup_restore: true,
  ai_polish: true,
  system_manage: true,
  user_manage: true,
};

function validateId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function getDatabaseProfileOrThrow(profileId: string): DatabaseProfile {
  const runtimeState = readDatabaseRuntimeState();
  const profile = runtimeState.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error('PROFILE_NOT_FOUND');
  }
  return profile;
}

function mergeDatabaseProfileInput(
  input: z.infer<typeof databaseProfileSchema>,
  existingProfile?: DatabaseProfile
): DatabaseProfile {
  const now = new Date().toISOString();
  const nextType = input.type;

  return {
    id: existingProfile?.id || randomUUID(),
    name: input.name.trim(),
    type: nextType,
    sqlite: {
      path: nextType === 'sqlite'
        ? (input.sqlite?.path?.trim() || existingProfile?.sqlite?.path || './data/tech-growth-hub.db')
        : (existingProfile?.sqlite?.path || './data/tech-growth-hub.db'),
    },
    mysql: {
      host: nextType === 'mysql'
        ? (input.mysql?.host?.trim() || existingProfile?.mysql?.host || 'localhost')
        : (existingProfile?.mysql?.host || 'localhost'),
      port: nextType === 'mysql'
        ? Number(input.mysql?.port || existingProfile?.mysql?.port || 3306)
        : (existingProfile?.mysql?.port || 3306),
      user: nextType === 'mysql'
        ? (input.mysql?.user?.trim() || existingProfile?.mysql?.user || 'root')
        : (existingProfile?.mysql?.user || 'root'),
      password: nextType === 'mysql'
        ? (input.mysql?.password !== undefined && input.mysql.password !== ''
            ? input.mysql.password
            : existingProfile?.mysql?.password || '')
        : (existingProfile?.mysql?.password || ''),
      database: nextType === 'mysql'
        ? (input.mysql?.database?.trim() || existingProfile?.mysql?.database || 'tech_growth_hub')
        : (existingProfile?.mysql?.database || 'tech_growth_hub'),
    },
    created_at: existingProfile?.created_at || now,
    updated_at: now,
  };
}

async function testDatabaseConnection(profile: DatabaseProfile): Promise<void> {
  if (profile.type === 'sqlite') {
    const dbFile = profile.sqlite?.path || './data/tech-growth-hub.db';
    const sqlite = new Database(dbFile);
    sqlite.pragma('foreign_keys = ON');
    sqlite.prepare('SELECT 1').get();
    sqlite.close();
    return;
  }

  const pool = mysql.createPool({
    host: profile.mysql?.host || 'localhost',
    port: profile.mysql?.port || 3306,
    user: profile.mysql?.user || 'root',
    password: profile.mysql?.password || '',
    database: profile.mysql?.database || 'tech_growth_hub',
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
  });
  await pool.execute('SELECT 1');
  await pool.end();
}

async function connectTargetDatabase(profile: DatabaseProfile): Promise<DatabaseManager> {
  const targetDb = new DatabaseManager(buildDatabaseConnectionConfig(profile), { skipDefaultAdmin: true });
  await targetDb.connect();
  return targetDb;
}

function buildValidationReport(source: Awaited<ReturnType<typeof db.getTableCounts>>, target: Awaited<ReturnType<typeof db.getTableCounts>>): DatabaseValidationReport {
  return {
    source,
    target,
    matches: Object.keys(source).every((key) => source[key as keyof typeof source] === target[key as keyof typeof target]),
  };
}

router.get('/public', async (_req, res: Response) => {
  try {
    const allowRegister = await db.getSetting('allow_register');
    res.json({
      allowRegister: allowRegister !== 'false',
    });
  } catch (error) {
    res.status(500).json({ error: '获取系统设置失败' });
  }
});

router.get('/info', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const dbType = db.getDbType();
    const serverInfo = await db.getServerInfo();
    res.json({
      databaseType: dbType,
      databaseEngine: serverInfo.engine,
      databaseVersion: serverInfo.version,
      connected: true,
      applicationVersion: '1.0.0',
      version: '1.0.0',
      runtime: config.databaseRuntime,
    });
  } catch (error) {
    res.status(500).json({ error: '获取系统信息失败' });
  }
});

router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = getLibraryOwnerId(req.user!);
    const allowedCategoryIds = req.user!.user_type === 'integrated' && req.user!.category_scopes.length > 0
      ? req.user!.category_scopes
      : undefined;
    const [questionResult, categories, learningStats] = await Promise.all([
      db.getQuestions(ownerId, 1, 1, undefined, allowedCategoryIds),
      db.getCategoriesByUserId(ownerId, allowedCategoryIds),
      db.getLearningStats(req.user!.id),
    ]);

    res.json({
      questionCount: questionResult.total,
      categoryCount: categories.length,
      ...learningStats,
    });
  } catch (error) {
    res.status(500).json({ error: '获取统计信息失败' });
  }
});

router.get('/settings', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const allowRegister = await db.getSetting('allow_register');
    const tagAliases = parseTagAliasMap(await db.getSetting('tag_aliases'));
    res.json({
      allowRegister: allowRegister !== 'false',
      tagAliases,
      loginSessionDuration: await getSessionLifetime(),
    });
  } catch (error) {
    res.status(500).json({ error: '获取系统设置失败' });
  }
});

router.put('/settings/:key', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { key } = req.params;
    const data = updateSettingSchema.parse(req.body);

    if (!['allow_register', 'tag_aliases', 'login_session_duration'].includes(key)) {
      res.status(400).json({ error: '不支持的设置项' });
      return;
    }

    if (key === 'login_session_duration') {
      try {
        parseSessionLifetime(data.value);
      } catch (error) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      data.value = data.value.trim().toLowerCase();
    }

    await db.setSetting(key, data.value);
    res.json({ message: '设置已更新' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '更新设置失败' });
  }
});

router.get('/backup/export', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '完整备份仅限管理员' });
    return;
  }
  try {
    const dataset = await db.exportAllData();
    const counts = Object.fromEntries(Object.entries(dataset).map(([table, rows]) => [table, rows.length]));
    res.json({
      meta: {
        exportedAt: new Date().toISOString(),
        databaseType: db.getDbType(),
        counts,
      },
      dataset,
    });
  } catch (error) {
    res.status(500).json({ error: '导出备份失败' });
  }
});

router.post('/backup/restore', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ error: '完整恢复仅限管理员' });
    return;
  }
  try {
    const data = backupRestoreSchema.parse(req.body);
    await db.replaceAllData({
      users: data.dataset.users || [],
      categories: data.dataset.categories || [],
      questions: data.dataset.questions || [],
      question_versions: data.dataset.question_versions || [],
      learning_progress: data.dataset.learning_progress || [],
      review_states: data.dataset.review_states || [],
      review_events: data.dataset.review_events || [],
      ai_credentials: data.dataset.ai_credentials || [],
      ai_configs: data.dataset.ai_configs || [],
      system_settings: data.dataset.system_settings || [],
    });
    const counts = await db.getTableCounts();
    res.json({ message: '系统数据已恢复', counts });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '恢复备份失败' });
  }
});

router.get('/database/profiles', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (_req: AuthRequest, res: Response) => {
  try {
    const runtimeState = readDatabaseRuntimeState();
    const currentCounts = await db.getTableCounts();
    res.json({
      current: {
        databaseType: db.getDbType(),
        runtime: config.databaseRuntime,
        counts: currentCounts,
      },
      selectedProfileId: runtimeState.selectedProfileId,
      needsRestart: runtimeState.selectedProfileId !== config.databaseRuntime.profileId,
      profiles: runtimeState.profiles.map(sanitizeDatabaseProfile),
    });
  } catch (error) {
    res.status(500).json({ error: '获取数据库配置失败' });
  }
});

router.post('/database/profiles', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = databaseProfileSchema.parse(req.body);
    const runtimeState = readDatabaseRuntimeState();
    const profile = mergeDatabaseProfileInput(data);
    runtimeState.profiles.push(profile);
    writeDatabaseRuntimeState(runtimeState);
    res.status(201).json(sanitizeDatabaseProfile(profile));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '创建数据库配置失败' });
  }
});

router.put('/database/profiles/:id', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = databaseProfileSchema.parse(req.body);
    const runtimeState = readDatabaseRuntimeState();
    const profileIndex = runtimeState.profiles.findIndex((item) => item.id === req.params.id);

    if (profileIndex === -1) {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }

    const profile = mergeDatabaseProfileInput(data, runtimeState.profiles[profileIndex]);
    runtimeState.profiles[profileIndex] = profile;
    writeDatabaseRuntimeState(runtimeState);
    res.json(sanitizeDatabaseProfile(profile));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '更新数据库配置失败' });
  }
});

router.delete('/database/profiles/:id', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const runtimeState = readDatabaseRuntimeState();
    const nextProfiles = runtimeState.profiles.filter((item) => item.id !== req.params.id);

    if (nextProfiles.length === runtimeState.profiles.length) {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }

    runtimeState.profiles = nextProfiles;
    if (runtimeState.selectedProfileId === req.params.id) {
      runtimeState.selectedProfileId = null;
    }
    writeDatabaseRuntimeState(runtimeState);
    res.json({ message: '数据库配置已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除数据库配置失败' });
  }
});

router.post('/database/profiles/:id/test', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const profile = getDatabaseProfileOrThrow(req.params.id);
    await testDatabaseConnection(profile);
    res.json({ success: true, message: '数据库连接测试成功' });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROFILE_NOT_FOUND') {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : '数据库连接测试失败' });
  }
});

router.post('/database/profiles/:id/init', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  let targetDb: DatabaseManager | null = null;
  try {
    const profile = getDatabaseProfileOrThrow(req.params.id);
    targetDb = await connectTargetDatabase(profile);
    const counts = await targetDb.getTableCounts();
    res.json({ message: '目标数据库已初始化', counts });
  } catch (error) {
    if (error instanceof Error && error.message === 'PROFILE_NOT_FOUND') {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : '初始化目标数据库失败' });
  } finally {
    if (targetDb) {
      await targetDb.close();
    }
  }
});

router.post('/database/profiles/:id/migrate', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  let targetDb: DatabaseManager | null = null;
  try {
    const profile = getDatabaseProfileOrThrow(req.params.id);
    const { overwrite } = migrationSchema.parse(req.body);
    targetDb = await connectTargetDatabase(profile);

    const existingCounts = await targetDb.getTableCounts();
    const targetHasData = Object.entries(existingCounts).some(
      ([table, count]) => table !== 'system_settings' && count > 0
    );
    if (targetHasData && !overwrite) {
      res.status(400).json({
        error: '目标数据库已有数据，请确认覆盖迁移',
        counts: existingCounts,
      });
      return;
    }

    const sourceData = await db.exportAllData();
    await targetDb.replaceAllData(sourceData);

    const report = buildValidationReport(Object.fromEntries(Object.entries(sourceData).map(([table, rows]) => [table, rows.length])) as unknown as DatabaseTableCountSummary, await targetDb.getTableCounts());
    res.json({
      message: report.matches ? '数据迁移完成并通过校验' : '数据迁移完成，但校验发现差异',
      report,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    if (error instanceof Error && error.message === 'PROFILE_NOT_FOUND') {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : '数据迁移失败' });
  } finally {
    if (targetDb) {
      await targetDb.close();
    }
  }
});

router.post('/database/profiles/:id/validate', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  let targetDb: DatabaseManager | null = null;
  try {
    const profile = getDatabaseProfileOrThrow(req.params.id);
    targetDb = await connectTargetDatabase(profile);
    const report = buildValidationReport(await db.getTableCounts(), await targetDb.getTableCounts());
    res.json(report);
  } catch (error) {
    if (error instanceof Error && error.message === 'PROFILE_NOT_FOUND') {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : '校验数据库失败' });
  } finally {
    if (targetDb) {
      await targetDb.close();
    }
  }
});

router.post('/database/profiles/:id/select', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const runtimeState = readDatabaseRuntimeState();
    const profile = runtimeState.profiles.find((item) => item.id === req.params.id);

    if (!profile) {
      res.status(404).json({ error: '数据库配置不存在' });
      return;
    }

    runtimeState.selectedProfileId = profile.id;
    writeDatabaseRuntimeState(runtimeState);
    res.json({
      message: '已设置为下次重启生效的数据库',
      selectedProfileId: profile.id,
      needsRestart: profile.id !== config.databaseRuntime.profileId,
    });
  } catch (error) {
    res.status(500).json({ error: '设置待切换数据库失败' });
  }
});

router.post('/database/use-env', authMiddleware, requirePermission('system_manage', '需要系统管理权限'), async (_req: AuthRequest, res: Response) => {
  try {
    const runtimeState = readDatabaseRuntimeState();
    runtimeState.selectedProfileId = null;
    writeDatabaseRuntimeState(runtimeState);
    res.json({
      message: '已恢复为环境变量数据库配置',
      selectedProfileId: null,
      needsRestart: config.databaseRuntime.source !== 'env',
    });
  } catch (error) {
    res.status(500).json({ error: '恢复环境变量数据库失败' });
  }
});

router.get('/users', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (_req: AuthRequest, res: Response) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: '获取用户列表失败' });
  }
});

router.get('/users/:id/categories', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!validateId(id)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const targetUser = await db.getUserById(id);
    if (!targetUser) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    if (targetUser.role !== 'admin' && targetUser.user_type !== 'independent') {
      res.status(400).json({ error: '只能接入独立题库用户的分类' });
      return;
    }

    const categories = await db.getCategoriesByUserId(id);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: '获取用户分类失败' });
  }
});

router.get('/users/stats', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (_req: AuthRequest, res: Response) => {
  try {
    const totalUsers = await db.getUserCount();
    res.json({ totalUsers });
  } catch (error) {
    res.status(500).json({ error: '获取用户统计失败' });
  }
});

router.post('/users', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const data = createUserSchema.parse(req.body);

    const existingUsername = await db.getUserByUsername(data.username);
    if (existingUsername) {
      res.status(400).json({ error: '用户名已存在' });
      return;
    }

    const existingEmail = await db.getUserByEmail(data.email);
    if (existingEmail) {
      res.status(400).json({ error: '邮箱已被使用' });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const permissions = data.role === 'admin' ? ADMIN_PERMISSIONS : (data.permissions || DEFAULT_USER_PERMISSIONS);

    const user = await db.createUser({
      id: randomUUID(),
      username: data.username,
      email: data.email,
      password_hash: hashedPassword,
      must_change_password: false,
      role: data.role,
      user_type: data.role === 'admin' ? 'independent' : data.userType,
      library_owner_id: data.role === 'admin' || data.userType === 'independent' ? null : (data.libraryOwnerId || req.user!.id),
      category_scopes: data.role === 'admin' || data.userType === 'independent' ? [] : (data.categoryScopes || []),
      permissions,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors.map((item) => item.message).join('；') });
      return;
    }
    res.status(500).json({ error: '创建用户失败' });
  }
});

router.delete('/users/:id', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!validateId(id)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    if (id === req.user!.id) {
      res.status(400).json({ error: '不能删除自己的账户' });
      return;
    }

    const success = await db.deleteUser(id);
    if (!success) {
      res.status(400).json({ error: '无法删除该用户（可能是最后一个管理员）' });
      return;
    }

    res.json({ message: '用户已删除' });
  } catch (error) {
    res.status(500).json({ error: '删除用户失败' });
  }
});

router.put('/users/:id/role', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!validateId(id)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    if (!['admin', 'user'].includes(role)) {
      res.status(400).json({ error: '无效的角色' });
      return;
    }

    if (id === req.user!.id) {
      res.status(400).json({ error: '不能修改自己的角色' });
      return;
    }

    const user = await db.updateUserRole(id, role);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: '更新用户角色失败' });
  }
});

router.put('/users/:id', authMiddleware, requirePermission('user_manage', '需要用户管理权限'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);

    if (!validateId(id)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const user = await db.getUserById(id);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const updateData: {
      username?: string;
      email?: string;
      password_hash?: string;
      role?: 'admin' | 'user';
      user_type?: 'independent' | 'integrated';
      library_owner_id?: string | null;
      category_scopes?: string[];
      permissions?: UserPermissions;
    } = {};

    if (data.username) {
      const existingUser = await db.getUserByUsername(data.username);
      if (existingUser && existingUser.id !== id) {
        res.status(400).json({ error: '用户名已存在' });
        return;
      }
      updateData.username = data.username;
    }

    if (data.email) {
      const existingUser = await db.getUserByEmail(data.email);
      if (existingUser && existingUser.id !== id) {
        res.status(400).json({ error: '该邮箱已被使用' });
        return;
      }
      updateData.email = data.email;
    }

    if (data.password) {
      updateData.password_hash = await bcrypt.hash(data.password, 12);
    }

    if (data.role) {
      updateData.role = data.role;
    }
    if (data.userType) {
      updateData.user_type = data.role === 'admin' ? 'independent' : data.userType;
    }
    if (data.libraryOwnerId !== undefined) {
      updateData.library_owner_id = (data.role === 'admin' || data.userType === 'independent') ? null : data.libraryOwnerId;
    }
    if (data.categoryScopes !== undefined) {
      updateData.category_scopes = (data.role === 'admin' || data.userType === 'independent') ? [] : data.categoryScopes;
    }

    if (data.permissions) {
      updateData.permissions = data.role === 'admin'
        ? ADMIN_PERMISSIONS
        : data.permissions;
    } else if (data.role === 'admin') {
      updateData.permissions = ADMIN_PERMISSIONS;
    } else if (data.role === 'user' && user.role === 'admin') {
      updateData.permissions = DEFAULT_USER_PERMISSIONS;
    }

    if ((updateData.user_type || user.user_type) === 'independent') {
      updateData.library_owner_id = null;
      updateData.category_scopes = [];
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: '没有需要更新的内容' });
      return;
    }

    const updatedUser = await db.updateUser(id, updateData);
    res.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败', details: error.errors });
      return;
    }
    res.status(500).json({ error: '更新用户信息失败' });
  }
});

export default router;
