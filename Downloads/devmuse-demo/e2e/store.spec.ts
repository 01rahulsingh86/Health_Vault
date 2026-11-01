import { test, expect } from '@playwright/test';
test('browser can request a quote', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get quote' }).click();
  await expect(page.locator('#result')).toHaveText('Total: $25.00');
});
