import { test, expect } from '@playwright/test';
import { apiBaseUrl, apiLogin, createQuestion, primeAuth, registerUser } from './utils';

test('批量取消收藏保留题目、答题收藏和学习次数', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_batch`);
  const login = await apiLogin(request, user.username, user.password);
  const questions = [];
  for (let i = 0; i < 2; i++) {
    const q = await createQuestion(request, login.token, { title: `收藏题 ${i}`, content: `题干 ${i}`, answer: `答案 ${i}`, tags: ['batch'] });
    questions.push(q);
    for (const mode of ['study', 'quiz']) {
      expect((await request.post(`${apiBaseUrl}/questions/${q.id}/progress`, { headers: { Authorization: `Bearer ${login.token}` }, data: { mode, isBookmarked: true } })).ok()).toBeTruthy();
    }
  }
  await primeAuth(page, login);
  await page.goto('/bookmarks');
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await page.getByRole('button', { name: '全选当前列表' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '批量取消收藏', exact: true }).click();
  await expect(page.getByText('暂无收藏题目')).toBeVisible();
  for (const q of questions) {
    const response = await request.get(`${apiBaseUrl}/questions/${q.id}/progress?mode=study`, { headers: { Authorization: `Bearer ${login.token}` } });
    const progress = await response.json();
    expect(Boolean(progress.is_bookmarked)).toBe(false);
    expect(progress.view_count).toBe(1);
    expect((await request.get(`${apiBaseUrl}/questions/${q.id}`, { headers: { Authorization: `Bearer ${login.token}` } })).ok()).toBeTruthy();
  }
  await page.getByRole('button', { name: '答题收藏', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
});

test('学习页可修改答案并删除当前题，手机端菜单可用', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_actions`);
  const login = await apiLogin(request, user.username, user.password);
  const q = await createQuestion(request, login.token, { title: '可编辑题目', content: '可编辑题干', answer: '旧答案', explanation: '旧解析', tags: [] });
  await primeAuth(page, login);
  await page.goto('/study');
  await page.getByRole('button', { name: '编辑当前题目' }).click();
  await page.locator('textarea').nth(1).fill('修改后的参考答案');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('learning-question-answer')).toContainText('修改后的参考答案');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '更多题目操作' }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '删除题目', exact: true }).click();
  await expect(page.getByTestId('learning-question-content')).toContainText('可编辑题干');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除题目', exact: true }).click();
  await expect(page.getByText('暂无题目')).toBeVisible();
  expect((await request.get(`${apiBaseUrl}/questions/${q.id}`, { headers: { Authorization: `Bearer ${login.token}` } })).status()).toBe(404);
});
