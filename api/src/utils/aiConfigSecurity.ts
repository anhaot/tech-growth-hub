const BUILTIN_AI_HOSTS = new Set([
  'api.openai.com',
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
  'ark.cn-beijing.volces.com',
  'aip.baidubce.com',
  'open.bigmodel.cn',
]);

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return false;
  }

  const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

function isUnsafeIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return false;

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  const mappedHex = normalized.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === '::1'
  ) {
    return true;
  }

  return isUnsafeIpAddress(normalized);
}

type ValidationMode = 'configure' | 'runtime';

export function validateAIBaseUrl(
  input: string | undefined,
  actor: { role: string },
  isCustom: boolean,
  mode: ValidationMode = 'configure'
): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('AI API 地址格式无效');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isBuiltinHost = BUILTIN_AI_HOSTS.has(hostname);

  if (parsed.protocol !== 'https:') throw new Error('AI API 地址仅允许使用 HTTPS');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('AI API 地址不能包含账号、密码、查询参数或片段');
  }

  if (mode === 'configure' && (isCustom || !isBuiltinHost) && actor.role !== 'admin') {
    throw new Error('自定义 AI 地址仅管理员可配置');
  }

  if (!isBuiltinHost) {
    if (parsed.protocol !== 'https:') {
      throw new Error('自定义 AI 地址仅允许使用 HTTPS');
    }
    if (isUnsafeHostname(hostname)) {
      throw new Error('不允许使用本地、内网或保留地址作为 AI API 地址');
    }
  }

  return parsed.toString().replace(/\/$/, '');
}

export async function assertAIBaseUrlResolvesPublic(baseUrl: string): Promise<void> {
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BUILTIN_AI_HOSTS.has(hostname)) return;
  if (isIP(hostname)) {
    if (isUnsafeIpAddress(hostname)) throw new Error('AI API 地址解析到了不允许的网络');
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('AI API 地址无法解析');
  }
  if (addresses.length === 0 || addresses.some((item) => isUnsafeIpAddress(item.address))) {
    throw new Error('AI API 地址解析到了内网、环回或保留地址');
  }
}
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
