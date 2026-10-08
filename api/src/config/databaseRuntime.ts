import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import {
  DatabaseConnectionConfig,
  DatabaseProfile,
  DatabaseRuntimeInfo,
  DatabaseRuntimeState,
  DatabaseType,
  SanitizedDatabaseProfile,
} from '../types/index.js';

const runtimeConfigPath = process.env.DATABASE_RUNTIME_CONFIG_PATH
  ? path.resolve(process.env.DATABASE_RUNTIME_CONFIG_PATH)
  : path.resolve(process.cwd(), 'data', 'database-runtime.json');

function ensureRuntimeDir() {
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
}

function isDatabaseType(value: unknown): value is DatabaseType {
  return value === 'sqlite' || value === 'mysql';
}

function normalizeProfile(profile: Partial<DatabaseProfile>): DatabaseProfile | null {
  if (!profile.id || !profile.name || !isDatabaseType(profile.type)) {
    return null;
  }

  const now = new Date().toISOString();
  const sqlitePath = typeof profile.sqlite?.path === 'string' && profile.sqlite.path.trim()
    ? profile.sqlite.path.trim()
    : './data/tech-growth-hub.db';

  return {
    id: profile.id,
    name: profile.name.trim(),
    type: profile.type,
    sqlite: { path: sqlitePath },
    mysql: {
      host: profile.mysql?.host?.trim() || 'localhost',
      port: Number(profile.mysql?.port || 3306),
      user: profile.mysql?.user?.trim() || 'root',
      password: profile.mysql?.password || '',
      database: profile.mysql?.database?.trim() || 'tech_growth_hub',
    },
    created_at: profile.created_at || now,
    updated_at: profile.updated_at || now,
  };
}

export function getDatabaseRuntimeConfigPath(): string {
  return runtimeConfigPath;
}

export function readDatabaseRuntimeState(): DatabaseRuntimeState {
  try {
    if (!fs.existsSync(runtimeConfigPath)) {
      return { profiles: [], selectedProfileId: null };
    }

    const rawValue = fs.readFileSync(runtimeConfigPath, 'utf-8');
    const parsed = JSON.parse(rawValue) as Partial<DatabaseRuntimeState>;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles
          .map((profile) => normalizeProfile(profile))
          .filter((profile): profile is DatabaseProfile => Boolean(profile))
      : [];
    const selectedProfileId = typeof parsed.selectedProfileId === 'string' ? parsed.selectedProfileId : null;

    return { profiles, selectedProfileId };
  } catch (error) {
    console.error('Failed to read runtime database state:', error);
    return { profiles: [], selectedProfileId: null };
  }
}

export function writeDatabaseRuntimeState(state: DatabaseRuntimeState): void {
  ensureRuntimeDir();
  const temporaryPath = `${runtimeConfigPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, runtimeConfigPath);
  } finally { fs.rmSync(temporaryPath, { force: true }); }
}

export function sanitizeDatabaseProfile(profile: DatabaseProfile): SanitizedDatabaseProfile {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    sqlite: profile.type === 'sqlite' ? { path: profile.sqlite?.path || './data/tech-growth-hub.db' } : undefined,
    mysql: profile.type === 'mysql'
      ? {
          host: profile.mysql?.host || 'localhost',
          port: profile.mysql?.port || 3306,
          user: profile.mysql?.user || 'root',
          database: profile.mysql?.database || 'tech_growth_hub',
          hasPassword: Boolean(profile.mysql?.password),
        }
      : undefined,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

export function buildDatabaseConnectionConfig(profile: DatabaseProfile): DatabaseConnectionConfig {
  return {
    type: profile.type,
    sqlite: {
      path: profile.sqlite?.path || './data/tech-growth-hub.db',
    },
    mysql: {
      host: profile.mysql?.host || 'localhost',
      port: profile.mysql?.port || 3306,
      user: profile.mysql?.user || 'root',
      password: profile.mysql?.password || '',
      database: profile.mysql?.database || 'tech_growth_hub',
    },
  };
}

export function resolveDatabaseConfigFromRuntime(envConfig: DatabaseConnectionConfig): {
  config: DatabaseConnectionConfig;
  info: DatabaseRuntimeInfo;
} {
  const runtimeState = readDatabaseRuntimeState();
  const selectedProfile = runtimeState.selectedProfileId
    ? runtimeState.profiles.find((profile) => profile.id === runtimeState.selectedProfileId)
    : undefined;

  if (!selectedProfile) {
    return {
      config: envConfig,
      info: {
        source: 'env',
        profileId: null,
        databaseType: envConfig.type,
        selectedProfileId: runtimeState.selectedProfileId,
      },
    };
  }

  return {
    config: buildDatabaseConnectionConfig(selectedProfile),
    info: {
      source: 'profile',
      profileId: selectedProfile.id,
      databaseType: selectedProfile.type,
      selectedProfileId: runtimeState.selectedProfileId,
    },
  };
}
