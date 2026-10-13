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
    await db.replaceAllData({});
    // Emulate the original schema so reconnect also verifies existing deployments.
    await db.run('ALTER TABLE system_settings MODIFY COLUMN `key` VARCHAR(50) NOT NULL');
    await db.run('ALTER TABLE questions MODIFY COLUMN content TEXT NOT NULL, MODIFY COLUMN answer TEXT NOT NULL, MODIFY COLUMN explanation TEXT NULL');
    await db.close();
    await db.connect();
    const keyColumn = await db.get<{ Type: string }>("SHOW COLUMNS FROM system_settings LIKE 'key'");
    assert.equal(keyColumn?.Type, 'varchar(100)');
    for (const column of ['content', 'answer', 'explanation']) {
      assert.equal((await db.get<{ Type: string }>(`SHOW COLUMNS FROM questions LIKE '${column}'`))?.Type, 'longtext');
    }
    const userId = randomUUID();
    const literal = '2026-10-08T07:31:30.123Z';
    await db.run('INSERT INTO users (id, username, email, password_hash, role, category_scopes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, `backup-${userId}`, `${userId}@example.com`, 'unused-test-password-hash', 'admin', '[]', literal, literal]);
    await db.updateUser(userId, { password_hash: 'replacement-test-password-hash' });
    assert.equal(await db.getSetting(`auth_legacy_revoked:${userId}`), 'true');
    const question = await db.createQuestion({
      id: randomUUID(), user_id: userId, category_id: null, difficulty: 'medium',
      title: literal, content: literal, answer: literal, explanation: literal,
      tags: '[]', created_at: literal, updated_at: literal,
    });
    const longText = '中文题库长答案'.repeat(5000);
    const largeQuestion = await db.createQuestion({ ...question, id: randomUUID(), content: longText, answer: longText, explanation: longText });
    assert.equal((await db.getQuestionById(largeQuestion.id))?.answer, longText);
    const firstConfig = await db.createAIConfig({ id: randomUUID(), user_id: userId, provider: 'openai', api_key: 'first-key', model: 'first', is_active: true, created_at: literal, updated_at: literal });
    await assert.rejects(db.createAIConfig(firstConfig));
    assert.equal((await db.getActiveAIConfig(userId))?.id, firstConfig.id);
    await Promise.all(Array.from({ length: 4 }, (_, index) => db.createAIConfig({ ...firstConfig, id: randomUUID(), model: `concurrent-${index}` })));
    assert.equal((await db.getAIConfigsByUserId(userId)).filter(config => config.is_active).length, 1);
    await db.activateAIConfigForUser(firstConfig.id, userId);
    await assert.rejects(db.activateAIConfigForUser(randomUUID(), userId), /AI_CONFIG_NOT_FOUND/);
    assert.equal((await db.getActiveAIConfig(userId))?.id, firstConfig.id);
    for (const mode of ['study', 'quiz']) {
      await db.upsertLearningProgress({ id: randomUUID(), user_id: userId, question_id: question.id, mode, last_viewed_at: literal, view_count: 0, is_bookmarked: true });
    }
    const beforeProgress = await db.getLearningProgress(userId, question.id, 'study');
    assert.equal(await db.removeBookmarks(userId, 'study', [question.id]), 1);
    const afterProgress = await db.getLearningProgress(userId, question.id, 'study');
    assert.equal(Boolean(afterProgress?.is_bookmarked), false);
    assert.equal(afterProgress?.last_viewed_at, beforeProgress?.last_viewed_at);
    assert.equal(afterProgress?.view_count, beforeProgress?.view_count);
    assert.equal(Boolean((await db.getLearningProgress(userId, question.id, 'quiz'))?.is_bookmarked), true);
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
    const originalAdmin = (await db.getUserById(userId))!;
    const otherAdmin = await db.createUser({ ...originalAdmin, id: randomUUID(), username: `second-${userId}`, email: `second-${userId}@example.com` });
    const demotions = await Promise.allSettled([db.updateUserRole(userId, 'user'), db.updateUser(otherAdmin.id, { role: 'user' })]);
    assert.equal(demotions.filter(result => result.status === 'fulfilled').length, 1);
    const lastAdmin = (await db.getAllUsers()).find(user => user.role === 'admin')!;
    assert.ok(lastAdmin);
    assert.equal(await db.deleteUser(lastAdmin.id), false);
    await assert.rejects(db.updateUserRole(lastAdmin.id, 'user'), /LAST_ADMIN/);
    await assert.rejects(db.updateUser(lastAdmin.id, { role: 'user' }), /LAST_ADMIN/);
    await db.updateUserRole(userId, 'admin');
    await db.updateUserRole(otherAdmin.id, 'admin');
    const deletions = await Promise.all([db.deleteUser(userId), db.deleteUser(otherAdmin.id)]);
    assert.equal(deletions.filter(Boolean).length, 1);
    assert.equal((await db.getAllUsers()).filter(user => user.role === 'admin').length, 1);
  } finally {
    await db.close();
  }
});
