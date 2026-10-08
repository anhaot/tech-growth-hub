import { expect, test } from '@playwright/test';
import { adminUser, apiLogin, primeAuth } from './utils';

test.use({ serviceWorkers: 'block' });

test('批量模型检查逐项更新并在结束后汇总', async ({ page, request }) => {
  const login = await apiLogin(request, adminUser.username, adminUser.password);
  const configs = [
    { id: 'fast-valid', provider: 'custom', displayName: '快速模型', model: 'model-fast', isActive: true, isCustom: true, modelStatus: 'unknown', createdAt: new Date().toISOString() },
    { id: 'slow-invalid', provider: 'custom', displayName: '不可用模型', model: 'model-invalid', isActive: false, isCustom: true, modelStatus: 'unknown', createdAt: new Date().toISOString() },
    { id: 'timeout-unknown', provider: 'custom', displayName: '超时模型', model: 'model-timeout', isActive: false, isCustom: true, modelStatus: 'unknown', createdAt: new Date().toISOString() },
  ];

  await page.route('**/api/ai/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      enabled: true,
      defaultProvider: 'custom',
      availableProviders: ['custom'],
      defaultConfigId: 'fast-valid',
      availableModels: configs.map((config) => ({
        id: config.id,
        label: config.displayName,
        provider: config.provider,
        model: config.model,
        isActive: config.isActive,
      })),
    }),
  }));
  await page.route('**/api/ai/config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(configs),
  }));
  await page.route('**/api/ai/credentials', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));

  const checks = {
    'fast-valid': { delay: 100, status: 'valid', error: undefined },
    'slow-invalid': { delay: 700, status: 'invalid', error: '当前账户无权调用该模型' },
    'timeout-unknown': { delay: 1_000, status: 'unknown', error: '推理接口在 90 秒内未响应' },
  } as const;
  for (const [id, check] of Object.entries(checks)) {
    await page.route(`**/api/ai/config/${id}/check`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, check.delay));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id,
          model: configs.find((config) => config.id === id)?.model,
          status: check.status,
          checkedAt: new Date().toISOString(),
          error: check.error,
        }),
      });
    });
  }

  await primeAuth(page, login);
  await page.goto('/settings');
  await page.getByTestId('settings-tab-ai').click();
  await page.getByRole('button', { name: '检查模型可用性' }).click();

  await expect(page.getByTestId('ai-config-fast-valid').getByText('可用', { exact: true })).toBeVisible();
  await expect(page.getByTestId('ai-config-timeout-unknown').getByText('检查中', { exact: true })).toBeVisible();

  const summary = page.getByTestId('ai-check-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByText('1', { exact: true })).toHaveCount(3);
  await expect(summary.getByText('其中 1 个模型等待上游响应超时。')).toBeVisible();
  await expect(summary.getByText('model-invalid', { exact: true })).toBeVisible();
  await expect(summary.getByText('model-timeout', { exact: true })).toBeVisible();
});
