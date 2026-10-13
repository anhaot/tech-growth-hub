import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { config } from '../config/index.js';

const rateLimiter = new RateLimiterMemory({
  points: config.nodeEnv === 'test' ? 10_000 : 100,
  duration: 60,
});

const authRateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
});

const aiRateLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
});

export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = req.ip || 'unknown';
    await rateLimiter.consume(ip);
    next();
  } catch {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
};

export const authRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = req.ip || 'unknown';
    await authRateLimiter.consume(ip);
    next();
  } catch (error) {
    const retryAfterSeconds = getRetryAfterSeconds(error);
    const action = req.path.includes('register') ? '注册' : '登录';
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: `${action}请求过于频繁，请 ${retryAfterSeconds} 秒后再试` });
  }
};

export const aiRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ip = req.ip || 'unknown';
    await aiRateLimiter.consume(ip);
    next();
  } catch {
    res.status(429).json({ error: 'AI请求过于频繁，请稍后再试' });
  }
};

function getRetryAfterSeconds(error: unknown): number {
  if (error instanceof RateLimiterRes && typeof error.msBeforeNext === 'number') {
    return Math.max(1, Math.ceil(error.msBeforeNext / 1000));
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'msBeforeNext' in error
    && typeof (error as { msBeforeNext?: number }).msBeforeNext === 'number'
  ) {
    return Math.max(1, Math.ceil((error as { msBeforeNext: number }).msBeforeNext / 1000));
  }

  return 60;
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
};

export const errorHandler = (err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction): void => {
  if (res.headersSent) { next(err); return; }
  if (err.type === 'entity.parse.failed') { res.status(400).json({ error: '请求内容不是有效的 JSON' }); return; }
  if (err.type === 'entity.too.large' || err.type === 'parameters.too.many') { res.status(413).json({ error: '请求内容过大' }); return; }
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') { res.status(415).json({ error: '请求内容编码不受支持' }); return; }
  console.error('Error:', err);
  res.status(500).json({ error: config.nodeEnv === 'development' ? err.message : '服务器内部错误' });
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: '资源未找到' });
};
