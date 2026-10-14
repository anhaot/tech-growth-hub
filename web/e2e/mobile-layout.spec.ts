import { expect, test } from '@playwright/test';
import { apiLogin, createQuestion, primeAuth } from './utils';

test.use({ viewport: { width: 390, height: 844 } });

test('手机端核心页面使用独立布局且不会横向溢出', async ({ page, request }) => {
  const login = await apiLogin(request, 'e2e_admin', 'AdminPass123');
  await primeAuth(page, login);

  for (const route of ['/', '/questions', '/capture', '/study', '/quiz', '/bookmarks', '/settings']) {
    await page.goto(route);
    await expect(page.getByRole('banner')).toBeVisible();

    const bottomNavigation = page.locator('body > #root nav').last();
    await expect(bottomNavigation).toBeVisible();
    await expect(bottomNavigation.getByRole('link')).toHaveCount(5);
    if (route === '/quiz') {
      await expect(bottomNavigation.getByRole('link', { name: '答题' })).toHaveClass(/text-blue-600/);
      await expect(bottomNavigation.getByRole('link', { name: '背题' })).toHaveCount(0);
    }

    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(layout.documentWidth, `${route} document 横向溢出`).toBeLessThanOrEqual(layout.viewport);
    expect(layout.bodyWidth, `${route} body 横向溢出`).toBeLessThanOrEqual(layout.viewport);
  }
});

test('手机端背题和答题操作条位于题目下方且上下栏之间都可滑动切题', async ({ page, request }) => {
  const login = await apiLogin(request, 'e2e_admin', 'AdminPass123');
  await createQuestion(request, login.token, {
    title: '移动端短题',
    content: '什么是闭包？',
    answer: '闭包是函数与其词法环境的组合。',
    difficulty: 'easy',
  });
  await createQuestion(request, login.token, {
    title: '移动端长题',
    content: '请说明事件循环、宏任务和微任务之间的执行关系。',
    answer: '同步代码完成后会先清空微任务队列，再进入下一轮宏任务。',
    explanation: '滑动测试题用于覆盖不同高度的题目卡片。',
    difficulty: 'medium',
  });
  await primeAuth(page, login);

  for (const route of ['/study', '/quiz']) {
    await page.goto(route);

    const swipeRegion = page.getByTestId('learning-swipe-region');
    const questionCard = page.getByTestId('learning-question-card');
    const toolbar = page.getByTestId('learning-mobile-toolbar');
    const mobileMain = page.locator('main');
    await expect(swipeRegion).toBeVisible();
    await expect(toolbar).toBeVisible();
    const controls = page.getByTestId('learning-question-controls');
    await expect(controls.getByRole('button', { name: '版本历史' })).toBeVisible();
    await expect(page.getByText(/浏览位置|已查看 .* 次/)).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 844 });
    const number = await controls.getByRole('spinbutton').boundingBox();
    const history = await controls.getByRole('button', { name: '版本历史' }).boundingBox();
    expect(number).not.toBeNull(); expect(history).not.toBeNull();
    expect(Math.abs(number!.y - history!.y)).toBeLessThan(12);
    await page.setViewportSize({ width: 390, height: 844 });

    const positions = await Promise.all([
      questionCard.boundingBox(),
      toolbar.boundingBox(),
      swipeRegion.boundingBox(),
    ]);
    expect(positions[0]).not.toBeNull();
    expect(positions[1]).not.toBeNull();
    expect(positions[2]).not.toBeNull();
    expect(positions[1]!.y).toBeGreaterThanOrEqual(positions[0]!.y + positions[0]!.height);
    expect(positions[2]!.height).toBeGreaterThanOrEqual(844 - 52 - 72 - 24);

    const counter = toolbar.locator('span').filter({ hasText: /^\d+\/\d+$/ });
    const initialCounter = await counter.textContent();
    const [initialIndex, total] = (initialCounter || '').split('/').map(Number);
    test.skip(total < 2, '需要至少两道题验证滑动切题');

    const direction = initialIndex < total ? -1 : 1;
    const startX = direction < 0 ? 340 : 50;
    const endX = direction < 0 ? 50 : 340;
    await mobileMain.dispatchEvent('touchstart', {
      touches: [{ identifier: 1, clientX: startX, clientY: 770 }],
    });
    await mobileMain.dispatchEvent('touchend', {
      changedTouches: [{ identifier: 1, clientX: endX, clientY: 770 }],
    });

    await expect(counter).not.toHaveText(initialCounter || '');
  }
});
