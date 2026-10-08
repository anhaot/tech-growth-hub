import 'dotenv/config';
import { resolveDatabaseConfigFromRuntime } from './databaseRuntime.js';
import { DatabaseConnectionConfig, DatabaseRuntimeInfo } from '../types/index.js';
import { validateAIConfigEncryptionKey } from '../utils/secretEncryption.js';
import { parseSessionLifetime } from '../utils/sessionLifetime.js';

type AIProvider = 'openai' | 'deepseek' | 'qwen' | 'doubao' | 'wenxin' | 'zhipu';

interface AIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface AISettings {
  enabled: boolean;
  defaultProvider: AIProvider;
  openai: AIConfig;
  deepseek: AIConfig & { baseUrl: string };
  qwen: AIConfig & { baseUrl: string };
  doubao: AIConfig & { baseUrl: string };
  wenxin: AIConfig & { baseUrl: string };
  zhipu: AIConfig & { baseUrl: string };
}

interface Config {
  port: number;
  nodeEnv: string;
  trustProxy: boolean | number;
  authCookieSecure: 'auto' | 'always' | 'never';
  jwt: {
    secret: string;
    expiresIn: string;
  };
  initAdmin: {
    username: string;
    email: string;
    password: string;
    mustChangePassword: boolean;
  };
  database: DatabaseConnectionConfig;
  databaseRuntime: DatabaseRuntimeInfo;
  ai: AISettings;
}

const envDatabaseConfig: DatabaseConnectionConfig = {
  type: (process.env.DATABASE_TYPE || 'sqlite') as 'sqlite' | 'mysql',
  sqlite: {
    path: process.env.SQLITE_PATH || './data/tech-growth-hub.db',
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'tech_growth_hub',
  },
};

const runtimeDatabase = resolveDatabaseConfigFromRuntime(envDatabaseConfig);

function parseTrustProxy(value: string | undefined): boolean | number {
  if (!value) {
    return false;
  }

  if (value === 'true') {
    return 1;
  }

  if (value === 'false') {
    return false;
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return false;
}

function parseAuthCookieSecure(value: string | undefined): 'auto' | 'always' | 'never' {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }
  if (normalized === 'true' || normalized === 'always') {
    return 'always';
  }
  if (normalized === 'false' || normalized === 'never') {
    return 'never';
  }

  console.warn(`[security] Ignoring invalid AUTH_COOKIE_SECURE=${value}; expected auto, true, or false.`);
  return 'auto';
}

function logSecurityWarnings(nodeEnv: string, jwtSecret: string) {
  if (nodeEnv === 'production' && (jwtSecret === 'default-secret-change-me' || jwtSecret.length < 32)) {
    throw new Error('Production requires a unique JWT_SECRET with at least 32 characters.');
  }
  if (nodeEnv === 'production' && !validateAIConfigEncryptionKey(process.env.AI_CONFIG_ENCRYPTION_KEY)) {
    throw new Error('Production requires AI_CONFIG_ENCRYPTION_KEY (32 bytes, encoded as 64 hex characters or base64).');
  }

  if (jwtSecret !== 'default-secret-change-me') {
    return;
  }

  const prefix = '[security]';
  console.warn(`${prefix} JWT_SECRET is using the built-in default secret.`);

  if (nodeEnv === 'production') {
    console.warn(`${prefix} Production deployments should set a unique JWT secret immediately.`);
    return;
  }

  console.warn(`${prefix} This is tolerated for local development, but tokens are forgeable if the secret is known.`);
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  authCookieSecure: parseAuthCookieSecure(process.env.AUTH_COOKIE_SECURE),
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  initAdmin: {
    username: process.env.INIT_ADMIN_USERNAME || '',
    email: process.env.INIT_ADMIN_EMAIL || '',
    password: process.env.INIT_ADMIN_PASSWORD || '',
    mustChangePassword: process.env.INIT_ADMIN_FORCE_PASSWORD_CHANGE !== 'false',
  },
  
  database: runtimeDatabase.config,
  databaseRuntime: runtimeDatabase.info,
  
  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    defaultProvider: (process.env.DEFAULT_AI_PROVIDER || 'deepseek') as AIProvider,
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    },
    qwen: {
      apiKey: process.env.QWEN_API_KEY || '',
      baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_MODEL || 'qwen-turbo',
    },
    doubao: {
      apiKey: process.env.DOUBAO_API_KEY || '',
      baseUrl: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
      model: process.env.DOUBAO_MODEL || 'doubao-pro-4k',
    },
    wenxin: {
      apiKey: process.env.WENXIN_API_KEY || '',
      baseUrl: process.env.WENXIN_BASE_URL || 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat',
      model: process.env.WENXIN_MODEL || 'ernie-bot-4',
    },
    zhipu: {
      apiKey: process.env.ZHIPU_API_KEY || '',
      baseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
      model: process.env.ZHIPU_MODEL || 'glm-4',
    },
  },
};

logSecurityWarnings(config.nodeEnv, config.jwt.secret);
parseSessionLifetime(config.jwt.expiresIn);
