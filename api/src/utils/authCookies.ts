import { Request, Response } from 'express';
import { config } from '../config/index.js';
import { PERSISTENT_COOKIE_SECONDS } from './sessionLifetime.js';

export const authCookieName = 'tgh_auth';
export const csrfCookieName = 'tgh_csrf';

function secureCookie(req: Request): boolean {
  if (config.authCookieSecure === 'always') return true;
  if (config.authCookieSecure === 'never') return false;
  return req.secure;
}

export function writeAuthCookies(req: Request, res: Response, token: string, csrfToken: string, seconds: number | null) {
  const existing = res.getHeader('Set-Cookie');
  if (existing) {
    const cookies = (Array.isArray(existing) ? existing : [String(existing)])
      .filter((cookie) => !cookie.startsWith(`${authCookieName}=`) && !cookie.startsWith(`${csrfCookieName}=`));
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    else res.removeHeader('Set-Cookie');
  }
  const options = {
    path: '/',
    sameSite: 'lax' as const,
    secure: secureCookie(req),
    maxAge: (seconds ?? PERSISTENT_COOKIE_SECONDS) * 1000,
  };
  res.cookie(authCookieName, token, { ...options, httpOnly: true });
  res.cookie(csrfCookieName, csrfToken, options);
}

export function clearAuthCookies(req: Request, res: Response) {
  const options = { path: '/', sameSite: 'lax' as const, secure: secureCookie(req) };
  res.clearCookie(authCookieName, { ...options, httpOnly: true });
  res.clearCookie(csrfCookieName, options);
}

export function writeCsrfCookie(req: Request, res: Response, csrfToken: string) {
  res.cookie(csrfCookieName, csrfToken, {
    path: '/', sameSite: 'lax', secure: secureCookie(req), maxAge: PERSISTENT_COOKIE_SECONDS * 1000,
  });
}
