import { test, expect } from '@playwright/test';
import { adminUser, apiBaseUrl, apiLogin, primeAuth, registerUser } from './utils';

test('首次登录用户必须修改密码后才能进入系统', async ({ page, request }) => {
  const user = await registerUser(request, `first_login_${Date.now()}`);
  const login = await apiLogin(request, user.username, user.password);
  const adminLogin = await apiLogin(request, adminUser.username, adminUser.password);
  const headers = { Authorization: `Bearer ${adminLogin.token}` };
  const backupResponse = await request.get(`${apiBaseUrl}/admin/backup/export`, { headers });
  expect(backupResponse.ok()).toBeTruthy();
  const backup = await backupResponse.json();
  const storedUser = backup.dataset.users.find((entry: { id: string }) => entry.id === login.user.id);
  storedUser.must_change_password = true;
  const restore = await request.post(`${apiBaseUrl}/admin/backup/restore`, { headers, data: { dataset: backup.dataset } });
  expect(restore.ok()).toBeTruthy();
  await primeAuth(page, login);

  await page.goto('/');
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: '首次登录，请修改密码' })).toBeVisible();

  await page.getByTestId('change-password-new').fill('ChangedPass123');
  await page.getByTestId('change-password-confirm').fill('ChangedPass123');
  await page.getByTestId('change-password-submit').click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('技术成长站')).toBeVisible();
});
