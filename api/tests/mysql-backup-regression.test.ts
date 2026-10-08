import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'mysql-backup-regression-secret';
process.env.AI_CONFIG_ENCRYPTION_KEY = '2222222222222222222222222222222222222222222222222222222222222222';

test('MySQL backup restoration preserves timestamp-shaped content and fractional version timestamps', async () => {
  const database = process.env.MYSQL_TEST_DATABASE;
  assert.ok(database?.startsWith('tgh_test_'), 'Use a dedicated MYSQL_TEST_DATABASE starting with tgh_test_');
  const { DatabaseManager } = await import('../src/database/index.js');
  const db = new DatabaseManager({
    type: 'mysql',
    sqlite: { path: ':memory:' },
    mysql: {
      host: process.env.MYSQL_TEST_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_TEST_PORT || 3306),
      user: process.env.MYSQL_TEST_USER || 'ci_test',
      password: process.env.MYSQL_TEST_PASSWORD || '',
      database,
    },
  }, { skipDefaultAdmin: true });
  try {
    await db.connect();
    const userId = randomUUID();
    const literal = '2026-10-08T07:31:30.123Z';
    await db.run('INSERT INTO users (id, username, email, password_hash, role, category_scopes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, `backup-${userId}`, `${userId}@example.com`, 'unused-test-password-hash', 'admin', '[]', literal, literal]);
    const question = await db.createQuestion({
      id: randomUUID(), user_id: userId, category_id: null, difficulty: 'medium',
      title: literal, content: literal, answer: literal, explanation: literal,
      tags: '[]', created_at: literal, updated_at: literal,
    });
    await db.updateQuestion(question.id, { tags: '["backup"]' }, { expectedRevision: 1 });
    await db.run('UPDATE question_versions SET created_at = ? WHERE question_id = ? AND version = ?', [literal, question.id, 2]);
    await db.setSetting(`timestamp:${userId}`, literal);
    const before = await db.exportAllData();
    assert.equal(before.question_versions.find((row) => row.question_id === question.id && row.version === 2)?.created_at, literal);
    await db.replaceAllData(before);
    assert.deepEqual(await db.exportAllData(), before);
    const restored = await db.getQuestionById(question.id);
    assert.equal(restored?.content, literal);
    assert.equal(restored?.answer, literal);
    assert.equal(await db.getSetting(`timestamp:${userId}`), literal);
  } finally {
    await db.close();
  }
});
