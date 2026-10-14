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

test('分类筛选贯穿题库、学习和收藏，设置只保留分类管理', async ({ page, request }) => {
  const user = await registerUser(request, `${Date.now()}_category_only`);
  const login = await apiLogin(request, user.username, user.password);
  const category = await request.post(`${apiBaseUrl}/categories`, { headers: { Authorization: `Bearer ${login.token}` }, data: { name: '分类回归' } });
  expect(category.ok()).toBeTruthy();
  const { id: categoryId } = await category.json();
  const categorized = await createQuestion(request, login.token, { title: '有分类题', content: '有分类题干', answer: '答案', categoryId });
  const plain = await createQuestion(request, login.token, { title: '未分类题', content: '未分类题干', answer: '答案' });
  for (const question of [categorized, plain]) {
    const bookmark = await request.post(`${apiBaseUrl}/questions/${question.id}/progress`, { headers: { Authorization: `Bearer ${login.token}` }, data: { mode: 'study', isBookmarked: true } });
    expect(bookmark.ok()).toBeTruthy();
  }
  await primeAuth(page, login);
  await page.goto('/questions');
  await expect(page.getByPlaceholder('标签筛选')).toHaveCount(0);
  await page.getByRole('combobox').filter({ has: page.locator(`option[value="${categoryId}"]`) }).selectOption(categoryId);
  await expect(page.getByText('有分类题干', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('未分类题干', { exact: true })).toHaveCount(0);
  await page.goto('/study');
  await page.getByRole('combobox').filter({ has: page.locator(`option[value="${categoryId}"]`) }).selectOption(categoryId);
  await expect(page.getByTestId('learning-question-content')).toContainText('有分类题干');
  await expect(page.getByPlaceholder('按标签学习')).toHaveCount(0);
  await page.goto('/bookmarks');
  const filter = page.getByRole('combobox', { name: '收藏分类' });
  await filter.selectOption(categoryId);
  await expect(page.getByText('有分类题干', { exact: true })).toBeVisible();
  await expect(page.getByText('未分类题干', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '全选当前列表', exact: true }).click();
  await expect(page.getByText('已选 1 道')).toBeVisible();
  await filter.selectOption('uncategorized');
  await expect(page.getByText('未分类题干', { exact: true })).toBeVisible();
  await expect(page.getByText('已选 0 道')).toBeVisible();
  await page.goto('/settings');
  await page.getByTestId('settings-tab-categories').click();
  await expect(page.getByRole('heading', { name: '分类管理', exact: true })).toBeVisible();
  await expect(page.getByText('分类回归', { exact: true })).toBeVisible();
  await expect(page.getByText(/标签健康|标签管理|标签别名/)).toHaveCount(0);
});
