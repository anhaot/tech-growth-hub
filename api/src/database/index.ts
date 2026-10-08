import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import type { ExecuteValues } from 'mysql2';
import { config } from '../config/index.js';
import { normalizeTagName, parseStoredTags } from '../utils/tags.js';
import { decryptSecret, encryptSecret, protectStoredSecret } from '../utils/secretEncryption.js';
import {
  User,
  Category,
  Question,
  QuestionVersion,
  LearningProgress,
  ReviewEvent,
  ReviewQueueItem,
  ReviewRating,
  ReviewState,
  AIConfig,
  AICredential,
  UserPermissions,
  DatabaseConnectionConfig,
  DatabaseTableCountSummary,
} from '../types/index.js';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

type SQLiteDB = Database.Database;

type MySQLConnection = mysql.Pool;

function getChangedRows(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  if ('changes' in result && typeof result.changes === 'number') return result.changes;
  if ('affectedRows' in result && typeof result.affectedRows === 'number') return result.affectedRows;
  return 0;
}

function normalizeMySQLParams(params: unknown[], sql: string): ExecuteValues[] {
  const dateColumns = new Set(['created_at', 'updated_at', 'last_viewed_at', 'due_at', 'reviewed_at', 'last_reviewed_at']);
  const datePositions = new Set<number>();
  const insert = sql.match(/INSERT(?:\s+IGNORE)?\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (insert) {
    const columns = insert[1].split(',').map((column) => column.trim().replace(/`/g, ''));
    let position = 0;
    insert[2].split(',').forEach((value, index) => {
      if (!value.includes('?')) return;
      if (dateColumns.has(columns[index])) datePositions.add(position);
      position++;
    });
  }
  let position = 0;
  for (const placeholder of sql.matchAll(/\?/g)) {
    const before = sql.slice(0, placeholder.index);
    const column = before.match(/(?:\w+\.)?([a-z_]+)\s*(?:>=|<=|=|>|<)\s*$/i)?.[1];
    if (column && dateColumns.has(column.toLowerCase())) datePositions.add(position);
    position++;
  }
  return params.map((value, index) => {
    if (datePositions.has(index) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
      return value.replace('T', ' ').replace(/Z$/, '');
    }
    return value as ExecuteValues;
  });
}

function normalizeMySQLRows<T>(rows: unknown): T[] {
  return (rows as Array<Record<string, unknown>>).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]))) as T[];
}

function orderRestoredCategories(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  if (byId.size !== rows.length) throw new Error('备份分类 ID 重复');
  const children = new Map<string, Record<string, unknown>[]>();
  const ordered: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!row.parent_id) { ordered.push(row); continue; }
    const parent = byId.get(String(row.parent_id));
    if (!parent || parent.user_id !== row.user_id) throw new Error('备份父分类不存在或不属于同一题库');
    const list = children.get(String(row.parent_id)) || [];
    list.push(row); children.set(String(row.parent_id), list);
  }
  for (let index = 0; index < ordered.length; index++) {
    for (const child of children.get(String(ordered[index].id)) || []) ordered.push(child);
  }
  if (ordered.length !== rows.length) throw new Error('备份分类存在循环引用');
  return ordered;
}

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

export class DatabaseManager {
  private sqliteDb: SQLiteDB | null = null;
  private mysqlPool: MySQLConnection | null = null;
  private dbType: 'sqlite' | 'mysql';
  private databaseConfig: DatabaseConnectionConfig;
  private skipDefaultAdmin: boolean;

  constructor(databaseConfig: DatabaseConnectionConfig = config.database, options?: { skipDefaultAdmin?: boolean }) {
    this.databaseConfig = databaseConfig;
    this.dbType = databaseConfig.type;
    this.skipDefaultAdmin = Boolean(options?.skipDefaultAdmin);
  }

  async connect(): Promise<void> {
    if (this.dbType === 'sqlite') {
      await this.connectSQLite();
    } else {
      await this.connectMySQL();
    }
    await this.initializeTables();
    await this.initializeQuestionVersions();
    await this.migrateAIConfigSecrets();
    await this.migrateAICredentialLinks();
    if (!this.skipDefaultAdmin) {
      await this.createDefaultAdmin();
    }
  }

  private async connectSQLite(): Promise<void> {
    const dbPath = this.databaseConfig.sqlite.path;
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma('journal_mode = WAL');
    this.sqliteDb.pragma('foreign_keys = ON');
  }

  private async connectMySQL(): Promise<void> {
    const { host, port, user, password, database } = this.databaseConfig.mysql;
    
    this.mysqlPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      jsonStrings: true,
      timezone: 'Z',
      queueLimit: 0,
    });

    try {
      await this.mysqlPool.execute('SELECT 1');
    } catch (error) {
      console.error('MySQL connection failed:', error);
      throw error;
    }
  }

  private async initializeTables(): Promise<void> {
    if (this.dbType === 'sqlite') {
      this.initSQLiteTables();
    } else {
      await this.initMySQLTables();
    }
  }

  private async initializeQuestionVersions(): Promise<void> {
    if (this.sqliteDb) {
      const columns = this.sqliteDb.prepare('PRAGMA table_info(questions)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'revision')) {
        this.sqliteDb.exec('ALTER TABLE questions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
      }
      this.sqliteDb.exec(`CREATE TABLE IF NOT EXISTS question_versions (
        id TEXT PRIMARY KEY, question_id TEXT NOT NULL, version INTEGER NOT NULL,
        snapshot TEXT NOT NULL, actor_id TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(question_id, version), FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      ); CREATE INDEX IF NOT EXISTS idx_questions_user_order ON questions(user_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_questions_user_category_order ON questions(user_id, category_id, created_at, id);`);
    } else if (this.mysqlPool) {
      const [columns] = await this.mysqlPool.execute<mysql.RowDataPacket[]>("SHOW COLUMNS FROM questions LIKE 'revision'");
      if (!columns.length) await this.mysqlPool.execute('ALTER TABLE questions ADD COLUMN revision INT NOT NULL DEFAULT 1');
      await this.mysqlPool.execute(`CREATE TABLE IF NOT EXISTS question_versions (
        id VARCHAR(36) PRIMARY KEY, question_id VARCHAR(36) NOT NULL, version INT NOT NULL,
        snapshot LONGTEXT NOT NULL, actor_id VARCHAR(36), source VARCHAR(100) NOT NULL, created_at DATETIME(3) NOT NULL,
        UNIQUE(question_id, version), FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
      )`);
      await this.ensureMySQLIndex('questions', 'idx_questions_user_order', 'user_id, created_at, id');
      await this.ensureMySQLIndex('questions', 'idx_questions_user_category_order', 'user_id, category_id, created_at, id');
    }
  }

  private async ensureMySQLIndex(table: string, name: string, columns: string): Promise<void> {
    const [indexes] = await this.mysqlPool!.execute<mysql.RowDataPacket[]>(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, name]);
    if (!indexes.length) await this.mysqlPool!.execute(`CREATE INDEX ${name} ON ${table} (${columns})`);
  }

  private async migrateAIConfigSecrets(): Promise<void> {
    for (const table of ['ai_configs', 'ai_credentials']) {
      const rows = await this.all<{ id: string; api_key: string }>(`SELECT id, api_key FROM ${table}`);
      for (const row of rows) {
        const protectedValue = protectStoredSecret(row.api_key || '');
        if (protectedValue !== row.api_key) {
          await this.run(`UPDATE ${table} SET api_key = ?, updated_at = ? WHERE id = ?`, [
            protectedValue,
            new Date().toISOString(),
            row.id,
          ]);
        }
      }
    }
  }

  private async migrateAICredentialLinks(): Promise<void> {
    const configs = await this.all<AIConfig>(
      "SELECT * FROM ai_configs WHERE is_custom = 1 AND (credential_id IS NULL OR credential_id = '') ORDER BY created_at ASC"
    );
    for (const rawConfig of configs) {
      const config = { ...rawConfig, api_key: decryptSecret(rawConfig.api_key) };
      const credentials = await this.getAICredentialsByUserId(config.user_id);
      let credential = credentials.find((item) => item.base_url === config.base_url && item.api_key === config.api_key);
      if (!credential && config.base_url) {
        credential = await this.createAICredential({
          id: randomUUID(),
          user_id: config.user_id,
          name: config.provider === 'nvidia' ? 'NVIDIA' : (config.display_name || config.provider),
          base_url: config.base_url,
          api_key: config.api_key,
          created_at: config.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      if (credential) {
        await this.run('UPDATE ai_configs SET credential_id = ? WHERE id = ?', [credential.id, config.id]);
      }
    }
  }

  private initSQLiteTables(): void {
    if (!this.sqliteDb) return;

    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        role TEXT DEFAULT 'user',
        user_type TEXT DEFAULT 'independent',
        library_owner_id TEXT,
        category_scopes TEXT DEFAULT '[]',
        permissions TEXT DEFAULT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        parent_id TEXT,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        answer TEXT NOT NULL,
        explanation TEXT,
        difficulty TEXT DEFAULT 'medium',
        category_id TEXT,
        user_id TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS learning_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        mode TEXT DEFAULT 'study',
        last_viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        view_count INTEGER DEFAULT 0,
        is_bookmarked INTEGER DEFAULT 0,
        UNIQUE(user_id, question_id, mode),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_states (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        interval_days REAL DEFAULT 0,
        ease_factor REAL DEFAULT 2.5,
        repetitions INTEGER DEFAULT 0,
        lapses INTEGER DEFAULT 0,
        last_rating TEXT,
        last_reviewed_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, question_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS review_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        rating TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        response_ms INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_configs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT,
        base_url TEXT,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        is_custom INTEGER DEFAULT 0,
        credential_id TEXT,
        model_status TEXT DEFAULT 'unknown',
        last_checked_at TEXT,
        last_check_error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_questions_user_id ON questions(user_id);
      CREATE INDEX IF NOT EXISTS idx_questions_category_id ON questions(category_id);
      CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
      CREATE INDEX IF NOT EXISTS idx_learning_progress_user_id ON learning_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_review_states_due ON review_states(user_id, due_at);
      CREATE INDEX IF NOT EXISTS idx_review_events_user_time ON review_events(user_id, reviewed_at);
      CREATE INDEX IF NOT EXISTS idx_ai_credentials_user_id ON ai_credentials(user_id);

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_register', 'true');
    `);

    try {
      this.sqliteDb.exec(`ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL`);
    } catch (e) { /* Column already exists */ }
    try {
      this.sqliteDb.exec(`ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'independent'`);
    } catch (e) { /* Column already exists */ }
    try {
      this.sqliteDb.exec(`ALTER TABLE users ADD COLUMN library_owner_id TEXT`);
    } catch (e) { /* Column already exists */ }
    try {
      this.sqliteDb.exec(`ALTER TABLE users ADD COLUMN category_scopes TEXT DEFAULT '[]'`);
    } catch (e) { /* Column already exists */ }
    try {
      this.sqliteDb.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN display_name TEXT`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN base_url TEXT`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN is_custom INTEGER DEFAULT 0`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN model_status TEXT DEFAULT 'unknown'`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN last_checked_at TEXT`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN last_check_error TEXT`);
    } catch (e) { /* Column already exists */ }

    try {
      this.sqliteDb.exec(`ALTER TABLE ai_configs ADD COLUMN credential_id TEXT`);
    } catch (e) { /* Column already exists */ }
  }

  private async initMySQLTables(): Promise<void> {
    if (!this.mysqlPool) return;

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        must_change_password TINYINT(1) NOT NULL DEFAULT 0,
        role ENUM('admin', 'user') DEFAULT 'user',
        user_type VARCHAR(20) DEFAULT 'independent',
        library_owner_id VARCHAR(36) NULL,
        category_scopes TEXT NULL,
        permissions TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    try {
      await this.mysqlPool.execute(`
        ALTER TABLE users ADD COLUMN permissions TEXT NULL
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE users ADD COLUMN user_type VARCHAR(20) DEFAULT 'independent'
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE users ADD COLUMN library_owner_id VARCHAR(36) NULL
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE users ADD COLUMN category_scopes TEXT NULL
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0
      `);
    } catch (error) { /* Column already exists */ }

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        parent_id VARCHAR(36),
        user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS questions (
        id VARCHAR(36) PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        answer TEXT NOT NULL,
        explanation TEXT,
        difficulty ENUM('easy', 'medium', 'hard') DEFAULT 'medium',
        category_id VARCHAR(36),
        user_id VARCHAR(36) NOT NULL,
        tags JSON DEFAULT ('[]'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS learning_progress (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        question_id VARCHAR(36) NOT NULL,
        mode ENUM('study', 'quiz') DEFAULT 'study',
        last_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        view_count INT DEFAULT 0,
        is_bookmarked BOOLEAN DEFAULT FALSE,
        UNIQUE KEY unique_user_question_mode (user_id, question_id, mode),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS review_states (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        question_id VARCHAR(36) NOT NULL,
        due_at DATETIME(3) NOT NULL,
        interval_days DOUBLE DEFAULT 0,
        ease_factor DOUBLE DEFAULT 2.5,
        repetitions INT DEFAULT 0,
        lapses INT DEFAULT 0,
        last_rating VARCHAR(10),
        last_reviewed_at DATETIME(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY unique_review_state (user_id, question_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS review_events (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        question_id VARCHAR(36) NOT NULL,
        rating VARCHAR(10) NOT NULL,
        reviewed_at DATETIME(3) NOT NULL,
        response_ms INT,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        INDEX idx_review_events_user_time (user_id, reviewed_at)
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS ai_credentials (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        api_key VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_ai_credentials_user_id (user_id)
      )
    `);

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS ai_configs (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        display_name VARCHAR(100),
        base_url VARCHAR(500),
        api_key VARCHAR(500) NOT NULL,
        model VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        is_custom BOOLEAN DEFAULT FALSE,
        credential_id VARCHAR(36),
        model_status VARCHAR(20) DEFAULT 'unknown',
        last_checked_at TEXT,
        last_check_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    try {
      await this.mysqlPool.execute(`
        ALTER TABLE ai_configs ADD COLUMN model_status VARCHAR(20) DEFAULT 'unknown'
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE ai_configs ADD COLUMN last_checked_at TEXT
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE ai_configs ADD COLUMN last_check_error TEXT
      `);
    } catch (error) { /* Column already exists */ }
    try {
      await this.mysqlPool.execute(`
        ALTER TABLE ai_configs ADD COLUMN credential_id VARCHAR(36)
      `);
    } catch (error) { /* Column already exists */ }

    await this.ensureMySQLIndex('questions', 'idx_questions_user_id', 'user_id');
    await this.ensureMySQLIndex('questions', 'idx_questions_category_id', 'category_id');
    await this.ensureMySQLIndex('categories', 'idx_categories_user_id', 'user_id');
    await this.ensureMySQLIndex('learning_progress', 'idx_learning_progress_user_id', 'user_id');

    await this.mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        \`key\` VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await this.mysqlPool.execute(`
      INSERT IGNORE INTO system_settings (\`key\`, value) VALUES ('allow_register', 'true')
    `);
  }

  private async createDefaultAdmin(): Promise<void> {
    const { username, email, password, mustChangePassword } = config.initAdmin;
    if (!username || !email || !password) {
      return;
    }

    const adminExists = await this.getUserByUsername(username);
    const emailExists = await this.getUserByEmail(email);
    if (!adminExists && !emailExists) {
      const hashedPassword = await bcrypt.hash(password, 12);
      const admin: User = {
        id: randomUUID(),
        username,
        email,
        password_hash: hashedPassword,
        must_change_password: mustChangePassword,
        role: 'admin',
        user_type: 'independent',
        library_owner_id: null,
        category_scopes: [],
        permissions: ADMIN_PERMISSIONS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await this.createUser(admin);
      console.log(`Initial admin user created: ${username}`);
    }
  }

  async close(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.close();
    }
    if (this.mysqlPool) {
      await this.mysqlPool.end();
    }
  }

  getDbType(): 'sqlite' | 'mysql' {
    return this.dbType;
  }

  async getServerInfo(): Promise<{ engine: 'SQLite' | 'MySQL' | 'MariaDB'; version: string }> {
    if (this.dbType === 'sqlite') {
      const result = await this.get<{ version: string }>('SELECT sqlite_version() AS version');
      return {
        engine: 'SQLite',
        version: result?.version || 'unknown',
      };
    }

    const result = await this.get<{ version: string }>('SELECT VERSION() AS version');
    const version = result?.version || 'unknown';
    return {
      engine: version.toLowerCase().includes('mariadb') ? 'MariaDB' : 'MySQL',
      version,
    };
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.get<{ ok: number }>('SELECT 1 AS ok');
      return result?.ok === 1;
    } catch {
      return false;
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<unknown> {
    if (this.dbType === 'sqlite' && this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      return stmt.run(...params);
    } else if (this.mysqlPool) {
      const [result] = await this.mysqlPool.execute(sql, normalizeMySQLParams(params, sql));
      return result;
    }
    throw new Error('Database not connected');
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (this.dbType === 'sqlite' && this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } else if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.execute(sql, normalizeMySQLParams(params, sql));
      const results = normalizeMySQLRows<T>(rows);
      return results[0];
    }
    throw new Error('Database not connected');
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.dbType === 'sqlite' && this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      return stmt.all(...params) as T[];
    } else if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.execute(sql, normalizeMySQLParams(params, sql));
      return normalizeMySQLRows<T>(rows);
    }
    throw new Error('Database not connected');
  }

  private normalizePermissions(role: User['role'], permissions?: string | Partial<UserPermissions> | null): UserPermissions {
    const basePermissions = role === 'admin' ? ADMIN_PERMISSIONS : DEFAULT_USER_PERMISSIONS;
    let parsedPermissions: Partial<UserPermissions> = {};

    if (typeof permissions === 'string' && permissions.trim()) {
      try {
        parsedPermissions = JSON.parse(permissions) as Partial<UserPermissions>;
      } catch (error) {
        parsedPermissions = {};
      }
    } else if (permissions && typeof permissions === 'object') {
      parsedPermissions = permissions;
    }

    return {
      ...basePermissions,
      ...parsedPermissions,
      ...(role === 'admin' ? ADMIN_PERMISSIONS : {}),
    };
  }

  private normalizeCategoryScopes(scopes?: string | string[] | null): string[] {
    if (Array.isArray(scopes)) {
      return scopes.filter(Boolean);
    }

    if (typeof scopes === 'string' && scopes.trim()) {
      try {
        const parsed = JSON.parse(scopes);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch (error) {
        return [];
      }
    }

    return [];
  }

  private normalizeUserRecord(record?: Record<string, unknown> | null): User | undefined {
    if (!record) {
      return undefined;
    }

    const role = (record.role as User['role']) || 'user';
    return {
      ...(record as unknown as User),
      role,
      must_change_password: Boolean(Number(record.must_change_password || 0)),
      user_type: (record.user_type as User['user_type']) || 'independent',
      library_owner_id: (record.library_owner_id as string | null) || null,
      category_scopes: this.normalizeCategoryScopes(record.category_scopes as string | string[] | null | undefined),
      permissions: this.normalizePermissions(role, record.permissions as string | Partial<UserPermissions> | null | undefined),
    };
  }

  async createUser(user: User): Promise<User> {
    const sql = `
      INSERT INTO users (id, username, email, password_hash, must_change_password, role, user_type, library_owner_id, category_scopes, permissions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await this.run(sql, [
      user.id,
      user.username,
      user.email,
      user.password_hash,
      user.must_change_password ? 1 : 0,
      user.role,
      user.user_type,
      user.library_owner_id,
      JSON.stringify(user.category_scopes || []),
      JSON.stringify(this.normalizePermissions(user.role, user.permissions)),
      user.created_at,
      user.updated_at,
    ]);
    return this.normalizeUserRecord(user as unknown as Record<string, unknown>)!;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const user = await this.get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [id]);
    return this.normalizeUserRecord(user);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const user = await this.get<Record<string, unknown>>('SELECT * FROM users WHERE username = ?', [username]);
    return this.normalizeUserRecord(user);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const user = await this.get<Record<string, unknown>>('SELECT * FROM users WHERE email = ?', [email]);
    return this.normalizeUserRecord(user);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.username !== undefined) {
      fields.push('username = ?');
      values.push(data.username);
    }
    if (data.email !== undefined) {
      fields.push('email = ?');
      values.push(data.email);
    }
    if (data.password_hash !== undefined) {
      fields.push('password_hash = ?');
      values.push(data.password_hash);
    }
    if (data.must_change_password !== undefined) {
      fields.push('must_change_password = ?');
      values.push(data.must_change_password ? 1 : 0);
    }
    if (data.role !== undefined) {
      fields.push('role = ?');
      values.push(data.role);
    }
    if (data.user_type !== undefined) {
      fields.push('user_type = ?');
      values.push(data.user_type);
    }
    if (data.library_owner_id !== undefined) {
      fields.push('library_owner_id = ?');
      values.push(data.library_owner_id);
    }
    if (data.category_scopes !== undefined) {
      fields.push('category_scopes = ?');
      values.push(JSON.stringify(data.category_scopes || []));
    }
    if (data.permissions !== undefined) {
      fields.push('permissions = ?');
      values.push(JSON.stringify(this.normalizePermissions(data.role || (await this.getUserById(id))?.role || 'user', data.permissions)));
    }

    if (fields.length === 0) return this.getUserById(id);

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    if (data.password_hash !== undefined) {
      await this.setSetting(`auth_legacy_revoked:${id}`, 'true');
    }
    return this.getUserById(id);
  }

  async createCategory(category: Category): Promise<Category> {
    const sql = `
      INSERT INTO categories (id, name, description, parent_id, user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await this.run(sql, [
      category.id,
      category.name,
      category.description,
      category.parent_id,
      category.user_id,
      category.created_at,
      category.updated_at,
    ]);
    return category;
  }

  async getCategoryById(id: string): Promise<Category | undefined> {
    return this.get<Category>('SELECT * FROM categories WHERE id = ?', [id]);
  }

  async getCategoriesByUserId(userId: string, allowedCategoryIds?: string[]): Promise<Category[]> {
    const params: unknown[] = [userId];
    let sql = 'SELECT * FROM categories WHERE user_id = ?';
    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      sql += ` AND id IN (${allowedCategoryIds.map(() => '?').join(',')})`;
      params.push(...allowedCategoryIds);
    }
    sql += ' ORDER BY name';
    return this.all<Category>(sql, params);
  }

  async updateCategory(id: string, data: Partial<Category>): Promise<Category | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      values.push(data.description);
    }
    if (data.parent_id !== undefined) {
      fields.push('parent_id = ?');
      values.push(data.parent_id);
    }

    if (fields.length === 0) return this.getCategoryById(id);

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getCategoryById(id);
  }

  async deleteCategory(id: string): Promise<boolean> {
    const result = await this.run('DELETE FROM categories WHERE id = ?', [id]);
    return getChangedRows(result) > 0;
  }

  async createQuestion(question: Question): Promise<Question> {
    const sql = `
      INSERT INTO questions (id, title, content, answer, explanation, difficulty, category_id, user_id, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await this.run(sql, [
      question.id,
      question.title,
      question.content,
      question.answer,
      question.explanation,
      question.difficulty,
      question.category_id,
      question.user_id,
      question.tags,
      question.created_at,
      question.updated_at,
    ]);
    return { ...question, revision: 1 };
  }

  async getQuestionById(id: string): Promise<Question | undefined> {
    return this.get<Question>('SELECT * FROM questions WHERE id = ?', [id]);
  }

  async getQuestionByIdForUser(id: string, userId: string, isAdmin: boolean = false): Promise<Question | undefined> {
    if (isAdmin) {
      return this.getQuestionById(id);
    }
    return this.get<Question>('SELECT * FROM questions WHERE id = ? AND user_id = ?', [id, userId]);
  }

  private questionConditions(userId: string, filter?: { categoryId?: string; difficulty?: string; keyword?: string; tags?: string[] }, allowedCategoryIds?: string[]) {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (filter?.categoryId) {
      conditions.push('category_id = ?');
      params.push(filter.categoryId);
    }
    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      conditions.push(`category_id IN (${allowedCategoryIds.map(() => '?').join(',')})`);
      params.push(...allowedCategoryIds);
    }
    if (filter?.difficulty) {
      conditions.push('difficulty = ?');
      params.push(filter.difficulty);
    }
    if (filter?.keyword) {
      conditions.push('(title LIKE ? OR content LIKE ? OR answer LIKE ? OR explanation LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    if (filter?.tags && filter.tags.length > 0) {
      const tagConditions = filter.tags.map(() => 'tags LIKE ?').join(' OR ');
      conditions.push(`(${tagConditions})`);
      params.push(...filter.tags.map((tag) => `%"${tag}"%`));
    }

    const whereClause = conditions.join(' AND ');
    return { whereClause, params };
  }

  async getAllQuestions(userId: string, allowedCategoryIds?: string[]): Promise<Question[]> {
    const { whereClause, params } = this.questionConditions(userId, undefined, allowedCategoryIds);
    const questions: Question[] = [];
    let cursor: Question | undefined;
    let more = true;
    while (more) {
      const cursorClause = cursor ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : '';
      const batch = await this.all<Question>(`SELECT * FROM questions WHERE ${whereClause}${cursorClause} ORDER BY created_at DESC, id DESC LIMIT 1000`, [...params, ...(cursor ? [cursor.created_at, cursor.created_at, cursor.id] : [])]);
      questions.push(...batch);
      more = batch.length === 1000;
      if (!more) break;
      cursor = batch[batch.length - 1];
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return questions;
  }

  async getQuestionPosition(id: string, userId: string, filter?: { categoryId?: string; tags?: string[] }, allowedCategoryIds?: string[]): Promise<number | null> {
    const { whereClause, params } = this.questionConditions(userId, filter, allowedCategoryIds);
    const current = await this.get<Question>(`SELECT * FROM questions WHERE ${whereClause} AND id = ?`, [...params, id]);
    if (!current) return null;
    const count = await this.get<{ count: number }>(`SELECT COUNT(*) AS count FROM questions WHERE ${whereClause} AND (created_at > ? OR (created_at = ? AND id > ?))`, [...params, current.created_at, current.created_at, id]);
    return count?.count || 0;
  }

  async getAdjacentQuestion(id: string, userId: string, direction: 'next' | 'prev', filter?: { categoryId?: string; tags?: string[] }, allowedCategoryIds?: string[]): Promise<Question | null> {
    const { whereClause, params } = this.questionConditions(userId, filter, allowedCategoryIds);
    const current = await this.get<Question>(`SELECT * FROM questions WHERE ${whereClause} AND id = ?`, [...params, id]);
    if (!current) return null;
    const comparator = direction === 'next' ? '<' : '>';
    const order = direction === 'next' ? 'DESC' : 'ASC';
    return await this.get<Question>(`SELECT * FROM questions WHERE ${whereClause} AND (created_at ${comparator} ? OR (created_at = ? AND id ${comparator} ?)) ORDER BY created_at ${order}, id ${order} LIMIT 1`, [...params, current.created_at, current.created_at, id]) || null;
  }

  async getQuestions(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
    filter?: { categoryId?: string; difficulty?: string; keyword?: string; tags?: string[] },
    allowedCategoryIds?: string[]
  ): Promise<{ questions: Question[]; total: number }> {
    const { whereClause, params } = this.questionConditions(userId, filter, allowedCategoryIds);
    const offset = (page - 1) * pageSize;

    const questions = await this.all<Question>(
      `SELECT * FROM questions WHERE ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const countResult = await this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM questions WHERE ${whereClause}`,
      params
    );

    return { questions, total: countResult?.count || 0 };
  }

  async getQuestionTags(
    userId: string,
    filter?: { categoryId?: string; difficulty?: string; keyword?: string },
    allowedCategoryIds?: string[]
  ): Promise<{ name: string; count: number }[]> {
    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (filter?.categoryId) {
      conditions.push('category_id = ?');
      params.push(filter.categoryId);
    }
    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      conditions.push(`category_id IN (${allowedCategoryIds.map(() => '?').join(',')})`);
      params.push(...allowedCategoryIds);
    }
    if (filter?.difficulty) {
      conditions.push('difficulty = ?');
      params.push(filter.difficulty);
    }
    if (filter?.keyword) {
      conditions.push('(title LIKE ? OR content LIKE ? OR answer LIKE ? OR explanation LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`);
    }

    const whereClause = conditions.join(' AND ');
    const questions = await this.all<Question>(
      `SELECT tags FROM questions WHERE ${whereClause}`,
      params
    );

    const tagMap = new Map<string, number>();
    for (const question of questions) {
      for (const rawTag of parseStoredTags(question.tags)) {
        const tag = normalizeTagName(rawTag);
        if (!tag) continue;
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }

  async renameQuestionTag(userId: string, fromTag: string, toTag: string): Promise<number> {
    const questions = await this.all<Question>(
      'SELECT id, tags FROM questions WHERE user_id = ?',
      [userId]
    );

    let updatedCount = 0;
    const normalizedFromTag = normalizeTagName(fromTag);
    const normalizedToTag = normalizeTagName(toTag);
    for (const question of questions) {
      const parsedTags = parseStoredTags(question.tags);

      if (!parsedTags.includes(normalizedFromTag)) {
        continue;
      }

      const nextTags = Array.from(new Set(parsedTags.map((tag) => (tag === normalizedFromTag ? normalizedToTag : normalizeTagName(tag))).filter(Boolean)));
      await this.updateQuestion(question.id, { tags: JSON.stringify(nextTags) });
      updatedCount += 1;
    }

    return updatedCount;
  }

  async deleteQuestionTag(userId: string, tagName: string): Promise<number> {
    const questions = await this.all<Question>(
      'SELECT id, tags FROM questions WHERE user_id = ?',
      [userId]
    );

    let updatedCount = 0;
    const normalizedTagName = normalizeTagName(tagName);
    for (const question of questions) {
      const parsedTags = parseStoredTags(question.tags);

      if (!parsedTags.includes(normalizedTagName)) {
        continue;
      }

      const nextTags = parsedTags.filter((tag) => tag !== normalizedTagName);
      await this.updateQuestion(question.id, { tags: JSON.stringify(nextTags) });
      updatedCount += 1;
    }

    return updatedCount;
  }

  async getQuestionVersions(id: string, page = 1, pageSize = 20, allowedCategoryIds?: string[]): Promise<{ data: QuestionVersion[]; total: number }> {
    const categoryExpression = this.dbType === 'sqlite' ? "json_extract(snapshot, '$.category_id')" : "JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.category_id'))";
    const scope = allowedCategoryIds?.length ? ` AND ${categoryExpression} IN (${allowedCategoryIds.map(() => '?').join(',')})` : '';
    const params = [id, ...(allowedCategoryIds || [])];
    const rows = await this.all<QuestionVersion>(`SELECT v.*, u.username AS actor_name FROM question_versions v LEFT JOIN users u ON u.id = v.actor_id WHERE question_id = ?${scope} ORDER BY version DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    const count = await this.get<{ count: number }>(`SELECT COUNT(*) AS count FROM question_versions WHERE question_id = ?${scope}`, params);
    if (!count?.count) {
      const anyVersion = await this.get<{ count: number }>('SELECT COUNT(*) AS count FROM question_versions WHERE question_id = ?', [id]);
      if (anyVersion?.count) return { data: [], total: 0 };
      const question = await this.getQuestionById(id);
      return { data: question && page === 1 ? [{ id: '', question_id: id, version: question.revision || 1, snapshot: JSON.stringify(question), actor_id: null, source: 'initial', created_at: question.created_at }] : [], total: question ? 1 : 0 };
    }
    return { data: rows, total: count.count };
  }

  async getQuestionVersion(id: string, version: number): Promise<QuestionVersion | undefined> {
    const row = await this.get<QuestionVersion>('SELECT * FROM question_versions WHERE question_id = ? AND version = ?', [id, version]);
    if (row) return row;
    const question = await this.getQuestionById(id);
    if (question && version === (question.revision || 1)) return { id: '', question_id: id, version, snapshot: JSON.stringify(question), actor_id: null, source: 'initial', created_at: question.created_at };
    return undefined;
  }

  async updateQuestion(id: string, data: Partial<Question>, options: { actorId?: string; source?: string; expectedRevision?: number; removeId?: string } = {}): Promise<Question | undefined> {
    const editable = ['title', 'content', 'answer', 'explanation', 'difficulty', 'category_id', 'tags'] as const;
    const prepare = (current: Question) => {
      if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) throw new Error('QUESTION_CONFLICT');
      const keys = editable.filter((key) => data[key] !== undefined && data[key] !== current[key]);
      if (!keys.length && !options.removeId) return null;
      const next: Question = { ...current, ...Object.fromEntries(keys.map((key) => [key, data[key]])), revision: (current.revision || 1) + 1, updated_at: new Date().toISOString() };
      const statements = [
        { sql: this.dbType === 'sqlite' ? 'INSERT OR IGNORE INTO question_versions (id, question_id, version, snapshot, actor_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)' : 'INSERT IGNORE INTO question_versions (id, question_id, version, snapshot, actor_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [randomUUID(), id, current.revision || 1, JSON.stringify(current), null, 'initial', current.updated_at] },
        { sql: `UPDATE questions SET ${keys.map((key) => `${key} = ?`).concat(['revision = ?', 'updated_at = ?']).join(', ')} WHERE id = ?`, params: [...keys.map((key) => next[key]), next.revision, next.updated_at, id] },
        { sql: 'INSERT INTO question_versions (id, question_id, version, snapshot, actor_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [randomUUID(), id, next.revision, JSON.stringify(next), options.actorId || null, options.source || 'edit', next.updated_at] },
      ];
      if (options.removeId) statements.push({ sql: 'DELETE FROM questions WHERE id = ?', params: [options.removeId] });
      return { next, statements };
    };
    if (this.sqliteDb) {
      const database = this.sqliteDb;
      return database.transaction(() => {
        const current = database.prepare('SELECT * FROM questions WHERE id = ?').get(id) as Question | undefined;
        if (!current) return undefined;
        const change = prepare(current);
        if (!change) return current;
        for (const statement of change.statements) database.prepare(statement.sql).run(...statement.params);
        return change.next;
      })();
    }
    const connection = await this.mysqlPool!.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<mysql.RowDataPacket[]>('SELECT * FROM questions WHERE id = ? FOR UPDATE', [id]);
      const current = normalizeMySQLRows<Question>(rows)[0];
      const change = current ? prepare(current) : null;
      if (change) for (const statement of change.statements) await connection.execute(statement.sql, normalizeMySQLParams(statement.params, statement.sql));
      await connection.commit();
      return change?.next || current;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async deleteQuestion(id: string): Promise<boolean> {
    const result = await this.run('DELETE FROM questions WHERE id = ?', [id]);
    return getChangedRows(result) > 0;
  }

  async deleteQuestions(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    if (ids.length > 500) {
      let deleted = 0;
      for (let offset = 0; offset < ids.length; offset += 500) deleted += await this.deleteQuestions(ids.slice(offset, offset + 500));
      return deleted;
    }
    const placeholders = ids.map(() => '?').join(',');
    const result = await this.run(`DELETE FROM questions WHERE id IN (${placeholders})`, ids);
    return getChangedRows(result);
  }

  async deleteQuestionsForUser(ids: string[], userId: string, isAdmin: boolean = false): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    if (isAdmin) {
      return this.deleteQuestions(ids);
    }
    const result = await this.run(
      `DELETE FROM questions WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...ids]
    );
    return getChangedRows(result);
  }

  async clearAllQuestions(userId: string): Promise<number> {
    const result = await this.run('DELETE FROM questions WHERE user_id = ?', [userId]);
    return getChangedRows(result);
  }

  async upsertLearningProgress(progress: LearningProgress, preserveBookmark = false): Promise<LearningProgress> {
    const insert = `INSERT INTO learning_progress (id, user_id, question_id, mode, last_viewed_at, view_count, is_bookmarked) VALUES (?, ?, ?, ?, ?, 1, ?)`;
    const update = this.dbType === 'sqlite'
      ? ` ON CONFLICT(user_id, question_id, mode) DO UPDATE SET last_viewed_at = excluded.last_viewed_at, view_count = learning_progress.view_count + 1, is_bookmarked = ${preserveBookmark ? 'learning_progress.is_bookmarked' : 'excluded.is_bookmarked'}`
      : ` ON DUPLICATE KEY UPDATE last_viewed_at = VALUES(last_viewed_at), view_count = view_count + 1, is_bookmarked = ${preserveBookmark ? 'is_bookmarked' : 'VALUES(is_bookmarked)'}`;
    await this.run(insert + update, [progress.id, progress.user_id, progress.question_id, progress.mode, progress.last_viewed_at, progress.is_bookmarked ? 1 : 0]);
    return (await this.getLearningProgress(progress.user_id, progress.question_id, progress.mode))!;
  }

  async getLearningProgress(userId: string, questionId: string, mode: string): Promise<LearningProgress | undefined> {
    return this.get<LearningProgress>(
      'SELECT * FROM learning_progress WHERE user_id = ? AND question_id = ? AND mode = ?',
      [userId, questionId, mode]
    );
  }

  async getReviewState(userId: string, questionId: string): Promise<ReviewState | undefined> {
    return this.get<ReviewState>(
      'SELECT * FROM review_states WHERE user_id = ? AND question_id = ?',
      [userId, questionId]
    );
  }

  async recordReviewEvent(event: ReviewEvent): Promise<{ duplicate: boolean; state: ReviewState }> {
    const recorded = await this.get<{ id: string }>('SELECT id FROM review_events WHERE id = ?', [event.id]);
    const existing = await this.getReviewState(event.user_id, event.question_id);
    if (recorded && existing) {
      return { duplicate: true, state: existing };
    }

    const previousInterval = Number(existing?.interval_days || 0);
    const previousEase = Number(existing?.ease_factor || 2.5);
    const previousRepetitions = Number(existing?.repetitions || 0);
    let intervalDays = previousInterval;
    let easeFactor = previousEase;
    let repetitions = previousRepetitions;
    let lapses = Number(existing?.lapses || 0);
    let dueDelayMs = 0;

    const rating: ReviewRating = event.rating;
    if (rating === 'again') {
      intervalDays = 0;
      easeFactor = Math.max(1.3, previousEase - 0.2);
      repetitions = 0;
      lapses += 1;
      dueDelayMs = 10 * 60 * 1000;
    } else if (rating === 'hard') {
      intervalDays = Math.max(1, previousInterval ? previousInterval * 1.2 : 1);
      easeFactor = Math.max(1.3, previousEase - 0.15);
      repetitions += 1;
      dueDelayMs = intervalDays * 24 * 60 * 60 * 1000;
    } else if (rating === 'easy') {
      intervalDays = previousInterval
        ? Math.max(4, previousInterval * previousEase * 1.3)
        : 4;
      easeFactor = Math.min(3.2, previousEase + 0.15);
      repetitions += 1;
      dueDelayMs = intervalDays * 24 * 60 * 60 * 1000;
    } else {
      intervalDays = previousRepetitions === 0 ? 1 : previousRepetitions === 1 ? 3 : Math.max(3, previousInterval * previousEase);
      repetitions += 1;
      dueDelayMs = intervalDays * 24 * 60 * 60 * 1000;
    }

    const reviewedAtMs = new Date(event.reviewed_at).getTime();
    const dueAt = new Date(reviewedAtMs + dueDelayMs).toISOString();
    const updatedAt = new Date().toISOString();
    const state: ReviewState = {
      id: existing?.id || randomUUID(),
      user_id: event.user_id,
      question_id: event.question_id,
      due_at: dueAt,
      interval_days: Number(intervalDays.toFixed(3)),
      ease_factor: Number(easeFactor.toFixed(2)),
      repetitions,
      lapses,
      last_rating: rating,
      last_reviewed_at: event.reviewed_at,
      updated_at: updatedAt,
    };

    if (!recorded) {
      await this.run(
        `INSERT INTO review_events (id, user_id, question_id, rating, reviewed_at, response_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [event.id, event.user_id, event.question_id, event.rating, event.reviewed_at, event.response_ms, event.created_at]
      );
    }

    if (existing) {
      await this.run(
        `UPDATE review_states SET due_at = ?, interval_days = ?, ease_factor = ?, repetitions = ?,
         lapses = ?, last_rating = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?`,
        [state.due_at, state.interval_days, state.ease_factor, state.repetitions, state.lapses,
          state.last_rating, state.last_reviewed_at, state.updated_at, state.id]
      );
    } else {
      await this.run(
        `INSERT INTO review_states (id, user_id, question_id, due_at, interval_days, ease_factor, repetitions,
         lapses, last_rating, last_reviewed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [state.id, state.user_id, state.question_id, state.due_at, state.interval_days, state.ease_factor,
          state.repetitions, state.lapses, state.last_rating, state.last_reviewed_at, state.updated_at]
      );
    }

    return { duplicate: Boolean(recorded), state };
  }

  async getReviewQueue(
    userId: string,
    libraryOwnerId: string,
    limit: number,
    allowedCategoryIds?: string[]
  ): Promise<ReviewQueueItem[]> {
    const now = new Date().toISOString();
    const conditions = ['q.user_id = ?', '(rs.id IS NULL OR rs.due_at <= ?)'];
    const whereParams: unknown[] = [libraryOwnerId, now];
    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      conditions.push(`q.category_id IN (${allowedCategoryIds.map(() => '?').join(',')})`);
      whereParams.push(...allowedCategoryIds);
    }

    const rows = await this.all<Question & Record<string, unknown>>(
      `SELECT q.*, rs.id AS review_id, rs.due_at AS review_due_at,
       rs.interval_days AS review_interval_days, rs.ease_factor AS review_ease_factor,
       rs.repetitions AS review_repetitions, rs.lapses AS review_lapses,
       rs.last_rating AS review_last_rating, rs.last_reviewed_at AS review_last_reviewed_at,
       rs.updated_at AS review_updated_at
       FROM questions q
       LEFT JOIN review_states rs ON rs.question_id = q.id AND rs.user_id = ?
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN rs.id IS NULL THEN 1 ELSE 0 END, rs.due_at ASC, q.created_at ASC
       LIMIT ?`,
      [userId, ...whereParams, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty,
      category_id: row.category_id,
      user_id: row.user_id,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
      review_state: row.review_id ? {
        id: String(row.review_id),
        user_id: userId,
        question_id: row.id,
        due_at: String(row.review_due_at),
        interval_days: Number(row.review_interval_days),
        ease_factor: Number(row.review_ease_factor),
        repetitions: Number(row.review_repetitions),
        lapses: Number(row.review_lapses),
        last_rating: row.review_last_rating as ReviewRating | null,
        last_reviewed_at: row.review_last_reviewed_at ? String(row.review_last_reviewed_at) : null,
        updated_at: String(row.review_updated_at),
      } : null,
    }));
  }

  async getReviewStats(
    userId: string,
    libraryOwnerId: string,
    allowedCategoryIds?: string[]
  ): Promise<{ due: number; newCount: number; reviewedToday: number }> {
    const now = new Date().toISOString();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const categoryCondition = allowedCategoryIds && allowedCategoryIds.length > 0
      ? ` AND q.category_id IN (${allowedCategoryIds.map(() => '?').join(',')})`
      : '';
    const categoryParams = allowedCategoryIds && allowedCategoryIds.length > 0 ? allowedCategoryIds : [];
    const due = await this.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM review_states rs JOIN questions q ON q.id = rs.question_id
       WHERE rs.user_id = ? AND q.user_id = ? AND rs.due_at <= ?${categoryCondition}`,
      [userId, libraryOwnerId, now, ...categoryParams]
    );
    const newQuestions = await this.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM questions q LEFT JOIN review_states rs ON rs.question_id = q.id AND rs.user_id = ?
       WHERE q.user_id = ? AND rs.id IS NULL${categoryCondition}`,
      [userId, libraryOwnerId, ...categoryParams]
    );
    const reviewedToday = await this.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM review_events re JOIN questions q ON q.id = re.question_id
       WHERE re.user_id = ? AND q.user_id = ? AND re.reviewed_at >= ?${categoryCondition}`,
      [userId, libraryOwnerId, start.toISOString(), ...categoryParams]
    );
    return { due: due?.count || 0, newCount: newQuestions?.count || 0, reviewedToday: reviewedToday?.count || 0 };
  }

  async getBookmarkedQuestions(userId: string, mode: string): Promise<Question[]> {
    return this.all<Question>(
      `SELECT q.* FROM questions q
       JOIN learning_progress lp ON q.id = lp.question_id
       WHERE lp.user_id = ? AND lp.mode = ? AND lp.is_bookmarked = 1
       ORDER BY lp.last_viewed_at DESC`,
      [userId, mode]
    );
  }

  async getLastViewedQuestion(userId: string, mode: string, categoryId?: string): Promise<LearningProgress | undefined> {
    if (categoryId) {
      return this.get<LearningProgress>(
        `SELECT lp.* FROM learning_progress lp
         JOIN questions q ON lp.question_id = q.id
         WHERE lp.user_id = ? AND lp.mode = ? AND q.category_id = ?
         ORDER BY lp.last_viewed_at DESC
         LIMIT 1`,
        [userId, mode, categoryId]
      );
    }
    return this.get<LearningProgress>(
      `SELECT * FROM learning_progress 
       WHERE user_id = ? AND mode = ?
       ORDER BY last_viewed_at DESC
       LIMIT 1`,
      [userId, mode]
    );
  }

  async getLearningStats(userId: string): Promise<{
    totalViewed: number;
    todayViewed: number;
    studyViewed: number;
    quizViewed: number;
    bookmarked: number;
    studyTime: number;
  }> {
    const totalResult = await this.get<{ count: number }>(
      `SELECT COUNT(DISTINCT question_id) as count FROM learning_progress WHERE user_id = ?`,
      [userId]
    );

    const todaySql = this.dbType === 'sqlite'
      ? `SELECT COUNT(*) as count FROM learning_progress WHERE user_id = ? AND date(last_viewed_at) = date('now')`
      : `SELECT COUNT(*) as count FROM learning_progress WHERE user_id = ? AND DATE(last_viewed_at) = UTC_DATE()`;
    const todayResult = await this.get<{ count: number }>(todaySql, [userId]);

    const studyResult = await this.get<{ count: number }>(
      `SELECT COUNT(DISTINCT question_id) as count FROM learning_progress WHERE user_id = ? AND mode = 'study'`,
      [userId]
    );

    const quizResult = await this.get<{ count: number }>(
      `SELECT COUNT(DISTINCT question_id) as count FROM learning_progress WHERE user_id = ? AND mode = 'quiz'`,
      [userId]
    );

    const bookmarkResult = await this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM learning_progress WHERE user_id = ? AND is_bookmarked = 1`,
      [userId]
    );

    const timeResult = await this.get<{ total: number }>(
      `SELECT COALESCE(SUM(view_count), 0) as total FROM learning_progress WHERE user_id = ?`,
      [userId]
    );

    return {
      totalViewed: totalResult?.count || 0,
      todayViewed: todayResult?.count || 0,
      studyViewed: studyResult?.count || 0,
      quizViewed: quizResult?.count || 0,
      bookmarked: bookmarkResult?.count || 0,
      studyTime: timeResult?.total || 0,
    };
  }

  async clearLearningProgress(userId: string): Promise<number> {
    const result = await this.run('DELETE FROM learning_progress WHERE user_id = ?', [userId]);
    return getChangedRows(result);
  }

  async createAIConfig(aiConfig: AIConfig): Promise<AIConfig> {
    await this.run(
      'UPDATE ai_configs SET is_active = 0 WHERE user_id = ?',
      [aiConfig.user_id]
    );
    await this.run(
      `INSERT INTO ai_configs (id, user_id, provider, display_name, base_url, api_key, model, is_active, is_custom, credential_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [aiConfig.id, aiConfig.user_id, aiConfig.provider, aiConfig.display_name || null, aiConfig.base_url || null, encryptSecret(aiConfig.api_key), aiConfig.model, aiConfig.is_active ? 1 : 0, aiConfig.is_custom ? 1 : 0, aiConfig.credential_id || null, aiConfig.created_at, aiConfig.updated_at]
    );
    return aiConfig;
  }

  async getActiveAIConfig(userId: string): Promise<AIConfig | undefined> {
    const result = await this.get<AIConfig>(
      'SELECT * FROM ai_configs WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    return result ? { ...result, api_key: decryptSecret(result.api_key) } : undefined;
  }

  async getAIConfigsByUserId(userId: string): Promise<AIConfig[]> {
    const results = await this.all<AIConfig>('SELECT * FROM ai_configs WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return results.map((result) => ({ ...result, api_key: decryptSecret(result.api_key) }));
  }

  async getAIConfigById(id: string): Promise<AIConfig | undefined> {
    const result = await this.get<AIConfig>('SELECT * FROM ai_configs WHERE id = ?', [id]);
    return result ? { ...result, api_key: decryptSecret(result.api_key) } : undefined;
  }

  async getAIConfigByIdForUser(id: string, userId: string): Promise<AIConfig | undefined> {
    const result = await this.get<AIConfig>('SELECT * FROM ai_configs WHERE id = ? AND user_id = ?', [id, userId]);
    return result ? { ...result, api_key: decryptSecret(result.api_key) } : undefined;
  }

  async updateAIConfig(id: string, data: Partial<AIConfig>): Promise<AIConfig | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.provider !== undefined) {
      fields.push('provider = ?');
      values.push(data.provider);
    }
    if (data.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(data.display_name);
    }
    if (data.base_url !== undefined) {
      fields.push('base_url = ?');
      values.push(data.base_url);
    }
    if (data.api_key !== undefined) {
      fields.push('api_key = ?');
      values.push(encryptSecret(data.api_key));
    }
    if (data.model !== undefined) {
      fields.push('model = ?');
      values.push(data.model);
    }
    if (data.is_active !== undefined) {
      fields.push('is_active = ?');
      values.push(data.is_active ? 1 : 0);
    }
    if (data.is_custom !== undefined) {
      fields.push('is_custom = ?');
      values.push(data.is_custom ? 1 : 0);
    }
    if (data.credential_id !== undefined) {
      fields.push('credential_id = ?');
      values.push(data.credential_id || null);
    }
    if (data.model_status !== undefined) {
      fields.push('model_status = ?');
      values.push(data.model_status);
    }
    if (data.last_checked_at !== undefined) {
      fields.push('last_checked_at = ?');
      values.push(data.last_checked_at);
    }
    if (data.last_check_error !== undefined) {
      fields.push('last_check_error = ?');
      values.push(data.last_check_error);
    }

    if (fields.length === 0) {
      return this.getAIConfigById(id);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.run(`UPDATE ai_configs SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getAIConfigById(id);
  }

  async deleteAIConfig(id: string): Promise<boolean> {
    const result = await this.run('DELETE FROM ai_configs WHERE id = ?', [id]);
    return getChangedRows(result) > 0;
  }

  async deleteAIConfigForUser(id: string, userId: string): Promise<boolean> {
    const result = await this.run('DELETE FROM ai_configs WHERE id = ? AND user_id = ?', [id, userId]);
    return getChangedRows(result) > 0;
  }

  async createAICredential(credential: AICredential): Promise<AICredential> {
    await this.run(
      `INSERT INTO ai_credentials (id, user_id, name, base_url, api_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [credential.id, credential.user_id, credential.name, credential.base_url, encryptSecret(credential.api_key), credential.created_at, credential.updated_at]
    );
    return credential;
  }

  async getAICredentialsByUserId(userId: string): Promise<AICredential[]> {
    const rows = await this.all<AICredential>('SELECT * FROM ai_credentials WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows.map((row) => ({ ...row, api_key: decryptSecret(row.api_key) }));
  }

  async getAICredentialByIdForUser(id: string, userId: string): Promise<AICredential | undefined> {
    const row = await this.get<AICredential>('SELECT * FROM ai_credentials WHERE id = ? AND user_id = ?', [id, userId]);
    return row ? { ...row, api_key: decryptSecret(row.api_key) } : undefined;
  }

  async updateAICredential(id: string, userId: string, data: Partial<AICredential>): Promise<AICredential | undefined> {
    const existing = await this.getAICredentialByIdForUser(id, userId);
    if (!existing) return undefined;
    const name = data.name ?? existing.name;
    const baseUrl = data.base_url ?? existing.base_url;
    const apiKey = data.api_key ?? existing.api_key;
    const updatedAt = new Date().toISOString();
    await this.run(
      'UPDATE ai_credentials SET name = ?, base_url = ?, api_key = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [name, baseUrl, encryptSecret(apiKey), updatedAt, id, userId]
    );
    await this.run(
      'UPDATE ai_configs SET base_url = ?, api_key = ?, model_status = ?, last_checked_at = ?, last_check_error = ?, updated_at = ? WHERE credential_id = ? AND user_id = ?',
      [baseUrl, encryptSecret(apiKey), 'unknown', '', '', updatedAt, id, userId]
    );
    return this.getAICredentialByIdForUser(id, userId);
  }

  async deleteAICredentialForUser(id: string, userId: string): Promise<'deleted' | 'in_use' | 'missing'> {
    const existing = await this.getAICredentialByIdForUser(id, userId);
    if (!existing) return 'missing';
    const usage = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM ai_configs WHERE credential_id = ? AND user_id = ?', [id, userId]);
    if ((usage?.count || 0) > 0) return 'in_use';
    await this.run('DELETE FROM ai_credentials WHERE id = ? AND user_id = ?', [id, userId]);
    return 'deleted';
  }

  async getSetting(key: string): Promise<string | undefined> {
    const result = await this.get<{ value: string }>('SELECT value FROM system_settings WHERE `key` = ?', [key]);
    return result?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    if (this.dbType === 'sqlite') {
      await this.run(
        'INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [key, value, new Date().toISOString()]
      );
    } else {
      await this.run(
        'INSERT INTO system_settings (`key`, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = ?',
        [key, value, new Date().toISOString(), value, new Date().toISOString()]
      );
    }
  }

  async getAllUsers(): Promise<User[]> {
    const users = await this.all<Record<string, unknown>>(
      'SELECT id, username, email, role, user_type, library_owner_id, category_scopes, permissions, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    return users
      .map((user) => this.normalizeUserRecord(user))
      .filter((user): user is User => Boolean(user));
  }

  async getUserCount(): Promise<number> {
    const result = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return result?.count || 0;
  }

  async getQuestionCountByUser(userId: string): Promise<number> {
    const result = await this.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM questions WHERE user_id = ?',
      [userId]
    );
    return result?.count || 0;
  }

  async getCategoryCountByUser(userId: string): Promise<number> {
    const result = await this.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM categories WHERE user_id = ?',
      [userId]
    );
    return result?.count || 0;
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.getUserById(id);
    if (user?.role === 'admin') {
      const adminCount = await this.get<{ count: number }>("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      if (adminCount && adminCount.count <= 1) {
        return false;
      }
    }
    const result = await this.run('DELETE FROM users WHERE id = ?', [id]);
    return getChangedRows(result) > 0;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const existingUser = await this.getUserById(id);
    if (!existingUser) {
      return undefined;
    }

    const permissions = role === 'admin'
      ? ADMIN_PERMISSIONS
      : this.normalizePermissions('user', existingUser.role === 'user' ? existingUser.permissions : DEFAULT_USER_PERMISSIONS);
    await this.run('UPDATE users SET role = ?, user_type = ?, library_owner_id = ?, category_scopes = ?, permissions = ?, updated_at = ? WHERE id = ?', [
      role,
      role === 'admin' ? 'independent' : existingUser.user_type,
      role === 'admin' ? null : existingUser.library_owner_id,
      role === 'admin' ? JSON.stringify([]) : JSON.stringify(existingUser.category_scopes || []),
      JSON.stringify(permissions),
      new Date().toISOString(),
      id,
    ]);
    return this.getUserById(id);
  }

  async getTableCounts(): Promise<DatabaseTableCountSummary> {
    const tables = [
      'users',
      'categories',
      'questions',
      'question_versions',
      'learning_progress',
      'review_states',
      'review_events',
      'ai_credentials',
      'ai_configs',
      'system_settings',
    ] as const;

    const entries = await Promise.all(
      tables.map(async (table) => {
        const result = await this.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
        return [table, result?.count || 0] as const;
      })
    );

    const counts = Object.fromEntries(entries) as Record<string, number>;
    return {
      users: counts.users || 0,
      categories: counts.categories || 0,
      questions: counts.questions || 0,
      question_versions: counts.question_versions || 0,
      learning_progress: counts.learning_progress || 0,
      review_states: counts.review_states || 0,
      review_events: counts.review_events || 0,
      ai_credentials: counts.ai_credentials || 0,
      ai_configs: counts.ai_configs || 0,
      system_settings: counts.system_settings || 0,
    };
  }

  async exportAllData(): Promise<Record<string, Record<string, unknown>[]>> {
    const tables = ['users', 'categories', 'questions', 'question_versions', 'learning_progress', 'review_states', 'review_events', 'ai_credentials', 'ai_configs', 'system_settings'] as const;
    if (this.sqliteDb) {
      const database = this.sqliteDb;
      return database.transaction(() => Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'system_settings' ? '`key`' : 'id'}`).all()])))() as Record<string, Record<string, unknown>[]>;
    }
    const connection = await this.mysqlPool!.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      const dataset: Record<string, Record<string, unknown>[]> = {};
      for (const table of tables) {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY ${table === 'system_settings' ? '`key`' : 'id'}`);
        dataset[table] = normalizeMySQLRows<Record<string, unknown>>(rows);
      }
      await connection.commit();
      return dataset;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async replaceAllData(dataset: Record<string, Record<string, unknown>[]>): Promise<void> {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const collect = async (sql: string, params: unknown[] = []) => { statements.push({ sql, params }); };
    await collect('DELETE FROM review_events');
    await collect('DELETE FROM review_states');
    await collect('DELETE FROM learning_progress');
    await collect('DELETE FROM question_versions');
    await collect('DELETE FROM questions');
    await collect('DELETE FROM categories');
    await collect('DELETE FROM ai_configs');
    await collect('DELETE FROM ai_credentials');
    await collect('DELETE FROM users');
    await collect('DELETE FROM system_settings');

    const restoredUsers = (dataset.users || []).map((row) => ({
      ...row,
      must_change_password: row.must_change_password ?? 0,
      user_type: row.user_type ?? 'independent',
      library_owner_id: row.library_owner_id ?? null,
      category_scopes: row.category_scopes ?? '[]',
    }));
    await this.bulkInsert('users', ['id', 'username', 'email', 'password_hash', 'must_change_password', 'role', 'user_type', 'library_owner_id', 'category_scopes', 'permissions', 'created_at', 'updated_at'], restoredUsers, collect);
    await this.bulkInsert('categories', ['id', 'name', 'description', 'parent_id', 'user_id', 'created_at', 'updated_at'], orderRestoredCategories(dataset.categories || []), collect);
    await this.bulkInsert('questions', ['id', 'title', 'content', 'answer', 'explanation', 'difficulty', 'category_id', 'user_id', 'tags', 'created_at', 'updated_at', 'revision'], (dataset.questions || []).map((row) => ({ ...row, revision: row.revision ?? 1 })), collect);
    await this.bulkInsert('question_versions', ['id', 'question_id', 'version', 'snapshot', 'actor_id', 'source', 'created_at'], dataset.question_versions || [], collect);
    await this.bulkInsert('learning_progress', ['id', 'user_id', 'question_id', 'mode', 'last_viewed_at', 'view_count', 'is_bookmarked'], dataset.learning_progress || [], collect);
    await this.bulkInsert('review_states', ['id', 'user_id', 'question_id', 'due_at', 'interval_days', 'ease_factor', 'repetitions', 'lapses', 'last_rating', 'last_reviewed_at', 'updated_at'], dataset.review_states || [], collect);
    await this.bulkInsert('review_events', ['id', 'user_id', 'question_id', 'rating', 'reviewed_at', 'response_ms', 'created_at'], dataset.review_events || [], collect);
    const encryptedAICredentials = (dataset.ai_credentials || []).map((row) => ({
      ...row,
      api_key: typeof row.api_key === 'string' ? protectStoredSecret(row.api_key) : row.api_key,
    }));
    await this.bulkInsert('ai_credentials', ['id', 'user_id', 'name', 'base_url', 'api_key', 'created_at', 'updated_at'], encryptedAICredentials, collect);
    const encryptedAIConfigs = (dataset.ai_configs || []).map((row) => ({
      ...row,
      api_key: typeof row.api_key === 'string' ? protectStoredSecret(row.api_key) : row.api_key,
      credential_id: row.credential_id ?? null,
    }));
    await this.bulkInsert('ai_configs', ['id', 'user_id', 'provider', 'display_name', 'base_url', 'api_key', 'model', 'is_active', 'is_custom', 'credential_id', 'model_status', 'last_checked_at', 'last_check_error', 'created_at', 'updated_at'], encryptedAIConfigs, collect);
    await this.bulkInsert('system_settings', ['key', 'value', 'updated_at'], dataset.system_settings || [], collect);
    if (this.dbType === 'sqlite' && this.sqliteDb) {
      const database = this.sqliteDb;
      database.transaction(() => {
        for (const statement of statements) database.prepare(statement.sql).run(...statement.params);
      })();
      return;
    }
    if (!this.mysqlPool) throw new Error('Database not connected');
    const connection = await this.mysqlPool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of statements) {
        await connection.execute(statement.sql, normalizeMySQLParams(statement.params, statement.sql));
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async bulkInsert(table: string, columns: string[], rows: Record<string, unknown>[], execute: (sql: string, params: unknown[]) => Promise<unknown> = (sql, params) => this.run(sql, params)): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${columns.map((column) => (column === 'key' ? '`key`' : column)).join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      await execute(
        sql,
        columns.map((column) => {
          const value = row[column];
          if (typeof value === 'boolean') {
            return value ? 1 : 0;
          }
          return value ?? null;
        })
      );
    }
  }
}

export const db = new DatabaseManager();
