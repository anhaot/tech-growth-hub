import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { ImportQuestion } from '../src/services/questionImport.js';

// Resolve before changing cwd; all application state lives in the temporary directory.
const bankDirectory = path.resolve(__dirname, '../../question-bank/2026-10-17');

test('public bank imports all categories, preserves every field and exports the same questions', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tgh-public-bank-'));
  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };
  let database: typeof import('../src/database/index.js')['db'] | undefined;
  try {
    process.chdir(temporary);
    Object.assign(process.env, {
      NODE_ENV: 'test', DATABASE_TYPE: 'sqlite', SQLITE_PATH: path.join(temporary, 'bank.db'),
      DATABASE_RUNTIME_CONFIG_PATH: path.join(temporary, 'runtime.json'),
      DOTENV_CONFIG_PATH: path.join(temporary, 'absent.env'),
      JWT_SECRET: 'public-bank-isolated-test-secret', AI_CONFIG_ENCRYPTION_KEY: '4'.repeat(64),
      AI_ENABLED: 'false', TRUST_PROXY: 'false',
      INIT_ADMIN_USERNAME: 'bank-test', INIT_ADMIN_EMAIL: 'bank-test@example.test',
      INIT_ADMIN_PASSWORD: 'BankTest12345', INIT_ADMIN_FORCE_PASSWORD_CHANGE: 'false',
    });
    const { config } = await import('../src/config/index.js');
    assert.equal(config.database.type, 'sqlite');
    assert.equal(config.database.sqlite.path, path.join(temporary, 'bank.db'));
    const { db } = await import('../src/database/index.js');
    database = db;
    await db.connect();
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const login = await request(app).post('/api/auth/login')
      .send({ username: 'bank-test', password: 'BankTest12345' });
    assert.equal(login.status, 200);
    const token: string = login.body.token;
    assert.ok(token);
    const categories: Array<{ name: string; file: string; count: number }> =
      JSON.parse(fs.readFileSync(path.join(bankDirectory, 'categories.json'), 'utf8'));
    assert.equal(categories.length, 16);
    assert.equal(new Set(categories.map(category => category.name)).size, categories.length);
    const expected = new Map<string, ImportQuestion>();
    const contents = new Set<string>();
    const answers = new Set<string>();
    for (const category of categories) {
      const filename = path.resolve(bankDirectory, category.file);
      assert.ok(filename.startsWith(bankDirectory + path.sep));
      const bank = JSON.parse(fs.readFileSync(filename, 'utf8'));
      assert.equal(bank.formatVersion, 1);
      assert.equal(bank.questions.length, category.count);
      const created = await request(app).post('/api/categories')
        .auth(token, { type: 'bearer' }).send({ name: category.name });
      assert.equal(created.status, 201);
      const categoryId: string = created.body.id;
      assert.ok(categoryId);
      for (const question of bank.questions as ImportQuestion[]) {
        assert.deepEqual(Object.keys(question).sort(),
          ['title', 'content', 'answer', 'explanation', 'difficulty', 'categoryId'].sort());
        assert.equal(question.categoryId, null, 'public files must not retain private category IDs');
        assert.ok(question.title.trim() && question.content.trim() && question.answer.trim());
        assert.ok(['easy', 'medium', 'hard'].includes(question.difficulty));
        assert.ok(!expected.has(question.title), `duplicate title: ${question.title}`);
        assert.ok(!contents.has(question.content.trim()), `duplicate question: ${question.title}`);
        assert.ok(!answers.has(question.answer.trim()), `duplicate answer: ${question.title}`);
        contents.add(question.content.trim());
        answers.add(question.answer.trim());
        expected.set(question.title, { ...question, categoryId });
      }
      const preview = await request(app).post('/api/import/preview/json')
        .auth(token, { type: 'bearer' }).field('categoryId', categoryId).attach('file', filename);
      assert.equal(preview.status, 200);
      assert.equal(preview.body.total, category.count);
      assert.equal(preview.body.valid, category.count);
      assert.equal(preview.body.invalid, 0);
      const rows = [...preview.body.rows];
      for (let page = 2; page <= preview.body.totalPages; page++) {
        const response = await request(app).get(`/api/import/preview/${preview.body.id}?page=${page}`)
          .auth(token, { type: 'bearer' });
        assert.equal(response.status, 200);
        rows.push(...response.body.rows);
      }
      assert.equal(rows.length, category.count);
      for (const row of rows) {
        assert.equal(row.error, undefined);
        assert.deepEqual(row.warnings, []);
        assert.equal(row.question.categoryId, categoryId);
      }
      const imported = await request(app).post(`/api/import/preview/${preview.body.id}/commit`)
        .auth(token, { type: 'bearer' }).send({ excludedRows: [] });
      assert.equal(imported.status, 200);
      assert.equal(imported.body.success, category.count);
      assert.equal(imported.body.failed, 0);
      assert.equal(imported.body.skipped, 0);
      assert.equal((await db.getQuestions(login.body.user.id, 1, 1000, { categoryId })).total,
        category.count);
    }
    assert.equal(expected.size, 178);
    const stored = await db.getQuestions(login.body.user.id, 1, 1000);
    assert.equal(stored.total, expected.size);
    for (const question of stored.questions) {
      const value = expected.get(question.title)!;
      assert.ok(value);
      for (const field of ['title', 'content', 'answer', 'difficulty'] as const) {
        assert.equal(question[field], value[field]);
      }
      assert.equal(question.explanation ?? '', value.explanation);
      assert.equal(question.category_id, value.categoryId);
    }
    const exported = await request(app).get('/api/questions/export').auth(token, { type: 'bearer' });
    assert.equal(exported.status, 200);
    assert.equal(exported.body.total, expected.size);
    for (const question of exported.body.questions) {
      assert.deepEqual({ ...question, explanation: question.explanation ?? '' }, expected.get(question.title));
    }
  } finally {
    try { await database?.close(); }
    finally {
      process.chdir(previousCwd);
      for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
      Object.assign(process.env, previousEnv);
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
});
