import { test, expect } from '@playwright/test';
import { apiLogin, createQuestion, primeAuth, registerUser } from './utils';

test('背题页可以加载题目并直接展示答案', async ({ page, request }) => {
  const suffix = `${Date.now()}_study`;
  const user = await registerUser(request, suffix);
  const login = await apiLogin(request, user.username, user.password);
  const question = await createQuestion(request, login.token, {
    title: `背题回归测试 ${suffix}`,
    content: `背题页题干 ${suffix}`,
    answer: `背题页答案 ${suffix}`,
    explanation: '背题页解析',
    tags: ['e2e', 'study'],
  });

  await primeAuth(page, login);
  await page.goto('/study');

  await expect(page.getByRole('heading', { name: '背题模式' })).toBeVisible();
  await expect(page.getByTestId('learning-question-content')).toContainText(question.content);
  await expect(page.getByTestId('learning-question-answer')).toContainText(question.answer);
  await expect(page.getByText(/浏览位置|已查看 .* 次/)).toHaveCount(0);
  await expect(page.getByText('100% 已完成')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '收藏当前题目' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '当前浏览位置' })).toHaveCount(0);
  const controls = page.getByTestId('learning-question-controls');
  await expect(controls.getByRole('spinbutton', { name: '跳转题号' })).toHaveValue('1');
  await controls.getByRole('button', { name: '版本历史' }).click();
  const history = page.getByRole('dialog', { name: '题目版本历史', exact: true });
  await expect(history).toBeVisible();
  await expect(history.getByText('标签', { exact: true })).toHaveCount(0);
  await expect(page.getByText('题库暂时加载失败')).toHaveCount(0);
});
