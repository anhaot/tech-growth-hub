import { test, expect } from '@playwright/test';
import { adminUser, apiBaseUrl, apiLogin, loginByUi } from './utils';

test('管理员可以通过登录页完成登录', async ({ page }) => {
  await loginByUi(page, adminUser.username, adminUser.password);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('技术成长站')).toBeVisible();
  await expect(page.getByRole('heading', { name: new RegExp(`(夜深了|早上好|中午好|下午好|晚上好)，${adminUser.username}`) })).toBeVisible();
});

test('登录有效期可保存自定义时长和一直有效，并在新浏览器会话恢复', async ({ page, request, browser }) => {
  const login = await apiLogin(request, adminUser.username, adminUser.password);
  await loginByUi(page, adminUser.username, adminUser.password);
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/settings');
  await page.getByTestId('settings-tab-system').click();
  const duration = page.getByLabel('登录有效期', { exact: true });
  await expect(duration).toBeEnabled();
  try {
    await duration.selectOption('custom');
    await page.getByLabel('自定义登录时长').fill('12');
    await page.getByLabel('登录时长单位').selectOption('h');
    await page.getByTestId('save-session-duration').click();
    await expect(page.getByText('登录有效期已保存，并已应用到当前登录')).toBeVisible();
    const fixedCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'tgh_auth')!;
    expect(fixedCookie.expires - Date.now() / 1000).toBeGreaterThan(43100);
    expect(fixedCookie.expires - Date.now() / 1000).toBeLessThanOrEqual(43200);
    await page.reload();
    await page.getByTestId('settings-tab-system').click();
    await expect(duration).toHaveValue('custom');
    await expect(page.getByLabel('自定义登录时长')).toHaveValue('12');
    await expect(page.getByLabel('登录时长单位')).toHaveValue('h');
    await duration.selectOption('forever');
    await page.getByTestId('save-session-duration').click();
    await expect(page.getByText('登录有效期已保存，并已应用到当前登录')).toBeVisible();
    const cookies = await page.context().cookies();
    const persistentCookie = cookies.find((cookie) => cookie.name === 'tgh_auth')!;
    const payload = JSON.parse(Buffer.from(persistentCookie.value.split('.')[1], 'base64url').toString());
    expect(payload.exp).toBeUndefined();
    expect(persistentCookie.httpOnly).toBe(true);
    expect(persistentCookie.expires).toBeGreaterThan(Date.now() / 1000 + 365 * 86400);
    const restored = await browser.newContext();
    try {
      await restored.addCookies(cookies);
      const restoredPage = await restored.newPage();
      await restoredPage.goto(new URL('/', page.url()).href);
      await expect(restoredPage.getByRole('heading', { name: new RegExp(`，${adminUser.username}`) })).toBeVisible();
      await expect(restoredPage).toHaveURL(/\/$/);
      await restoredPage.getByRole('button', { name: '退出登录' }).click();
      await expect(restoredPage).toHaveURL(/\/login$/);
      await restoredPage.reload();
      await expect(restoredPage.getByTestId('login-username')).toBeVisible();
    } finally {
      await restored.close();
    }
  } finally {
    const reset = await request.put(`${apiBaseUrl}/admin/settings/login_session_duration`, {
      headers: { Authorization: `Bearer ${login.token}` }, data: { value: '7d' },
    });
    expect(reset.ok()).toBeTruthy();
  }
});
