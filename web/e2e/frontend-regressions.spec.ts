import { expect, test } from '@playwright/test';
import { apiLogin, createQuestion, getQuestion, primeAuth, registerUser } from './utils';

test.use({ serviceWorkers: 'block' });

const aiStatus = {
  enabled: true,
  defaultProvider: 'custom',
  availableProviders: ['custom', 'custom'],
  defaultConfigId: 'model-b',
  availableModels: [
    { id: 'model-a', label: '自定义 · model-a', provider: 'custom', model: 'model-a', isActive: false },
    { id: 'model-b', label: '自定义 · model-b', provider: 'custom', model: 'model-b', isActive: true },
  ],
};

test('AI 答案通过使用权限选择独立模型，版本切换不会误存旧草稿', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_answer_model`);
  const login = await apiLogin(request, user.username, user.password);
  const question = await createQuestion(request, login.token, { title: '模型选择题', content: '模型选择题干', answer: '原答案', tags: ['original'] });
  const restrictedUser = { ...login.user, permissions: { ...login.user.permissions, ai_config_manage: false, question_edit_meta: false } };
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: restrictedUser }));
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: aiStatus }));
  let configRequests = 0;
  await page.route('**/api/ai/config', (route) => {
    configRequests++;
    return route.fulfill({ status: 403, json: { error: '没有AI配置权限' } });
  });
  await page.route('**/api/ai/answer-draft', (route) => {
    const body = route.request().postDataJSON();
    expect(body.provider).toBe('model-a');
    return route.fulfill({ json: {
      question,
      draft: { answer: `${body.mode}新答案`, explanation: '新解析', tags: ['generated'], mode: body.mode },
      raw: 'mocked',
    } });
  });
  await primeAuth(page, login);
  await page.goto('/questions');
  await page.getByRole('button', { name: 'AI答案', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'AI 答案生成' });
  await modal.getByRole('combobox').selectOption('model-a');
  await modal.getByRole('button', { name: '生成练习版', exact: true }).click();
  await expect(modal.locator('textarea').first()).toHaveValue('practice新答案');
  await modal.getByRole('button', { name: '速记版', exact: true }).click();
  await expect(modal.getByRole('button', { name: '只保存答案', exact: true })).toBeDisabled();
  await modal.getByRole('button', { name: '生成速记版', exact: true }).click();
  await expect(modal.locator('textarea').first()).toHaveValue('quick新答案');
  await expect(modal.getByText('标签建议', { exact: true })).toHaveCount(0);
  await modal.getByRole('button', { name: '只保存答案', exact: true }).click();
  await expect(modal).toBeHidden();
  const saved = await getQuestion(request, login.token, question.id);
  expect(saved.answer).toBe('quick新答案');
  expect(JSON.parse(saved.tags)).toEqual(['original']);
  expect(configRequests).toBe(0);
});

test('草稿批次生成中保护编辑，后续批次失败仍保留已生成答案', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_capture_batches`);
  const login = await apiLogin(request, user.username, user.password);
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: aiStatus }));
  let releaseBatch: () => void = () => undefined;
  const firstBatchReady = new Promise<void>((resolve) => { releaseBatch = resolve; });
  let batchRequests = 0;
  await page.route('**/api/ai/answer-drafts/raw', async (route) => {
    batchRequests++;
    if (batchRequests === 2) return route.fulfill({ status: 502, json: { error: '第二批生成失败' } });
    const { questions } = route.request().postDataJSON();
    await firstBatchReady;
    return route.fulfill({ json: { drafts: questions.map((question: { clientId: string }) => ({
      clientId: question.clientId, answer: '已生成并保存的答案', explanation: '解析', difficulty: 'medium', tags: ['generated'],
    })) } });
  });
  await primeAuth(page, login);
  await page.goto('/capture');
  await page.getByPlaceholder(/每行一道题/).fill(Array.from({ length: 21 }, (_, index) => `第 ${index + 1} 道现场题`).join('\n'));
  await page.getByRole('button', { name: '保存到草稿箱' }).click();
  await expect(page.getByText('草稿箱（21）')).toBeVisible();
  await page.getByRole('button', { name: 'AI 批量生成答案' }).click();
  try {
    await expect(page.getByRole('textbox', { name: '第 1 题题目', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存到草稿箱' })).toBeDisabled();
  } finally {
    releaseBatch();
  }
  await expect(page.getByText('第二批生成失败', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('草稿箱（21）')).toBeVisible();
  await expect(page.locator('textarea').filter({ hasText: '已生成并保存的答案' })).toHaveCount(20);
});

test('收藏模式切换后，较慢的旧模式响应不会覆盖当前列表', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_bookmark_race`);
  const login = await apiLogin(request, user.username, user.password);
  let releaseStudy: () => void = () => undefined;
  const studyReady = new Promise<void>((resolve) => { releaseStudy = resolve; });
  let studyRequests = 0;
  await page.route('**/api/questions/bookmarked?*', async (route) => {
    const mode = new URL(route.request().url()).searchParams.get('mode');
    if (mode === 'study') { studyRequests++; await studyReady; }
    return route.fulfill({ json: [{ id: mode, title: `${mode}收藏`, content: `${mode}题干`, answer: '答案', explanation: '', difficulty: 'medium', category_id: null, tags: '[]' }] });
  });
  await primeAuth(page, login);
  await page.goto('/bookmarks');
  const studyResponse = page.waitForResponse((response) => response.url().includes('/questions/bookmarked') && response.url().includes('mode=study'));
  try {
    await expect.poll(() => studyRequests).toBeGreaterThan(0);
    await page.getByRole('button', { name: '答题收藏', exact: true }).click();
    await expect(page.getByText('quiz题干', { exact: true })).toBeVisible();
  } finally {
    releaseStudy();
  }
  await (await studyResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.getByText('quiz题干', { exact: true })).toBeVisible();
  await expect(page.getByText('study题干', { exact: true })).toHaveCount(0);
});

test('离线草稿升级保留历史内容，同一草稿 ID 在不同账号间独立删除', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_draft_isolation`);
  const login = await apiLogin(request, user.username, user.password);
  await primeAuth(page, login);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '打开个人资料' })).toBeVisible();
  await page.evaluate(async (userId) => {
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('tech-growth-hub-offline', 1);
      opening.onupgradeneeded = () => {
        const store = opening.result.createObjectStore('interviewDrafts', { keyPath: 'id' });
        store.createIndex('userId', 'userId');
      };
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('interviewDrafts', 'readwrite');
        transaction.objectStore('interviewDrafts').put({
          id: 'shared-draft-id', userId, content: '历史草稿题干', answer: '', explanation: '', difficulty: 'medium', tags: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  }, login.user.id);
  await page.goto('/capture');
  await expect(page.getByRole('textbox', { name: '第 1 题题目', exact: true })).toHaveValue('历史草稿题干');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('tech-growth-hub-offline', 2);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('interviewDrafts', 'readwrite');
        transaction.objectStore('interviewDrafts').put({
          id: 'shared-draft-id', userId: 'another-account', content: '其他账号草稿', answer: '', explanation: '', difficulty: 'medium', tags: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除草稿', exact: true }).click();
  await expect(page.getByText('草稿箱（0）')).toBeVisible();
  const remaining = await page.evaluate(async () => new Promise<Array<{ userId: string }>>((resolve, reject) => {
    const opening = indexedDB.open('tech-growth-hub-offline', 2);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('interviewDrafts', 'readonly');
      const reading = transaction.objectStore('interviewDrafts').getAll();
      transaction.oncomplete = () => { database.close(); resolve(reading.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  expect(remaining.map((draft) => draft.userId)).toEqual(['another-account']);
});

test('连续追问带长度受限的上下文，失败可重试，切题后清空对话', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_chat_history`);
  const login = await apiLogin(request, user.username, user.password);
  for (const index of [1, 2]) {
    await createQuestion(request, login.token, { title: `对话题 ${index}`, content: `对话题干 ${index}`, answer: '答案' });
  }
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: aiStatus }));
  const calls: Array<{ questionId: string; message: string }> = [];
  await page.route('**/api/ai/chat', (route) => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 2) return route.fulfill({ status: 502, json: { error: '暂时无法回答' } });
    return route.fulfill({ json: { result: calls.length === 1 ? `首轮回复${'答'.repeat(11500)}` : '后续回复' } });
  });
  await primeAuth(page, login);
  await page.goto('/study');
  await page.getByRole('button', { name: 'AI助手', exact: true }).last().click();
  await page.getByRole('button', { name: '深度对话', exact: true }).click();
  const input = page.getByPlaceholder('输入您的问题...');
  await input.fill('首轮问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText(/^首轮回复/)).toBeVisible();
  await input.fill('继续解释之前的问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(input).toHaveValue('继续解释之前的问题');
  expect(calls[1].message).toContain('首轮问题');
  expect(calls[1].message).toContain('首轮回复');
  expect(calls[1].message).toContain('继续解释之前的问题');
  expect(calls[1].message.length).toBeLessThanOrEqual(12000);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('后续回复', { exact: true })).toBeVisible();
  expect(calls[2].message).toBe(calls[1].message);
  await page.getByRole('button', { name: '下一题', exact: true }).last().click();
  await expect(page.getByText('后续回复', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '深度对话', exact: true }).click();
  await input.fill('新题问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('后续回复', { exact: true })).toBeVisible();
  expect(calls[3].message).toBe('新题问题');
  expect(calls[3].questionId).not.toBe(calls[0].questionId);
});

test('浏览器禁用 Web Storage 仍可用 Cookie 登录，题目 HTML 与实体按文本展示', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_storage_markdown`);
  const login = await apiLogin(request, user.username, user.password);
  await createQuestion(request, login.token, {
    title: 'HTML 转义题',
    content: '<img src=x onerror=alert(1)> &lt;script&gt;alert(2)&lt;/script&gt; [链接](javascript:alert(3))',
    answer: '```html\n<script>alert(4)</script>\n```\n**<svg onload=alert(5)>**',
  });
  await primeAuth(page, login);
  await page.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, key, { get: () => { throw new DOMException('Storage disabled', 'SecurityError'); } });
    }
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/study');
  const content = page.getByTestId('learning-question-content');
  const answer = page.getByTestId('learning-question-answer');
  await expect(content).toContainText('<img src=x onerror=alert(1)>');
  await expect(content).toContainText('&lt;script&gt;alert(2)&lt;/script&gt;');
  await expect(answer).toContainText('<script>alert(4)</script>');
  await expect(content.locator('img, svg, script, a, iframe')).toHaveCount(0);
  await expect(answer.locator('img, svg, script, a, iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI助手', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '深度对话', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('已关闭的 AI 润色请求失败不会关闭后来打开的弹窗', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_polish_race`);
  const login = await apiLogin(request, user.username, user.password);
  const question = await createQuestion(request, login.token, {
    title: '润色请求隔离', content: '润色请求隔离题干', answer: '原答案',
  });
  let releaseOldRequest: () => void = () => undefined;
  const oldRequestReady = new Promise<void>((resolve) => { releaseOldRequest = resolve; });
  let requests = 0;
  await page.route('**/api/ai/polish-question', async (route) => {
    requests++;
    if (requests === 1) {
      await oldRequestReady;
      return route.fulfill({ status: 502, json: { error: '旧润色请求失败' } });
    }
    return route.fulfill({ json: {
      question,
      draft: { ...question, explanation: '', tags: [], answer: '新润色草稿' },
      raw: 'mocked',
    } });
  });
  await primeAuth(page, login);
  await page.goto('/questions');
  await page.getByTestId(`question-polish-${question.id}`).last().click();
  const modal = page.getByTestId('ai-polish-modal');
  const oldResponse = page.waitForResponse((response) => response.url().endsWith('/ai/polish-question') && response.status() === 502);
  try {
    await expect.poll(() => requests).toBe(1);
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByTestId(`question-polish-${question.id}`).last().click();
    await expect(modal.getByRole('textbox', { name: '答案', exact: true })).toHaveValue('新润色草稿');
  } finally {
    releaseOldRequest();
  }
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(modal).toBeVisible();
  await expect(page.getByText('旧润色请求失败', { exact: true })).toHaveCount(0);
  await expect(modal.getByRole('textbox', { name: '答案', exact: true })).toHaveValue('新润色草稿');
});

test('学习题库缩减后跨页跳转回到有效题号，即使目标页仍有题目', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_study_shrink`);
  const login = await apiLogin(request, user.username, user.password);
  const question = await createQuestion(request, login.token, {
    title: '学习页缩减', content: '学习页缩减题干', answer: '参考答案',
  });
  const questions = Array.from({ length: 150 }, (_, index) => ({ ...question, content: `缩减题库第 ${index + 1} 题` }));
  let shrunk = false;
  await page.route(/\/api\/questions\?/, (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'));
    if (pageNumber === 2) shrunk = true;
    const total = shrunk ? 105 : 150;
    return route.fulfill({ json: {
      data: questions.slice((pageNumber - 1) * 100, Math.min(pageNumber * 100, total)),
      total, page: pageNumber, pageSize: 100, totalPages: 2,
    } });
  });
  await primeAuth(page, login);
  await page.goto('/study');
  await expect(page.getByTestId('learning-question-content')).toContainText('缩减题库第 1 题');
  await page.locator('input[aria-label="跳转题号"]:visible').fill('150');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByTestId('learning-question-content')).toContainText('缩减题库第 105 题');
  await expect(page.getByRole('progressbar', { name: '当前浏览位置' })).toHaveAttribute('aria-valuenow', '100');
});

test('其他页面阻塞离线数据库升级时提示重试，解除占用后仍能保存草稿', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_blocked_drafts`);
  const login = await apiLogin(request, user.username, user.password);
  await primeAuth(page, login);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '打开个人资料' })).toBeVisible();
  await page.evaluate(async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tech-growth-hub-offline', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('interviewDrafts', { keyPath: 'id' });
        store.createIndex('userId', 'userId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Keep an old connection without a versionchange handler, as an older tab might.
    Object.assign(window, { legacyDraftConnection: legacy });
  });
  await page.getByRole('link', { name: '记题', exact: true }).click();
  await expect(page.getByText('离线数据库升级被其他页面占用，请关闭其他页面后重试', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { legacyDraftConnection: IDBDatabase }).legacyDraftConnection.close();
  });
  await page.getByPlaceholder(/每行一道题/).fill('解除占用后保存的草稿');
  await page.getByRole('button', { name: '保存到草稿箱' }).click();
  await expect(page.getByText('草稿箱（1）')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '第 1 题题目', exact: true })).toHaveValue('解除占用后保存的草稿');
});
