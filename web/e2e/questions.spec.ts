import { test, expect } from '@playwright/test';
import { apiLogin, createQuestion, getQuestion, primeAuth, registerUser } from './utils';

// Mocked API responses must not be intercepted by a real service worker.
test.use({ serviceWorkers: 'block' });

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
  await page.getByTestId('question-tags-input').fill('e2e,create');
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
