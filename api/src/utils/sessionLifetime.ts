export const MAX_SESSION_SECONDS = 365 * 24 * 60 * 60;
// Browsers cap persistent cookies. Renew this window while an unlimited session is used.
export const PERSISTENT_COOKIE_SECONDS = 400 * 24 * 60 * 60;

export function parseSessionLifetime(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'forever') return null;
  const match = /^(\d+)(s|m|h|d)$/.exec(normalized);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = match ? Number(match[1]) * units[match[2]] : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > MAX_SESSION_SECONDS) {
    throw new Error('登录有效期须为 1 分钟至 365 天（如 12h、30d），或 forever');
  }
  return seconds;
}
