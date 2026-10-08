import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserPermissions } from '../src/types/index.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.AI_CONFIG_ENCRYPTION_KEY = '1111111111111111111111111111111111111111111111111111111111111111';
process.env.DATABASE_TYPE = 'sqlite';
process.env.SQLITE_PATH = path.join(os.tmpdir(), `tech-growth-hub-test-${Date.now()}.db`);
process.env.AI_ENABLED = 'true';
process.env.TRUST_PROXY = '1';
process.env.AUTH_COOKIE_SECURE = 'auto';
process.env.INIT_ADMIN_USERNAME = 'admin';
process.env.INIT_ADMIN_EMAIL = 'admin@localhost';
process.env.INIT_ADMIN_PASSWORD = 'admin';
process.env.INIT_ADMIN_FORCE_PASSWORD_CHANGE = 'true';

type LoginResult = {
  token: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    must_change_password: boolean;
  };
};

let app: ReturnType<typeof request>;
let db: Awaited<typeof import('../src/database/index.js')>['db'];
let testIpSequence = 30;

function nextTestIp(): string {
  testIpSequence += 1;
  return `203.0.113.${testIpSequence}`;
}

const NO_PERMISSIONS: UserPermissions = {
  question_view: false,
  question_create: false,
  question_edit_content: false,
  question_edit_meta: false,
  question_delete: false,
  question_batch_edit: false,
  category_view: false,
  category_manage: false,
  import_manage: false,
  question_export: false,
  ai_use: false,
  ai_generate: false,
  ai_config_manage: false,
  ai_chat: false,
  tag_manage: false,
  duplicate_manage: false,
  backup_export: false,
  backup_restore: false,
  ai_polish: false,
  system_manage: false,
  user_manage: false,
};

async function createUser(username: string, email: string, password: string): Promise<LoginResult> {
  const registerResponse = await app
    .post('/api/auth/register')
    .set('X-Forwarded-For', nextTestIp())
    .send({ username, email, password });

  assert.equal(registerResponse.status, 201);
  return registerResponse.body as LoginResult;
}

async function createQuestion(userId: string, title: string) {
  return db.createQuestion({
    id: randomUUID(),
    title,
    content: `${title} content`,
    answer: `${title} answer`,
    explanation: null,
    difficulty: 'medium',
    category_id: null,
    user_id: userId,
    tags: '[]',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function createAiConfig(userId: string) {
  return db.createAIConfig({
    id: randomUUID(),
    user_id: userId,
    provider: 'openai',
    display_name: 'test-openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'secret-key',
    model: 'gpt-4o-mini',
    is_active: true,
    is_custom: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

test.before(async () => {
  const [{ createApp }, databaseModule] = await Promise.all([
    import('../src/app.js'),
    import('../src/database/index.js'),
  ]);

  db = databaseModule.db;
  await db.connect();
  app = request(createApp());
});

test.after(async () => {
  await db.close();
  if (fs.existsSync(process.env.SQLITE_PATH!)) {
    fs.unlinkSync(process.env.SQLITE_PATH!);
  }
});

test('default admin must change the initial password before using protected APIs', async () => {
  const initialLogin = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', '203.0.113.10')
    .send({ username: 'admin', password: 'admin' });

  assert.equal(initialLogin.status, 200);
  assert.equal(initialLogin.body.user.role, 'admin');
  assert.equal(initialLogin.body.user.must_change_password, true);

  const token = initialLogin.body.token as string;
  const blocked = await app
    .get('/api/questions')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(blocked.status, 428);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

  const changed = await app
    .put('/api/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'AdminPass123' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.must_change_password, false);

  const allowed = await app
    .get('/api/questions')
    .set('Cookie', (changed.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; '));
  assert.equal(allowed.status, 200);
  const revoked = await app.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(revoked.status, 401);

  const oldPasswordLogin = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', '203.0.113.10')
    .send({ username: 'admin', password: 'admin' });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', '203.0.113.10')
    .send({ username: 'admin', password: 'AdminPass123' });
  assert.equal(newPasswordLogin.status, 200);
  assert.equal(newPasswordLogin.body.user.must_change_password, false);
});

test('register endpoint is blocked when allow_register is disabled', async () => {
  await db.setSetting('allow_register', 'false');

  const response = await app
    .post('/api/auth/register')
    .send({
      username: 'blocked-user',
      email: 'blocked@example.com',
      password: 'Password123',
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, '当前已关闭注册');

  await db.setSetting('allow_register', 'true');
});

test('authentication cookies follow the actual HTTP or HTTPS request protocol', async () => {
  const httpResponse = await app
    .post('/api/auth/register')
    .set('X-Forwarded-For', '203.0.113.20')
    .send({
      username: 'http-cookie-user',
      email: 'http-cookie@example.com',
      password: 'Password123',
    });
  assert.equal(httpResponse.status, 201);
  const httpCookies = httpResponse.headers['set-cookie'] as unknown as string[];
  assert.equal(httpCookies.length, 2);
  assert.ok(httpCookies.every((cookie) => !cookie.includes('; Secure')));

  const httpsResponse = await app
    .post('/api/auth/register')
    .set('X-Forwarded-For', '203.0.113.21')
    .set('X-Forwarded-Proto', 'https')
    .send({
      username: 'https-cookie-user',
      email: 'https-cookie@example.com',
      password: 'Password123',
    });
  assert.equal(httpsResponse.status, 201);
  const httpsCookies = httpsResponse.headers['set-cookie'] as unknown as string[];
  assert.equal(httpsCookies.length, 2);
  assert.ok(httpsCookies.every((cookie) => cookie.includes('; Secure')));
});

test('batch delete only deletes questions owned by the current user', async () => {
  const owner = await createUser('owner-user', 'owner@example.com', 'Password123');
  const other = await createUser('other-user', 'other@example.com', 'Password123');

  const ownerQuestion = await createQuestion(owner.user.id, 'owner-question');
  const otherQuestion = await createQuestion(other.user.id, 'other-question');

  const response = await app
    .post('/api/questions/batch-delete')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ ids: [ownerQuestion.id, otherQuestion.id] });

  assert.equal(response.status, 200);
  assert.match(response.body.message, /已删除 1 道题目/);
  assert.equal(await db.getQuestionById(ownerQuestion.id), undefined);
  assert.notEqual(await db.getQuestionById(otherQuestion.id), undefined);
});

test('users cannot update or delete another user AI config', async () => {
  const configOwner = await createUser('config-owner', 'config-owner@example.com', 'Password123');
  const attacker = await createUser('config-attacker', 'config-attacker@example.com', 'Password123');
  const aiConfig = await createAiConfig(configOwner.user.id);

  const updateResponse = await app
    .put(`/api/ai/config/${aiConfig.id}`)
    .set('Authorization', `Bearer ${attacker.token}`)
    .send({ model: 'gpt-4.1-mini' });

  assert.equal(updateResponse.status, 404);

  const deleteResponse = await app
    .delete(`/api/ai/config/${aiConfig.id}`)
    .set('Authorization', `Bearer ${attacker.token}`);

  assert.equal(deleteResponse.status, 404);
  assert.notEqual(await db.getAIConfigById(aiConfig.id), undefined);
});

test('AI status lists every configured model and provider names prefer the active config', async () => {
  const owner = await createUser('model-selector', 'model-selector@example.com', 'Password123');
  const olderConfig = await db.createAIConfig({
    id: randomUUID(),
    user_id: owner.user.id,
    provider: 'openai',
    display_name: 'Older model',
    base_url: 'https://api.openai.com/v1',
    api_key: 'older-secret',
    model: 'older-model',
    is_active: false,
    is_custom: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  const activeConfig = await db.createAIConfig({
    id: randomUUID(),
    user_id: owner.user.id,
    provider: 'openai',
    display_name: 'Active model',
    base_url: 'https://api.openai.com/v1',
    api_key: 'active-secret',
    model: 'active-model',
    is_active: true,
    is_custom: false,
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  });

  const status = await app
    .get('/api/ai/status')
    .set('Authorization', `Bearer ${owner.token}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.defaultConfigId, activeConfig.id);
  assert.equal(status.body.availableModels.length, 2);
  assert.deepEqual(
    new Set(status.body.availableModels.map((model: { id: string }) => model.id)),
    new Set([olderConfig.id, activeConfig.id])
  );

  const { aiService } = await import('../src/services/ai.js');
  const selectedByLegacyName = await aiService.getProvider('openai', { userId: owner.user.id, role: 'user' });
  assert.equal(selectedByLegacyName.name, 'Active model');
  const selectedById = await aiService.getProvider(olderConfig.id, { userId: owner.user.id, role: 'user' });
  assert.equal(selectedById.name, 'Older model');
});

test('custom AI models reference separately managed credentials', async () => {
  const login = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', nextTestIp())
    .send({ username: 'admin', password: 'AdminPass123' });
  assert.equal(login.status, 200);
  const token = login.body.token as string;

  const invalidCredential = await app
    .post('/api/ai/credentials')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Invalid NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'not-a-key' });
  assert.equal(invalidCredential.status, 400);
  assert.match(invalidCredential.body.error, /nvapi-/);

  const credential = await app
    .post('/api/ai/credentials')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'NVIDIA test', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'nvapi-test-secret' });
  assert.equal(credential.status, 201);
  assert.equal(credential.body.apiKey, undefined);

  const aiConfig = await app
    .post('/api/ai/config')
    .set('Authorization', `Bearer ${token}`)
    .send({
      provider: 'nvidia',
      displayName: 'Test model',
      model: 'test/model',
      isCustom: true,
      credentialId: credential.body.id,
    });
  assert.equal(aiConfig.status, 201);
  assert.equal(aiConfig.body.credentialId, credential.body.id);

  const cannotDeleteInUse = await app
    .delete(`/api/ai/credentials/${credential.body.id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(cannotDeleteInUse.status, 409);
});

test('stored AI credentials and exported backups are encrypted at rest', async () => {
  const owner = await createUser('encrypted-config', 'encrypted-config@example.com', 'Password123');
  const aiConfig = await createAiConfig(owner.user.id);

  const loaded = await db.getAIConfigById(aiConfig.id);
  assert.equal(loaded?.api_key, 'secret-key');

  const backup = await db.exportAllData();
  const rawConfig = backup.ai_configs.find((item) => item.id === aiConfig.id);
  assert.equal(typeof rawConfig?.api_key, 'string');
  assert.match(String(rawConfig?.api_key), /^enc:v1:/);
  assert.notEqual(rawConfig?.api_key, 'secret-key');
});

test('AI question endpoints cannot access another user question', async () => {
  const questionOwner = await createUser('question-owner', 'question-owner@example.com', 'Password123');
  const attacker = await createUser('question-attacker', 'question-attacker@example.com', 'Password123');
  const question = await createQuestion(questionOwner.user.id, 'private-question');

  const response = await app
    .post('/api/ai/analyze')
    .set('Authorization', `Bearer ${attacker.token}`)
    .send({ questionId: question.id });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, '题目不存在');
});

test('cookie authenticated writes require a matching CSRF token', async () => {
  const registerResponse = await app
    .post('/api/auth/register')
    .send({ username: 'csrf-user', email: 'csrf@example.com', password: 'Password123' });
  assert.equal(registerResponse.status, 201);

  const setCookies = registerResponse.headers['set-cookie'] as unknown as string[];
  const cookieHeader = setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
  const csrfToken = setCookies
    .map((cookie) => cookie.split(';')[0])
    .find((cookie) => cookie.startsWith('tgh_csrf='))
    ?.slice('tgh_csrf='.length);
  assert.ok(csrfToken);

  const rejected = await app
    .post('/api/questions')
    .set('Cookie', cookieHeader)
    .send({ title: 'csrf rejected', content: 'csrf rejected' });
  assert.equal(rejected.status, 403);

  const bearerBypass = await app.post('/api/questions')
    .set('Cookie', cookieHeader).set('Authorization', 'Bearer invalid')
    .send({ title: 'csrf bypass', content: 'csrf bypass' });
  assert.equal(bearerBypass.status, 401);
  const emptyBearer = await app.post('/api/questions')
    .set('Cookie', cookieHeader).set('Authorization', 'Bearer ')
    .send({ title: 'empty bearer bypass', content: 'empty bearer bypass' });
  assert.equal(emptyBearer.status, 403);
  const unicodeToken = await app.post('/api/questions')
    .set('Cookie', 'tgh_auth=' + registerResponse.body.token + '; tgh_csrf=%E4%B8%AD')
    .set('X-CSRF-Token', 'a').send({ title: 'unicode csrf', content: 'unicode csrf' });
  assert.equal(unicodeToken.status, 403);

  const accepted = await app
    .post('/api/questions')
    .set('Cookie', cookieHeader)
    .set('X-CSRF-Token', csrfToken)
    .send({ title: 'csrf accepted', content: 'csrf accepted' });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.answer, '');
});

test('session lifetime uses the environment fallback and matches JWT and cookies', async () => {
  const { config } = await import('../src/config/index.js');
  const original = config.jwt.expiresIn;
  try {
    config.jwt.expiresIn = '12h';
    const response = await app.post('/api/auth/register').set('X-Forwarded-For', nextTestIp())
      .send({ username: 'lifetime-env', email: 'lifetime-env@example.com', password: 'Password123' });
    assert.equal(response.status, 201);
    const decoded = jwt.decode(response.body.token) as jwt.JwtPayload;
    assert.equal(decoded.exp! - decoded.iat!, 12 * 3600);
    assert.ok((response.headers['set-cookie'] as unknown as string[]).every((cookie) => cookie.includes('Max-Age=43200')));
  } finally {
    config.jwt.expiresIn = original;
  }
});

test('session duration settings validate input, permissions, and refresh the current cookie session', async () => {
  const admin = await app.post('/api/auth/login').set('X-Forwarded-For', nextTestIp())
    .send({ username: 'admin', password: 'AdminPass123' });
  const token = admin.body.token;
  const regular = await createUser('lifetime-regular', 'lifetime-regular@example.com', 'Password123');
  const denied = await app.put('/api/admin/settings/login_session_duration')
    .set('Authorization', `Bearer ${regular.token}`).send({ value: 'forever' });
  assert.equal(denied.status, 403);
  for (const value of ['0d', '-1h', '1.5d', '366d', '30', '1s', 'bad']) {
    const rejected = await app.put('/api/admin/settings/login_session_duration')
      .set('Authorization', `Bearer ${token}`).send({ value });
    assert.equal(rejected.status, 400, value);
  }
  try {
    const saved = await app.put('/api/admin/settings/login_session_duration')
      .set('Authorization', `Bearer ${token}`).send({ value: '30d' });
    assert.equal(saved.status, 200);
    const settings = await app.get('/api/admin/settings').set('Authorization', `Bearer ${token}`);
    assert.equal(settings.body.loginSessionDuration, '30d');
    const csrf = await app.get('/api/auth/csrf');
    const refreshed = await app.post('/api/auth/session')
      .set('Cookie', `tgh_auth=${token}; tgh_csrf=${csrf.body.csrfToken}`)
      .set('X-CSRF-Token', csrf.body.csrfToken).send({});
    assert.equal(refreshed.status, 200);
    const cookies = refreshed.headers['set-cookie'] as unknown as string[];
    assert.ok(cookies.every((cookie) => cookie.includes('Max-Age=2592000')));
    const authToken = decodeURIComponent(cookies.find((cookie) => cookie.startsWith('tgh_auth='))!.split(';')[0].slice(9));
    const decoded = jwt.decode(authToken) as jwt.JwtPayload;
    assert.equal(decoded.exp! - decoded.iat!, 30 * 86400);
    const login = await app.post('/api/auth/login').set('X-Forwarded-For', nextTestIp())
      .send({ username: 'lifetime-regular', password: 'Password123' });
    const loginDecoded = jwt.decode(login.body.token) as jwt.JwtPayload;
    assert.equal(loginDecoded.exp! - loginDecoded.iat!, 30 * 86400);
  } finally {
    await db.setSetting('login_session_duration', '7d');
  }
});

test('unlimited sessions persist, renew cookies, and are revoked by password changes', async () => {
  try {
    await db.setSetting('login_session_duration', 'forever');
    const response = await app.post('/api/auth/register').set('X-Forwarded-For', nextTestIp())
      .send({ username: 'lifetime-forever', email: 'lifetime-forever@example.com', password: 'Password123' });
    assert.equal(response.status, 201);
    const token = response.body.token;
    assert.equal((jwt.decode(token) as jwt.JwtPayload).exp, undefined);
    const cookieHeader = (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
    const csrf = cookieHeader.match(/tgh_csrf=([^;]+)/)![1];
    const restored = await app.get('/api/auth/me').set('Cookie', cookieHeader);
    assert.equal(restored.status, 200);
    assert.ok((restored.headers['set-cookie'] as unknown as string[]).every((cookie) => cookie.includes('Max-Age=34560000')));
    const bearerOnly = await app.get('/api/auth/me').set('Authorization', `Bearer ${token}`)
      .set('Cookie', 'tgh_auth=unrelated-cookie; tgh_csrf=existing-csrf');
    assert.equal(bearerOnly.status, 200);
    assert.equal(bearerOnly.headers['set-cookie'], undefined);
    const changed = await app.put('/api/auth/profile').set('Cookie', cookieHeader)
      .set('X-CSRF-Token', csrf).send({ password: 'ChangedPass123' });
    assert.equal(changed.status, 200);
    assert.equal((await app.get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status, 401);
    const legacyToken = jwt.sign({ userId: response.body.user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    assert.equal((await app.get('/api/auth/me').set('Authorization', `Bearer ${legacyToken}`)).status, 401);
    const newCookies = (changed.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
    assert.equal((await app.get('/api/auth/me').set('Cookie', newCookies)).status, 200);
    const logout = await app.post('/api/auth/logout').set('Cookie', newCookies)
      .set('X-CSRF-Token', newCookies.match(/tgh_csrf=([^;]+)/)![1]);
    assert.equal(logout.status, 200);
    assert.ok((logout.headers['set-cookie'] as unknown as string[]).every((cookie) => cookie.includes('Expires=Thu, 01 Jan 1970')));
  } finally {
    await db.setSetting('login_session_duration', '7d');
  }
});

test('expired tokens return the expiration error', async () => {
  const token = jwt.sign({ userId: 'expired' }, process.env.JWT_SECRET!, { expiresIn: -1 });
  const response = await app.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 401);
  assert.equal(response.body.error, '认证令牌已过期');
});

test('question viewing and content or metadata edits honor their individual permissions', async () => {
  const user = await createUser('metadata-editor', 'metadata-editor@example.com', 'Password123');
  const question = await createQuestion(user.user.id, 'metadata-edit-question');

  await db.updateUser(user.user.id, {
    permissions: {
      ...NO_PERMISSIONS,
      question_edit_meta: true,
    },
  });

  const visible = await app
    .get('/api/questions')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(visible.status, 200);

  const metadataUpdate = await app
    .put(`/api/questions/${question.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ difficulty: 'hard' });
  assert.equal(metadataUpdate.status, 200);
  assert.equal(metadataUpdate.body.difficulty, 'hard');

  const contentUpdate = await app
    .put(`/api/questions/${question.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ content: 'not allowed' });
  assert.equal(contentUpdate.status, 403);
  assert.equal(contentUpdate.body.error, '没有编辑题目内容权限');

  await db.updateUser(user.user.id, { permissions: NO_PERMISSIONS });
  const hidden = await app
    .get('/api/questions')
    .set('Authorization', `Bearer ${user.token}`);
  assert.equal(hidden.status, 403);
});

test('specialized AI permissions imply AI use without letting AI use bypass them', async () => {
  const aiUser = await createUser('ai-use-only', 'ai-use-only@example.com', 'Password123');
  await db.updateUser(aiUser.user.id, {
    permissions: {
      ...NO_PERMISSIONS,
      ai_use: true,
    },
  });

  const statusResponse = await app
    .get('/api/ai/status')
    .set('Authorization', `Bearer ${aiUser.token}`);
  assert.equal(statusResponse.status, 200);

  const configResponse = await app
    .get('/api/ai/config')
    .set('Authorization', `Bearer ${aiUser.token}`);
  assert.equal(configResponse.status, 403);

  const settingsResponse = await app
    .put('/api/ai/settings')
    .set('Authorization', `Bearer ${aiUser.token}`)
    .send({ enabled: true });
  assert.equal(settingsResponse.status, 403);

  const generateResponse = await app
    .post('/api/ai/batch-generate')
    .set('Authorization', `Bearer ${aiUser.token}`)
    .send({ topic: 'HTTP', count: 1 });
  assert.equal(generateResponse.status, 403);

  const generator = await createUser('ai-generator-only', 'ai-generator-only@example.com', 'Password123');
  await db.updateUser(generator.user.id, {
    permissions: {
      ...NO_PERMISSIONS,
      ai_generate: true,
    },
  });
  const generatorStatus = await app
    .get('/api/ai/status')
    .set('Authorization', `Bearer ${generator.token}`);
  assert.equal(generatorStatus.status, 200);
});

test('demoting an administrator through the user editor revokes administrator permissions', async () => {
  const adminLogin = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', nextTestIp())
    .send({ username: 'admin', password: 'AdminPass123' });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.body.token as string;

  const created = await app
    .post('/api/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      username: 'demoted-admin',
      email: 'demoted-admin@example.com',
      password: 'Password123',
      role: 'admin',
      userType: 'independent',
    });
  assert.equal(created.status, 201);

  const demoted = await app
    .put(`/api/admin/users/${created.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: 'user', permissions: NO_PERMISSIONS });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.role, 'user');
  assert.equal(demoted.body.permissions.system_manage, false);
  assert.equal(demoted.body.permissions.user_manage, false);

  const demotedLogin = await app
    .post('/api/auth/login')
    .set('X-Forwarded-For', nextTestIp())
    .send({ username: 'demoted-admin', password: 'Password123' });
  assert.equal(demotedLogin.status, 200);

  const denied = await app
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${demotedLogin.body.token}`);
  assert.equal(denied.status, 403);
});

test('integrated user dashboard counts the visible shared library', async () => {
  const owner = await createUser('stats-owner', 'stats-owner@example.com', 'Password123');
  const member = await createUser('stats-member', 'stats-member@example.com', 'Password123');
  const category = await db.createCategory({
    id: randomUUID(),
    name: 'Shared stats category',
    description: null,
    parent_id: null,
    user_id: owner.user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await db.createQuestion({
    id: randomUUID(),
    title: 'shared-stats-question',
    content: 'shared-stats-question content',
    answer: 'shared-stats-question answer',
    explanation: null,
    difficulty: 'medium',
    category_id: category.id,
    user_id: owner.user.id,
    tags: '[]',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await db.updateUser(member.user.id, {
    user_type: 'integrated',
    library_owner_id: owner.user.id,
    category_scopes: [category.id],
    permissions: {
      ...NO_PERMISSIONS,
      question_view: true,
      category_view: true,
    },
  });

  const questions = await app
    .get('/api/questions')
    .set('Authorization', `Bearer ${member.token}`);
  assert.equal(questions.status, 200);
  assert.equal(questions.body.total, 1);

  const stats = await app
    .get('/api/admin/stats')
    .set('Authorization', `Bearer ${member.token}`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.questionCount, 1);
  assert.equal(stats.body.categoryCount, 1);
});

test('category parents stay in the same library and cannot form cycles', async () => {
  const owner = await createUser('category-owner', 'category-owner@example.com', 'Password123');
  const other = await createUser('category-other', 'category-other@example.com', 'Password123');
  const parent = await app.post('/api/categories').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Parent' });
  assert.equal(parent.status, 201);
  const foreign = await app.post('/api/categories').set('Authorization', `Bearer ${other.token}`)
    .send({ name: 'Foreign child', parentId: parent.body.id });
  assert.equal(foreign.status, 400);
  const child = await app.post('/api/categories').set('Authorization', `Bearer ${owner.token}`)
    .send({ name: 'Child', parentId: parent.body.id });
  assert.equal(child.status, 201);
  const cycle = await app.put(`/api/categories/${parent.body.id}`).set('Authorization', `Bearer ${owner.token}`)
    .send({ parentId: child.body.id });
  assert.equal(cycle.status, 400);
  const self = await app.put(`/api/categories/${parent.body.id}`).set('Authorization', `Bearer ${owner.token}`)
    .send({ parentId: parent.body.id });
  assert.equal(self.status, 400);
});

test('revoked category access hides bookmarked questions and learning progress', async () => {
  const owner = await createUser('bookmark-owner', 'bookmark-owner@example.com', 'Password123');
  const learner = await createUser('bookmark-learner', 'bookmark-learner@example.com', 'Password123');
  const allowed = await app.post('/api/categories').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Allowed' });
  const removed = await app.post('/api/categories').set('Authorization', `Bearer ${owner.token}`).send({ name: 'Removed' });
  await db.updateUser(learner.user.id, { user_type: 'integrated', library_owner_id: owner.user.id, category_scopes: [allowed.body.id, removed.body.id] });
  const question = await app.post('/api/questions').set('Authorization', `Bearer ${owner.token}`)
    .send({ title: 'Restricted bookmark', content: 'Restricted content', categoryId: removed.body.id });
  const saved = await app.post(`/api/questions/${question.body.id}/progress`).set('Authorization', `Bearer ${learner.token}`)
    .send({ mode: 'study', isBookmarked: true });
  assert.equal(saved.status, 200);
  assert.equal((await app.get('/api/questions/bookmarked').set('Authorization', `Bearer ${learner.token}`)).body.length, 1);
  await db.updateUser(learner.user.id, { category_scopes: [allowed.body.id] });
  const bookmarks = await app.get('/api/questions/bookmarked').set('Authorization', `Bearer ${learner.token}`);
  assert.equal(bookmarks.status, 200);
  assert.deepEqual(bookmarks.body, []);
  const progress = await app.get(`/api/questions/${question.body.id}/progress`).set('Authorization', `Bearer ${learner.token}`);
  assert.equal(progress.status, 404);
  const lastViewed = await app.get('/api/questions/last-viewed').set('Authorization', `Bearer ${learner.token}`);
  assert.equal(lastViewed.body, null);
});

test('exports reimport wrapped JSON with empty answers, null explanations, categories and tags', async () => {
  const user = await createUser('export-owner', 'export-owner@example.com', 'Password123');
  const category = await app.post('/api/categories').set('Authorization', `Bearer ${user.token}`).send({ name: 'Export category' });
  const original = await app.post('/api/questions').set('Authorization', `Bearer ${user.token}`)
    .send({ title: 'Export title', content: 'Multiline\ncontent', answer: '', categoryId: category.body.id, tags: ['linux', 'network'] });
  assert.equal(original.status, 201);
  const exported = await app.get('/api/questions/export').set('Authorization', `Bearer ${user.token}`);
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.questions[0].tags, ['linux', 'network']);
  const imported = await app.post('/api/import/json').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from(JSON.stringify(exported.body)), 'export.json');
  assert.equal(imported.status, 200);
  assert.equal(imported.body.success, 1);
  assert.equal(imported.body.failed, 0);
  const rows = await db.getQuestions(user.user.id);
  assert.equal(rows.total, 2);
  assert.ok(rows.questions.every((question) => question.content === 'Multiline\ncontent'
    && question.category_id === category.body.id && question.answer === '' && question.tags === '["linux","network"]'));
  const legacy = await app.post('/api/import/json').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from(JSON.stringify([{ content: 'Legacy tags', answer: 'Answer', tags: '["linux","network"]' }])), 'legacy.json');
  assert.equal(legacy.body.success, 1);
  const legacyRow = await db.getQuestions(user.user.id, 1, 20, { keyword: 'Legacy tags' });
  assert.equal(legacyRow.questions[0].tags, '["linux","network"]');
});

test('CSV, Markdown, and text imports preserve their supported fields', async () => {
  const user = await createUser('import-owner', 'import-owner@example.com', 'Password123');
  const csv = await app.post('/api/import/csv').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from('title,content,answer,tags\nCSV title,CSV body,CSV answer,"linux,network"\n'), 'questions.csv');
  assert.equal(csv.status, 200);
  assert.equal(csv.body.success, 1);
  const markdown = await app.post('/api/import/markdown').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from('**MD title**\nMD body line 1\nMD body line 2\n答案：MD answer\n解析：MD explanation\n'), 'questions.md');
  assert.equal(markdown.body.success, 1);
  const rows = await db.getQuestions(user.user.id, 1, 20, { keyword: 'MD title' });
  assert.equal(rows.questions[0].title, 'MD title');
  assert.equal(rows.questions[0].content, 'MD body line 1\nMD body line 2');
  const text = await app.post('/api/import/text').set('Authorization', `Bearer ${user.token}`)
    .send({ questions: [{ content: 'Text body', answer: 'Text answer', tags: ['linux'] }] });
  assert.equal(text.body.success, 1);
});

test('invalid pagination and merging a question with itself are rejected', async () => {
  const user = await createUser('validation-owner', 'validation-owner@example.com', 'Password123');
  for (const query of ['page=-1', 'pageSize=-1', 'pageSize=1001', 'page=1.5', 'page=bad']) {
    const response = await app.get(`/api/questions?${query}`).set('Authorization', `Bearer ${user.token}`);
    assert.equal(response.status, 400, query);
  }
  const question = await createQuestion(user.user.id, 'Self merge');
  const merged = await app.post('/api/questions/duplicates/merge').set('Authorization', `Bearer ${user.token}`)
    .send({ keepId: question.id, removeId: question.id });
  assert.equal(merged.status, 400);
  assert.ok(await db.getQuestionById(question.id));
});

test('full backups remain administrator-only and malformed restores preserve all data', async () => {
  const delegated = await createUser('backup-delegated', 'backup-delegated@example.com', 'Password123');
  await db.updateUser(delegated.user.id, { permissions: { ...NO_PERMISSIONS, system_manage: true, backup_export: true, backup_restore: true } });
  assert.equal((await app.get('/api/admin/backup/export').set('Authorization', `Bearer ${delegated.token}`)).status, 403);
  assert.equal((await app.post('/api/admin/backup/restore').set('Authorization', `Bearer ${delegated.token}`).send({ dataset: {} })).status, 403);
  const admin = await app.post('/api/auth/login').set('X-Forwarded-For', nextTestIp())
    .send({ username: 'admin', password: 'AdminPass123' });
  const snapshot = await db.exportAllData();
  const empty = await app.post('/api/admin/backup/restore').set('Authorization', `Bearer ${admin.body.token}`).send({ dataset: {} });
  assert.equal(empty.status, 400);
  const invalid = structuredClone(snapshot);
  invalid.questions.push({ ...snapshot.questions[0], id: randomUUID(), user_id: randomUUID() });
  const restore = await app.post('/api/admin/backup/restore').set('Authorization', `Bearer ${admin.body.token}`).send({ dataset: invalid });
  assert.equal(restore.status, 500);
  assert.deepEqual(await db.exportAllData(), snapshot);
  const valid = await app.post('/api/admin/backup/restore').set('Authorization', `Bearer ${admin.body.token}`).send({ dataset: snapshot });
  assert.equal(valid.status, 200);
  assert.deepEqual(await db.exportAllData(), snapshot);
});

test('AI addresses require HTTPS and reject disguised private hosts or false custom flags', async () => {
  const { validateAIBaseUrl } = await import('../src/utils/aiConfigSecurity.js');
  for (const url of ['http://api.openai.com/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://[::ffff:7f00:1]/v1', 'https://192.0.2.1/v1', 'https://user:pass@api.openai.com/v1']) {
    assert.throws(() => validateAIBaseUrl(url, { role: 'admin' }, false));
  }
  assert.throws(() => validateAIBaseUrl('https://custom.example.com/v1', { role: 'user' }, false));
  assert.equal(validateAIBaseUrl('https://api.openai.com/v1', { role: 'user' }, false), 'https://api.openai.com/v1');
  assert.equal(validateAIBaseUrl('https://custom.example.com/v1', { role: 'user' }, true, 'runtime'), 'https://custom.example.com/v1');
});

test('AI requests refuse redirects and retain the timeout while reading the body', async () => {
  const { OpenAICompatibleProvider } = await import('../src/services/ai.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.redirect, 'error');
      return {
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
      } as unknown as Response;
    };
    const provider = new OpenAICompatibleProvider('test', 'test-key', 'test-model', 'https://api.openai.com/v1', 30);
    await assert.rejects(provider.chat([{ role: 'user', content: 'test' }]), /未响应/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('versions record edits, reject stale writes, restore as a new version and survive backups', async () => {
  const user = await createUser('versions-user', 'versions-user@example.com', 'Password123');
  const other = await createUser('versions-other', 'versions-other@example.com', 'Password123');
  const question = await createQuestion(user.user.id, 'original-version');
  const auth = { Authorization: `Bearer ${user.token}` };
  const initial = await app.get(`/api/questions/${question.id}/versions`).set(auth);
  assert.equal(initial.body.data[0].version, 1);
  const edited = await app.put(`/api/questions/${question.id}`).set(auth).send({ answer: 'edited', expectedRevision: 1, categoryId: '' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.equal(edited.body.category_id, null);
  const conflict = await app.put(`/api/questions/${question.id}`).set(auth).send({ answer: 'stale', expectedRevision: 1 });
  assert.equal(conflict.status, 409);
  assert.equal((await db.getQuestionById(question.id))?.answer, 'edited');
  assert.equal((await app.get(`/api/questions/${question.id}/versions`).set('Authorization', `Bearer ${other.token}`)).status, 404);
  assert.equal((await app.post(`/api/questions/${question.id}/versions/1/restore`).set(auth).send({ expectedRevision: 1 })).status, 409);
  const restored = await app.post(`/api/questions/${question.id}/versions/1/restore`).set(auth).send({ expectedRevision: 2 });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.answer, question.answer);
  assert.equal(restored.body.revision, 3);
  const versions = await app.get(`/api/questions/${question.id}/versions`).set(auth);
  assert.deepEqual(versions.body.data.map((item: { version: number }) => item.version), [3, 2, 1]);
  assert.equal(versions.body.data[0].source, 'restore:1');
  assert.equal(versions.body.data[0].actor_id, user.user.id);
  assert.equal(JSON.parse(versions.body.data[1].snapshot).answer, 'edited');
  assert.equal((await app.put(`/api/questions/${question.id}`).set(auth).send({ answer: question.answer, expectedRevision: 3 })).body.revision, 3);
  await db.updateUser(user.user.id, { permissions: { ...NO_PERMISSIONS, question_view: true, question_edit_meta: true } });
  assert.equal((await app.post(`/api/questions/${question.id}/versions/2/restore`).set(auth).send({ expectedRevision: 3 })).status, 403);
  const snapshot = await db.exportAllData();
  await db.replaceAllData(snapshot);
  assert.equal((await db.getQuestionVersions(question.id)).total, 3);
  assert.equal((await db.getQuestionById(question.id))?.revision, 3);
  const invalid = { ...snapshot, question_versions: [...snapshot.question_versions, { ...snapshot.question_versions[0], id: randomUUID(), question_id: randomUUID() }] };
  await assert.rejects(db.replaceAllData(invalid));
  assert.equal((await db.getQuestionVersions(question.id)).total, 3);
});

test('merging checks separate permissions and rolls back question and history on delete failure', async () => {
  const user = await createUser('merge-atomic', 'merge-atomic@example.com', 'Password123');
  const keep = await createQuestion(user.user.id, 'merge-keep');
  const remove = await createQuestion(user.user.id, 'merge-remove');
  await db.updateQuestion(remove.id, { tags: '["merged"]' });
  await db.updateUser(user.user.id, { permissions: { ...NO_PERMISSIONS, question_view: true, duplicate_manage: true } });
  const auth = { Authorization: `Bearer ${user.token}` };
  assert.equal((await app.post('/api/questions/duplicates/merge').set(auth).send({ keepId: keep.id, removeId: remove.id })).status, 403);
  const normal = await db.getUserById(user.user.id);
  await db.updateUser(user.user.id, { permissions: { ...normal!.permissions, question_edit_content: true, question_edit_meta: true, question_delete: true } });
  await db.run("CREATE TRIGGER reject_question_delete BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    assert.equal((await app.post('/api/questions/duplicates/merge').set(auth).send({ keepId: keep.id, removeId: remove.id })).status, 500);
    assert.equal((await db.getQuestionById(keep.id))?.revision, 1);
    assert.equal((await db.getQuestionVersions(keep.id)).total, 1);
    assert.ok(await db.getQuestionById(remove.id));
  } finally { await db.run('DROP TRIGGER reject_question_delete'); }
  const merged = await app.post('/api/questions/duplicates/merge').set(auth).send({ keepId: keep.id, removeId: remove.id });
  assert.equal(merged.status, 200);
  assert.equal((await db.getQuestionById(keep.id))?.tags, '["merged"]');
  assert.equal((await db.getQuestionById(keep.id))?.revision, 2);
  assert.equal(await db.getQuestionById(remove.id), undefined);
});

test('indexed similarity results match exhaustive Dice scores and compact dense identical groups', async () => {
  const { scanDuplicates, MAX_DUPLICATE_PAIRS } = await import('../src/services/questionDuplicates.js');
  const base = { id: '', title: '', content: '', answer: '', explanation: null, difficulty: 'medium' as const, category_id: null, user_id: '', tags: '[]', created_at: '', updated_at: '' };
  const examples = ['abc', 'abce', 'abcdef', 'abcdxy', 'abcdxyz', 'abdxy', '数据库索引原理', '数据库索引的原理', '', 'a', 'x', 'hello world', 'HELLO,world', 'alphanumeric1245', 'alphanumeric1246'];
  let seed = 781;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 100; i++) examples.push(Array.from({ length: 3 + Math.floor(random() * 20) }, () => 'abcdefghij'[Math.floor(random() * 10)]).join(''));
  const questions = examples.map((title, i) => ({ ...base, id: String(i), title, content: examples[(i * 7) % examples.length] }));
  const normalize = (value: string) => value.toLowerCase().replace(/[\s,]/g, '');
  const bigrams = (value: string) => { const normalized = normalize(value); return new Set(normalized.length < 2 ? normalized ? [normalized] : [] : Array.from({ length: normalized.length - 1 }, (_, i) => normalized.slice(i, i + 2))); };
  const score = (a: string, b: string) => { const left = bigrams(a), right = bigrams(b); return left.size && right.size ? 2 * [...left].filter((token) => right.has(token)).length / (left.size + right.size) : 0; };
  const expected = new Set<string>();
  for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
    if (score(questions[i].title, questions[j].title) >= 0.86 || score(questions[i].content, questions[j].content) >= 0.72) expected.add([String(i), String(j)].sort().join(':'));
  }
  const result = await scanDuplicates(questions);
  assert.equal(result.total, expected.size);
  assert.deepEqual(new Set(result.pairs.map((pair) => [pair.left.id, pair.right.id].sort().join(':'))), expected);
  const dense = await scanDuplicates(Array.from({ length: 10000 }, (_, i) => ({ ...base, id: String(i), title: 'same question', content: 'same content' })));
  assert.equal(dense.total, 49995000);
  assert.equal(dense.pairs.length, MAX_DUPLICATE_PAIRS);
  assert.equal(dense.comparisons, 0);
  assert.equal(dense.truncated, true);
});

test('large libraries paginate, locate and navigate past 1000 and scan duplicates past 5000', async () => {
  const user = await createUser('large-library', 'large-library@example.com', 'Password123');
  const auth = { Authorization: `Bearer ${user.token}` };
  const questions = [];
  for (let i = 0; i < 6005; i++) {
    const character = String.fromCodePoint(0x4e00 + i);
    questions.push(await db.createQuestion({ id: randomUUID(), title: character.repeat(3), content: character.repeat(4), answer: '', explanation: null, difficulty: 'medium', category_id: null, user_id: user.user.id, tags: '[]', created_at: new Date(1700000000000 + i * 1000).toISOString(), updated_at: new Date().toISOString() }));
  }
  await db.updateQuestion(questions[0].id, { title: '旧题重复检查', content: '旧题重复检查内容' });
  await db.updateQuestion(questions[1].id, { title: '旧题重复检查', content: '旧题重复检查内容' });
  const first = await app.get('/api/questions?page=1&pageSize=1000').set(auth);
  const second = await app.get('/api/questions?page=2&pageSize=1000').set(auth);
  assert.equal(first.body.total, 6005);
  assert.equal(second.body.data.length, 1000);
  assert.equal(new Set([...first.body.data, ...second.body.data].map((item: { id: string }) => item.id)).size, 2000);
  const boundary = first.body.data[999];
  const next = await app.get(`/api/questions/navigate/${boundary.id}/next`).set(auth);
  assert.equal(next.body.nextQuestion.id, second.body.data[0].id);
  const prev = await app.get(`/api/questions/navigate/${second.body.data[0].id}/prev`).set(auth);
  assert.equal(prev.body.prevQuestion.id, boundary.id);
  const position = await app.get(`/api/questions/position/${questions[0].id}`).set(auth);
  assert.equal(position.body.index, 6004);
  const beforeRandom = Math.random;
  try {
    Math.random = () => 0.99999;
    assert.equal((await app.get('/api/questions/navigate/random').set(auth)).body.randomQuestion.id, questions[0].id);
  } finally { Math.random = beforeRandom; }
  const started = await app.post('/api/questions/duplicates/scan').set(auth);
  assert.equal(started.status, 202);
  let result;
  for (let attempts = 0; attempts < 100; attempts++) {
    result = await app.get(`/api/questions/duplicates/scan/${started.body.id}`).set(auth);
    if (result.body.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(result?.body.status, 'completed');
  assert.equal(result?.body.totalQuestions, 6005);
  assert.equal(result?.body.total, 1);
  assert.equal(result?.body.groups[0].count, 2);
  assert.equal(result?.body.pairs[0].score, 1);
  assert.ok(result?.body.comparisons < 100);
  const other = await createUser('large-other', 'large-other@example.com', 'Password123');
  assert.equal((await app.get(`/api/questions/duplicates/scan/${started.body.id}`).set('Authorization', `Bearer ${other.token}`)).status, 404);
});

test('AI disabled settings persist in the database and reject all content generation endpoints', async () => {
  const admin = await app.post('/api/auth/login').set('X-Forwarded-For', nextTestIp()).send({ username: 'admin', password: 'AdminPass123' });
  const auth = { Authorization: `Bearer ${admin.body.token}` };
  try {
    assert.equal((await app.put('/api/ai/settings').set(auth).send({ enabled: false })).status, 200);
    assert.equal(await db.getSetting('ai_enabled'), 'false');
    assert.equal((await app.get('/api/ai/status').set(auth)).body.enabled, false);
    for (const endpoint of ['analyze', 'expand', 'recommend', 'generate', 'explain', 'chat', 'test-config', 'batch-generate', 'polish-question', 'answer-drafts/raw', 'answer-draft', 'batch-tags']) {
      const denied = await app.post(`/api/ai/${endpoint}`).set(auth).send({});
      assert.equal(denied.status, 403, endpoint);
      assert.match(denied.body.error, /已关闭/);
    }
    assert.equal((await app.get('/api/ai/config').set(auth)).status, 200);
  } finally { await app.put('/api/ai/settings').set(auth).send({ enabled: true }); }
});

test('learning view writes preserve bookmarks, return stored IDs and reject invalid modes', async () => {
  const user = await createUser('progress-upsert', 'progress-upsert@example.com', 'Password123');
  const question = await createQuestion(user.user.id, 'progress-upsert');
  const auth = { Authorization: `Bearer ${user.token}` };
  const first = await app.post(`/api/questions/${question.id}/progress`).set(auth).send({ mode: 'study', isBookmarked: true });
  assert.equal(first.body.view_count, 1);
  const viewed = await app.post(`/api/questions/${question.id}/progress`).set(auth).send({ mode: 'study' });
  assert.equal(viewed.body.view_count, 2);
  assert.equal(viewed.body.id, first.body.id);
  assert.equal(Boolean(viewed.body.is_bookmarked), true);
  const removed = await app.post(`/api/questions/${question.id}/progress`).set(auth).send({ mode: 'study', isBookmarked: false });
  assert.equal(Boolean(removed.body.is_bookmarked), false);
  assert.equal((await app.post(`/api/questions/${question.id}/progress`).set(auth).send({ mode: 'invalid' })).status, 400);
});

test('restricted categories hide unclassified questions and historical snapshots outside the current scope', async () => {
  const owner = await createUser('history-owner', 'history-owner@example.com', 'Password123');
  const member = await createUser('history-member', 'history-member@example.com', 'Password123');
  const authOwner = { Authorization: `Bearer ${owner.token}` };
  const categoryA = await app.post('/api/categories').set(authOwner).send({ name: '历史私有分类' });
  const categoryB = await app.post('/api/categories').set(authOwner).send({ name: '当前共享分类' });
  const question = await createQuestion(owner.user.id, 'history-scope-question');
  const unclassified = await createQuestion(owner.user.id, 'unclassified-question');
  await db.updateQuestion(question.id, { category_id: categoryA.body.id, answer: '旧私有内容' });
  await db.updateQuestion(question.id, { category_id: categoryB.body.id, answer: '当前共享内容' });
  await db.updateUser(member.user.id, { user_type: 'integrated', library_owner_id: owner.user.id, category_scopes: [categoryB.body.id] });
  const auth = { Authorization: `Bearer ${member.token}` };
  const history = await app.get(`/api/questions/${question.id}/versions`).set(auth);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.data.map((item: { version: number }) => item.version), [3]);
  assert.equal((await app.get(`/api/questions/${unclassified.id}`).set(auth)).status, 404);
  const queue = await db.getReviewQueue(member.user.id, owner.user.id, 20, [categoryB.body.id]);
  assert.deepEqual(queue.map((item) => item.id), [question.id]);
  assert.equal((await app.post(`/api/questions/${question.id}/versions/2/restore`).set(auth).send({ expectedRevision: 3 })).status, 403);
  assert.equal((await app.post('/api/questions').set(auth).send({ title: '没有分类', content: '没有分类' })).status, 403);
});

test('legacy backups without revision columns or version tables remain restorable', async () => {
  const snapshot = await db.exportAllData();
  try {
    const legacy = { ...snapshot, question_versions: [], questions: snapshot.questions.map(({ revision: _revision, ...question }) => question) };
    await db.replaceAllData(legacy);
    const questionId = String(legacy.questions[0].id);
    assert.equal((await db.getQuestionById(questionId))?.revision, 1);
    assert.equal((await db.getQuestionVersions(questionId)).data[0].version, 1);
    const updated = await db.updateQuestion(questionId, { answer: 'legacy version update' });
    assert.equal(updated?.revision, 2);
    assert.equal((await db.getQuestionVersions(questionId)).total, 2);
  } finally { await db.replaceAllData(snapshot); }
});

test('backup restoration orders child categories after parents and rejects cyclic backups without changes', async () => {
  const user = await createUser('hierarchy-backup', 'hierarchy-backup@example.com', 'Password123');
  const auth = { Authorization: `Bearer ${user.token}` };
  const parent = await app.post('/api/categories').set(auth).send({ name: 'parent' });
  const child = await app.post('/api/categories').set(auth).send({ name: 'child', parentId: parent.body.id });
  const snapshot = await db.exportAllData();
  const childRecord = snapshot.categories.find((category) => category.id === child.body.id)!;
  const parentRecord = snapshot.categories.find((category) => category.id === parent.body.id)!;
  const reversed = { ...snapshot, categories: [childRecord, ...snapshot.categories.filter((category) => category.id !== child.body.id)] };
  await db.replaceAllData(reversed);
  assert.equal((await db.getCategoryById(child.body.id))?.parent_id, parent.body.id);
  const cyclic = { ...snapshot, categories: snapshot.categories.map((category) => category.id === parent.body.id ? { ...parentRecord, parent_id: child.body.id } : category) };
  await assert.rejects(db.replaceAllData(cyclic));
  assert.equal((await db.getCategoryById(child.body.id))?.parent_id, parent.body.id);
  assert.equal((await db.getCategoryById(parent.body.id))?.parent_id, null);
});

test('import preview validates without writes, pages rows, excludes selections and commits once', async () => {
  const user = await createUser('preview-owner', 'preview-owner@example.com', 'Password123');
  const questions = Array.from({ length: 24 }, (_, index) => ({ title: `Preview ${index}`, content: `Body ${index}`, answer: `Answer ${index}`, difficulty: index === 0 ? 'constructor' : 'easy', tags: ['preview'] }));
  const preview = await app.post('/api/import/preview/json').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from(JSON.stringify({ questions: [...questions, null, { content: 'Invalid tags', tags: [42] }] })), 'preview.json');
  assert.equal(preview.status, 200);
  assert.equal(preview.body.total, 26); assert.equal(preview.body.valid, 24); assert.equal(preview.body.invalid, 2);
  assert.equal(preview.body.rows.length, 20); assert.equal(preview.body.rows[0].question.difficulty, 'medium');
  assert.ok(preview.body.rows[0].warnings.length);
  assert.equal((await db.getQuestions(user.user.id)).total, 0);
  const id = preview.body.id;
  const page = await app.get(`/api/import/preview/${id}?page=2`).set('Authorization', `Bearer ${user.token}`);
  assert.equal(page.body.rows.length, 6); assert.equal(page.body.rows[0].row, 21);
  assert.equal((await app.get(`/api/import/preview/${id}?page=-1`).set('Authorization', `Bearer ${user.token}`)).status, 400);
  assert.equal((await app.post(`/api/import/preview/${id}/commit`).set('Authorization', `Bearer ${user.token}`).send({ excludedRows: [99] })).status, 400);
  const committed = await app.post(`/api/import/preview/${id}/commit`).set('Authorization', `Bearer ${user.token}`).send({ excludedRows: [1, 21] });
  assert.equal(committed.status, 200); assert.equal(committed.body.success, 22); assert.equal(committed.body.failed, 2); assert.equal(committed.body.skipped, 2);
  const retried = await app.post(`/api/import/preview/${id}/commit`).set('Authorization', `Bearer ${user.token}`).send({ excludedRows: [] });
  assert.deepEqual(retried.body, committed.body);
  assert.equal((await db.getQuestions(user.user.id)).total, 22);
});

test('preview cannot be read or committed by another account and revoked scope requires a new preview', async () => {
  const user = await createUser('preview-scope', 'preview-scope@example.com', 'Password123');
  const other = await createUser('preview-other', 'preview-other@example.com', 'Password123');
  const preview = await app.post('/api/import/preview/text').set('Authorization', `Bearer ${user.token}`).send({ questions: [{ content: 'Scope preview', answer: 'Answer' }] });
  const path = `/api/import/preview/${preview.body.id}`;
  assert.equal((await app.get(path).set('Authorization', `Bearer ${other.token}`)).status, 404);
  assert.equal((await app.post(`${path}/commit`).set('Authorization', `Bearer ${other.token}`).send({})).status, 404);
  const stored = await db.getUserById(user.user.id);
  assert.ok(stored);
  await db.updateUser(user.user.id, { category_scopes: ['changed-scope'] });
  assert.equal((await app.get(path).set('Authorization', `Bearer ${user.token}`)).status, 409);
  assert.equal((await app.post(`${path}/commit`).set('Authorization', `Bearer ${user.token}`).send({})).status, 409);
  await db.updateUser(user.user.id, { permissions: { ...stored.permissions, import_manage: false } });
  assert.equal((await app.post('/api/import/preview/text').set('Authorization', `Bearer ${user.token}`).send({ questions: [{ content: 'Blocked', answer: 'Answer' }] })).status, 403);
  assert.equal((await db.getQuestions(user.user.id)).total, 0);
});

test('preview commit rechecks deleted categories and rejects expired or empty selections', async () => {
  const user = await createUser('preview-category', 'preview-category@example.com', 'Password123');
  const category = await app.post('/api/categories').set('Authorization', `Bearer ${user.token}`).send({ name: 'Preview target' });
  const preview = await app.post('/api/import/preview/text').set('Authorization', `Bearer ${user.token}`).send({ categoryId: category.body.id, questions: [{ content: 'Will lose category', answer: 'Answer' }] });
  assert.equal(preview.body.valid, 1);
  assert.equal((await app.post(`/api/import/preview/${preview.body.id}/commit`).set('Authorization', `Bearer ${user.token}`).send({ excludedRows: [1] })).status, 400);
  await db.deleteCategory(category.body.id);
  const committed = await app.post(`/api/import/preview/${preview.body.id}/commit`).set('Authorization', `Bearer ${user.token}`).send({});
  assert.equal(committed.body.success, 0); assert.equal(committed.body.failed, 1); assert.match(committed.body.errors[0].error, /分类不存在/);
  const another = await app.post('/api/import/preview/text').set('Authorization', `Bearer ${user.token}`).send({ questions: [{ content: 'Expires', answer: 'Answer' }] });
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 16 * 60 * 1000;
    assert.equal((await app.get(`/api/import/preview/${another.body.id}`).set('Authorization', `Bearer ${user.token}`)).status, 404);
  } finally { Date.now = realNow; }
  assert.equal((await db.getQuestions(user.user.id)).total, 0);
});

test('CSV and Markdown previews preserve metadata and code, and malformed inputs return actionable errors', async () => {
  const user = await createUser('preview-formats', 'preview-formats@example.com', 'Password123');
  const csv = await app.post('/api/import/preview/csv').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from('\uFEFF内容,答案,标签\nCSV preview,Answer,"a,b"\nMissing answer,,\n'), 'preview.csv');
  assert.equal(csv.status, 200); assert.equal(csv.body.valid, 1); assert.equal(csv.body.invalid, 1); assert.equal(csv.body.rows[1].row, 3);
  assert.deepEqual(csv.body.rows[0].question.tags, ['a', 'b']);
  const markdown = await app.post('/api/import/preview/markdown').set('Authorization', `Bearer ${user.token}`)
    .attach('file', Buffer.from('**MD preview**\nBody\n答案：Answer\n```txt\n**inside code**\n标签：literal\n```\n解析：Explanation\n标签：docker,k8s\n难度：困难\n'), 'preview.md');
  assert.equal(markdown.body.valid, 1); assert.deepEqual(markdown.body.rows[0].question.tags, ['docker', 'k8s']);
  assert.equal(markdown.body.rows[0].question.difficulty, 'hard'); assert.match(markdown.body.rows[0].question.answer, /\*\*inside code\*\*/);
  assert.equal((await app.post('/api/import/preview/json').set('Authorization', `Bearer ${user.token}`).attach('file', Buffer.from('{ broken'), 'broken.json')).status, 400);
  assert.equal((await app.post('/api/import/preview/json').set('Authorization', `Bearer ${user.token}`).attach('file', Buffer.from('[]'), 'wrong.csv')).status, 400);
  assert.equal((await app.post('/api/import/preview/text').set('Authorization', `Bearer ${user.token}`).send({ questions: [] })).status, 400);
  assert.equal((await db.getQuestions(user.user.id)).total, 0);
});
