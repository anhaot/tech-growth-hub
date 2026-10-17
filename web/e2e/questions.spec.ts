import { test, expect } from '@playwright/test';
import { apiLogin, createQuestion, getQuestion, primeAuth, registerUser } from './utils';
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
  await expect(dialog.getByRole('combobox', { name: '导入到分类' }).getByRole('option')).toHaveCount(17);
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
