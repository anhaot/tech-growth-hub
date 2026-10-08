import { Request, Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../database/index.js';
import { authRateLimitMiddleware } from '../middleware/common.js';
import { authMiddleware, AuthRequest, generateCsrfToken, generateToken, getSessionLifetime } from '../middleware/auth.js';
import { clearAuthCookies, writeAuthCookies, writeCsrfCookie } from '../utils/authCookies.js';
import { parseSessionLifetime } from '../utils/sessionLifetime.js';
import { User, UserPermissions } from '../types/index.js';

const router = Router();

const loginAttempts = new Map<string, { count: number; lockUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000;

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

const passwordSchema = z.string()
  .min(9, '密码长度至少为9位')
  .regex(/[a-zA-Z]/, '密码必须包含字母')
  .regex(/[0-9]/, '密码必须包含数字');

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: passwordSchema,
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const updateProfileSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().optional(),
  password: passwordSchema.optional(),
});

function checkLoginLock(ip: string): { locked: boolean; remainingTime?: number } {
  const attempts = loginAttempts.get(ip);
  if (!attempts) {
    return { locked: false };
  }
  
  if (attempts.lockUntil && Date.now() < attempts.lockUntil) {
    const remainingTime = Math.ceil((attempts.lockUntil - Date.now()) / 1000 / 60);
    return { locked: true, remainingTime };
  }
  
  return { locked: false };
}

function recordFailedLogin(ip: string): void {
  const attempts = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
  attempts.count++;
  
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockUntil = Date.now() + LOCK_TIME_MS;
    attempts.count = 0;
  }
  
  loginAttempts.set(ip, attempts);
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

function sanitizeInput(input: string): string {
  return input.replace(/[<>'"&]/g, '');
}

function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password,
    user_type: user.user_type,
    library_owner_id: user.library_owner_id,
    category_scopes: user.category_scopes,
    permissions: user.permissions,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function issueSession(req: Request, res: Response, user: User) {
  const lifetime = await getSessionLifetime();
  const token = generateToken(user, lifetime);
  writeAuthCookies(req, res, token, generateCsrfToken(), parseSessionLifetime(lifetime));
  return token;
}

router.get('/csrf', (req, res: Response) => {
  const csrfToken = generateCsrfToken();
  writeCsrfCookie(req, res, csrfToken);
  res.json({ csrfToken });
});

router.post('/register', authRateLimitMiddleware, async (req, res: Response) => {
  try {
    const allowRegister = await db.getSetting('allow_register');
    if (allowRegister === 'false') {
      res.status(403).json({ error: '当前已关闭注册' });
      return;
    }

    const data = registerSchema.parse(req.body);
    
    const sanitizedUsername = sanitizeInput(data.username);
    const sanitizedEmail = sanitizeInput(data.email);

    const existingUsername = await db.getUserByUsername(sanitizedUsername);
    if (existingUsername) {
      res.status(400).json({ error: '用户名已存在' });
      return;
    }

    const existingEmail = await db.getUserByEmail(sanitizedEmail);
    if (existingEmail) {
      res.status(400).json({ error: '邮箱已被注册' });
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await db.createUser({
      id: randomUUID(),
      username: sanitizedUsername,
      email: sanitizedEmail,
      password_hash: hashedPassword,
      must_change_password: false,
      role: 'user',
      user_type: 'independent',
      library_owner_id: null,
      category_scopes: [],
      permissions: DEFAULT_USER_PERMISSIONS,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const token = await issueSession(req, res, user);
    res.status(201).json({
      user: serializeUser(user),
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join('；');
      res.status(400).json({ error: messages });
      return;
    }
    res.status(500).json({ error: '注册失败' });
  }
});

router.post('/login', authRateLimitMiddleware, async (req, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  try {
    const lockStatus = checkLoginLock(ip);
    if (lockStatus.locked) {
      res.status(429).json({ 
        error: `登录尝试次数过多，请 ${lockStatus.remainingTime} 分钟后再试` 
      });
      return;
    }

    const data = loginSchema.parse(req.body);
    
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const user = await db.getUserByUsername(sanitizeInput(data.username));
    if (!user) {
      recordFailedLogin(ip);
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    const isValidPassword = await bcrypt.compare(data.password, user.password_hash);
    if (!isValidPassword) {
      recordFailedLogin(ip);
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    clearLoginAttempts(ip);

    const token = await issueSession(req, res, user);
    res.json({
      user: serializeUser(user),
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: '输入验证失败' });
      return;
    }
    res.status(500).json({ error: '登录失败' });
  }
});

router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  res.json(serializeUser(req.user!));
});

router.post('/session', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await issueSession(req, res, req.user!);
    res.json({ message: '登录有效期已更新' });
  } catch {
    res.status(500).json({ error: '更新登录有效期失败' });
  }
});

router.post('/logout', (req, res: Response) => {
  clearAuthCookies(req, res);
  res.json({ message: '已退出登录' });
});

router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = updateProfileSchema.parse(req.body);

    if (data.username && data.username !== req.user!.username) {
      const existing = await db.getUserByUsername(sanitizeInput(data.username));
      if (existing) {
        res.status(400).json({ error: '用户名已存在' });
        return;
      }
    }

    if (data.email && data.email !== req.user!.email) {
      const existing = await db.getUserByEmail(sanitizeInput(data.email));
      if (existing) {
        res.status(400).json({ error: '邮箱已被使用' });
        return;
      }
    }

    const updateData: Partial<User> = {};
    if (data.username) updateData.username = sanitizeInput(data.username);
    if (data.email) updateData.email = sanitizeInput(data.email);
    if (data.password) {
      updateData.password_hash = await bcrypt.hash(data.password, 12);
      updateData.must_change_password = false;
    }

    const updatedUser = await db.updateUser(req.user!.id, updateData);
    if (data.password) await issueSession(req, res, updatedUser!);
    res.json(serializeUser(updatedUser!));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => e.message).join('；');
      res.status(400).json({ error: messages });
      return;
    }
    res.status(500).json({ error: '更新失败' });
  }
});

const loginAttemptCleanupTimer = setInterval(() => {
  const now = Date.now();
  loginAttempts.forEach((value, key) => {
    if (value.lockUntil && now > value.lockUntil) {
      loginAttempts.delete(key);
    }
  });
}, 60 * 1000);

loginAttemptCleanupTimer.unref?.();

export default router;
