import { test, expect } from '@playwright/test';
import { apiBaseUrl, apiLogin, createQuestion, getQuestion, primeAuth, registerUser } from './utils';
import path from 'node:path';

// Mocked API responses must not be intercepted by a real service worker.
test.use({ serviceWorkers: 'block' });

test('一个 JSON 在空题库中自动创建全部分类并导入题目', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_portable`);
  const login = await apiLogin(request, user.username, user.password);
  await primeAuth(page, login);
  await page.goto('/questions');
  await page.getByRole('button', { name: '导入题目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入题目' });
  await dialog.getByRole('button', { name: 'JSON格式', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles(path.resolve(process.cwd(), '../question-bank/2026-10-17/tech-growth-hub-question-bank-20261017.json'));
  await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(dialog.getByText('共 178 道，可导入 178 道，错误 0 道')).toBeVisible();
  await expect(dialog.getByText(/确认后自动创建 16 个分类/)).toBeVisible();
  await expect(dialog.getByText(/分类：服务网格与Envoy（确认时创建）/).first()).toBeVisible();
  await dialog.getByRole('button', { name: '确认导入 178 道题目', exact: true }).click();
  await expect(dialog.getByText('成功导入：178 道')).toBeVisible();
  await expect(dialog.getByText('已自动创建 16 个分类')).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('共 178 道题目', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '导入题目', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '导入到分类' }).getByRole('option')).toHaveCount(18);
  await dialog.getByRole('button', { name: 'AI粘贴导入', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'AI JSON 内容' }).fill(JSON.stringify({
    formatVersion: 2, categories: [{ id: 'reuse', name: '网络与安全' }],
    questions: [{ content: '粘贴分类复用测试', answer: '测试答案', categoryId: 'reuse' }],
  }));
  await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(dialog.getByText('共 1 道，可导入 1 道，错误 0 道')).toBeVisible();
  await expect(dialog.getByText(/分类：网络与安全 · 难度/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认导入 1 道题目', exact: true }).click();
  await expect(dialog.getByText('成功导入：1 道')).toBeVisible();
  await expect(dialog.getByText(/已自动创建/)).toHaveCount(0);
});

test('题库页可以创建题目并在列表中搜索到', async ({ page, request }) => {
  const suffix = `${Date.now()}_create`;
  const user = await registerUser(request, suffix);
  const login = await apiLogin(request, user.username, user.password);

  await primeAuth(page, login);
  await page.goto('/questions');

  await page.getByTestId('question-add-button').click();
  await expect(page.getByTestId('question-modal')).toBeVisible();

  await page.getByTestId('question-content-input').fill(`E2E 创建题目 ${suffix}\n第二行内容`);
  await page.getByTestId('question-answer-input').fill('这是自动化测试答案');
  await page.getByTestId('question-explanation-input').fill('这是自动化测试解析');
  await expect(page.getByTestId('question-tags-input')).toHaveCount(0);
  await page.getByTestId('question-save-button').click();

  await expect(page.getByTestId('question-modal')).toBeHidden();
  await page.getByTestId('question-search-input').fill(`E2E 创建题目 ${suffix}`);
  await expect(page.getByText(`E2E 创建题目 ${suffix}`).last()).toBeVisible();
});

test('失效分类引用可以统一改为未分类后导入', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_emptycat`);
  const login = await apiLogin(request, user.username, user.password);
  await primeAuth(page, login); await page.goto('/questions');
  await page.getByRole('button', { name: '导入题目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入题目' });
  await dialog.getByRole('button', { name: 'JSON格式', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'stale.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ formatVersion: 2, categories: [], questions: [{ content: '失效分类恢复测试', answer: '答案', categoryId: 'missing' }] })) });
  await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('文件中不存在的分类');
  await dialog.getByRole('combobox', { name: '导入到分类' }).selectOption({ label: '全部导入未分类' });
  await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
  await expect(dialog.getByText('共 1 道，可导入 1 道，错误 0 道')).toBeVisible();
  await expect(dialog.getByText(/分类：无分类/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认导入 1 道题目', exact: true }).click();
  await expect(dialog.getByText('成功导入：1 道')).toBeVisible();
  const categories = await request.get(`${apiBaseUrl}/categories`, { headers: { Authorization: `Bearer ${login.token}` } });
  expect(await categories.json()).toHaveLength(0);
});

test('未分类题可手动归类和取消归类，保留独立标题、正文和收藏', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_manual_category`);
  const login = await apiLogin(request, user.username, user.password);
  const headers = { Authorization: `Bearer ${login.token}` };
  const categoryResponse = await request.post(`${apiBaseUrl}/categories`, { headers, data: { name: '手动归类验收' } });
  expect(categoryResponse.ok()).toBeTruthy();
  const category = await categoryResponse.json();
  const original = { title: '保留独立短标题', content: '这是手动归类题干', answer: '原答案', explanation: '原解析', difficulty: 'hard' as const };
  const question = await createQuestion(request, login.token, original);
  expect((await request.post(`${apiBaseUrl}/questions/${question.id}/progress`, { headers, data: { mode: 'study', isBookmarked: true } })).ok()).toBeTruthy();
  const before = await (await request.get(`${apiBaseUrl}/questions/${question.id}/progress?mode=study`, { headers })).json();
  await primeAuth(page, login);
  await page.goto('/questions');
  for (const categoryId of [category.id, '']) {
    await page.getByRole('button', { name: '编辑题目', exact: true }).click();
    const modal = page.getByTestId('question-modal');
    await modal.getByRole('combobox', { name: '题目分类' }).selectOption(categoryId);
    const saving = page.waitForRequest(req => req.method() === 'PUT' && req.url().endsWith(`/questions/${question.id}`));
    await page.getByTestId('question-save-button').click();
    expect((await saving).postDataJSON()).toEqual({ difficulty: 'hard', categoryId, expectedRevision: categoryId ? 1 : 2 });
    await expect(modal).toBeHidden();
    expect(await getQuestion(request, login.token, question.id)).toMatchObject({ ...original, category_id: categoryId || null });
    expect(await (await request.get(`${apiBaseUrl}/questions/${question.id}/progress?mode=study`, { headers })).json()).toEqual(before);
  }
});

test('添加题目关闭重开后，迟到的 AI 答案不会覆盖新题', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_late_answer`);
  const login = await apiLogin(request, user.username, user.password);
  let releaseAnswer!: () => void;
  const ready = new Promise<void>(resolve => { releaseAnswer = resolve; });
  await page.route('**/api/ai/answer-drafts/raw', async route => {
    const { questions } = route.request().postDataJSON();
    await ready;
    await route.fulfill({ json: { drafts: [{ clientId: questions[0].clientId, answer: '旧题迟到的答案', explanation: '旧解析', difficulty: 'hard' }] } });
  });
  await primeAuth(page, login);
  await page.goto('/questions');
  await page.getByTestId('question-add-button').click();
  await page.getByTestId('question-content-input').fill('旧题');
  const requested = page.waitForRequest('**/api/ai/answer-drafts/raw');
  await page.getByRole('button', { name: 'AI 生成答案', exact: true }).click();
  await requested;
  const response = page.waitForResponse('**/api/ai/answer-drafts/raw');
  try {
    await expect(page.getByTestId('question-save-button')).toBeDisabled();
    await expect(page.getByTestId('question-content-input')).toBeDisabled();
    await page.getByRole('button', { name: '关闭题目编辑', exact: true }).click();
    await page.getByTestId('question-add-button').click();
    await page.getByTestId('question-content-input').fill('新题');
  } finally {
    releaseAnswer();
  }
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByTestId('question-answer-input')).toHaveValue('');
  await expect(page.getByTestId('question-explanation-input')).toHaveValue('');
  await page.getByTestId('question-save-button').click();
  await expect(page.getByTestId('question-modal')).toBeHidden();
  const saved = await (await request.get(`${apiBaseUrl}/questions`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  expect(saved.total).toBe(1);
  expect(saved.data[0]).toMatchObject({ content: '新题', answer: '', category_id: null, difficulty: 'medium' });
});

test('AI 生题可在空分类中创建新分类，失败时保留草稿供重试', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_aicat`);
  const login = await apiLogin(request, user.username, user.password);
  await page.route('**/api/ai/status', route => route.fulfill({ json: {
    enabled: true, defaultProvider: 'openai', availableModels: [{ id: 'test', label: '测试模型', provider: 'openai', model: 'test', isActive: true }],
  } }));
  await page.route('**/api/ai/batch-generate', async route => {
    expect(route.request().postDataJSON().categoryName).toBe('AI 新建分类');
    await route.fulfill({ json: { questions: [{ title: 'AI 自动分类验证', content: 'AI 自动分类验证题干', answer: '完整答案', explanation: '完整解析', difficulty: 'easy' }], raw: 'test' } });
  });
  await page.route('**/api/import/text', route => route.fulfill({ json: { success: 0, failed: 1, errors: [{ row: 1, error: '分类管理权限不足' }] } }));
  await primeAuth(page, login); await page.goto('/questions');
  await page.getByRole('button', { name: 'AI 生题', exact: true }).click();
  const modal = page.locator('.app-modal-panel').filter({ hasText: 'AI 批量生题' });
  await modal.getByPlaceholder(/例如：Python 装饰器/).fill('容器基础');
  await modal.getByRole('textbox', { name: 'AI 新分类名称' }).fill('AI 新建分类');
  await modal.getByRole('button', { name: '开始生题', exact: true }).click();
  await expect(modal.getByText('AI 自动分类验证题干', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: '导入 1 道题', exact: true }).click();
  await expect(page.getByText(/分类管理权限不足/)).toBeVisible();
  await expect(modal.getByText('AI 自动分类验证题干', { exact: true })).toBeVisible();
  await page.unroute('**/api/import/text');
  await modal.getByRole('button', { name: '导入 1 道题', exact: true }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: '导入题目', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入题目' }).getByRole('combobox', { name: '导入到分类' }).getByRole('option', { name: 'AI 新建分类', exact: true })).toHaveCount(1);
});

test('AI 润色支持预览后保存回题目', async ({ page, request }) => {
  const suffix = `${Date.now()}_polish`;
  const user = await registerUser(request, suffix);
  const login = await apiLogin(request, user.username, user.password);
  const question = await createQuestion(request, login.token, {
    title: `E2E 润色题目 ${suffix}`,
    content: `E2E 原始内容 ${suffix}`,
    answer: '原始答案',
    explanation: '原始解析',
    tags: ['e2e'],
  });

  await page.route('**/api/ai/polish-question', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        question,
        draft: {
          title: question.title,
          content: `E2E 润色后内容 ${suffix}`,
          answer: '润色后的答案',
          explanation: '润色后的解析',
          difficulty: 'medium',
          tags: ['e2e', 'polished'],
        },
        raw: 'mocked',
      }),
    });
  });

  await primeAuth(page, login);
  await page.goto('/questions');
  await page.getByTestId('question-search-input').fill(`E2E 原始内容 ${suffix}`);
  await page.getByTestId(`question-polish-${question.id}`).last().click();

  await expect(page.getByTestId('ai-polish-modal')).toBeVisible();
  await expect(page.getByTestId('ai-polish-modal').getByRole('textbox', { name: '题目内容', exact: true }))
    .toHaveValue(`E2E 润色后内容 ${suffix}`);
  await page.getByTestId('ai-polish-save-button').click();
  await expect(page.getByTestId('ai-polish-modal')).toBeHidden();

  const updatedQuestion = await getQuestion(request, login.token, question.id);
  expect(updatedQuestion.content).toBe(`E2E 润色后内容 ${suffix}`);
  expect(updatedQuestion.answer).toBe('润色后的答案');
});
