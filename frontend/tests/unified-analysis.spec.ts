import { expect, test } from '@playwright/test';
import { loadExample } from './fixtures';

test('One Analyze action creates connections, check results and a manual checklist, and tolerates a polling reset', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.analysis-controls button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeDisabled();
  await loadExample(page);
  let resets = 0;
  await page.route('**/api/sessions/*/analysis', async route => {
    if (route.request().method() === 'GET' && resets === 0) {
      resets++; await route.abort('connectionreset'); return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  expect(resets).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Find connections', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check intersections', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connections of B.stl', exact: true }).click();
  await expect(page.locator('#relations-panel .result-pair')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-row input[type=checkbox]')).toHaveCount(3);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
});
