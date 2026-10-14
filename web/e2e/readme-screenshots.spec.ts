import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminUser, apiLogin, createQuestion, primeAuth } from './utils';

test.skip(!process.env.CAPTURE_README, '仅在更新 README 截图时运行');

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.resolve(webRoot, '../../docs/images');

test('生成 README 产品截图', async ({ page, request }) => {
  const login = await apiLogin(request, adminUser.username, adminUser.password);
  const demoQuestions = [
    ['Linux 系统负载很高时，应该如何排查？', '先确认 load 与 CPU 核数，再按 CPU、内存、I/O、进程四条线排查。'],
    ['Kubernetes Pod 一直处于 Pending 状态有哪些常见原因？', '检查资源不足、节点选择器、污点容忍、PVC 绑定和调度事件。'],
    ['Redis 缓存雪崩如何治理？', '使用过期时间抖动、多级缓存、限流熔断、预热和高可用集群共同治理。'],
  ];
  for (const [content, answer] of demoQuestions) {
    await createQuestion(request, login.token, {
      title: content,
      content,
      answer,
    });
  }
  await primeAuth(page, login);
  await page.setViewportSize({ width: 1440, height: 960 });

  await page.goto('/');
  await expect(page.getByText('技术成长站')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'overview.png'), fullPage: true });

  await page.goto('/questions');
  await expect(page.getByRole('heading', { name: '题库', exact: true })).toBeVisible();
  await expect(page.getByText('Linux 系统负载很高时，应该如何排查？').last()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'question-library.png'), fullPage: true });

  await page.goto('/capture');
  await page.getByPlaceholder(/每行一道题/).fill('Nginx 大量 502 如何定位？\nMySQL 慢查询的排查流程是什么？');
  await page.getByRole('button', { name: '保存到草稿箱' }).click();
  await expect(page.getByText('草稿箱（2）')).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'interview-capture.png'), fullPage: true });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '备份与恢复', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '用户管理', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, 'settings.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/study');
  await expect(page.getByRole('button', { name: '更多题目操作' })).toBeVisible();
  await page.getByRole('spinbutton', { name: '跳转题号' }).fill('1');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(page.getByTestId('learning-question-content')).toContainText('Redis 缓存雪崩');
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-review.png'), fullPage: true });
});
