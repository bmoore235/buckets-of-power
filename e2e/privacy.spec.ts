import { expect, test } from '@playwright/test';

test('keeps file input available and blocks outbound connections', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByTestId('fit-upload')).toBeAttached();
  await expect(page.getByText('100% local')).toBeVisible();
  await expect(page.locator('#about')).toBeAttached();
  await expect(page.locator('#about').getByRole('heading', { name: 'About' })).toBeVisible();
  const fetchResult = await page.evaluate(async () => {
    try { await fetch('https://example.invalid/privacy-check'); return 'allowed'; }
    catch { return 'blocked'; }
  });
  expect(fetchResult).toBe('blocked');
  expect(externalRequests).toEqual([]);
});

test('provides keyboard skip navigation and accessible analysis controls', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await expect(page.getByRole('spinbutton', { name: 'Bucket size W' })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('tr[role="button"]')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Power balance buckets' })).toBeVisible();
  await expect(page.locator('.balance-numbers .left-dot')).toHaveCSS('border-radius', '1px');
  await expect(page.locator('.balance-numbers .right-dot')).toHaveCSS('border-radius', '50%');
  await expect(page.locator('.split-bar span:last-child')).toHaveCSS('background-image', /repeating-linear-gradient/);
});

test('follows system color preference and allows a saved theme override', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(245, 247, 244)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(16, 23, 19)');
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.getByRole('button', { name: 'Use system theme' })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
  await page.reload();
  expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(245, 247, 244)');

  await page.getByRole('button', { name: 'Use system theme' }).click();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(16, 23, 19)');
});