import { expect, test } from '@playwright/test';
import { loadExample, stlBox } from './fixtures';

test('Transparency is independent of analysis, selection and intersection overlay', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  await page.locator('.object-select').first().click();
  const toggle = page.getByRole('button', { name: 'Transparency', exact: true });
  const canvas = page.locator('canvas');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  const bounds = (await canvas.boundingBox())!;
  // Compare an interior face patch; coplanar STL edges can vary with GPU antialiasing.
  const patch = () => page.screenshot({ clip: { x: bounds.x + bounds.width / 2 - 16, y: bounds.y + bounds.height / 2 - 16, width: 32, height: 32 } });
  const opaque = await patch();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(Buffer.compare(opaque, await patch())).not.toBe(0);
  await expect(page.locator('.review-row input[type=checkbox]')).toHaveCount(0);
  await expect(page.getByLabel('Show intersections', { exact: true })).toBeDisabled();
  await toggle.click();
  expect(Buffer.compare(opaque, await patch())).toBe(0);
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.getByLabel('Show intersections', { exact: true })).toBeChecked();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await page.getByLabel('Show intersections', { exact: true }).uncheck();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(1);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
});

test('Coincident objects are purple and still require manual review', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles([stlBox('original.stl', 0, 8), stlBox('copy.stl', 0, 8), stlBox('other.stl', 20, 8)]);
  await expect(page.locator('.object-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await expect(page.locator('#relations-panel .coincident-label')).toHaveText('Coincident');
  await page.getByRole('button', { name: 'Select pair: copy.stl / original.stl', exact: true }).click();
  for (const name of ['copy.stl', 'original.stl']) {
    const row = page.locator('.object-row').filter({ hasText: name });
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row.locator('.part-swatch')).toHaveCSS('background-color', 'rgb(149, 107, 182)');
  }
  await expect(page.locator('.object-row').filter({ hasText: 'other.stl' })).toHaveAttribute('aria-selected', 'false');
  await page.getByRole('button', { name: 'Isolate pair: copy.stl / original.stl', exact: true }).click();
  await expect(page.locator('.scene-label')).toContainText('2 / 3 visible');
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.locator('.review-status.has-coincident')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await page.waitForTimeout(350);
  await page.screenshot({ path: testInfo.outputPath('coincident.png') });
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.locator('#checks-panel .coincident-label')).toHaveText('Pełne pokrycie');
  await expect(page.getByRole('button', { name: 'Przezroczystość', exact: true })).toBeVisible();
});
