import { expect, test } from '@playwright/test';
import { loadExample } from './fixtures';

const blue = 'rgb(98, 140, 168)';

test('Checks collapse by category and object; checklist is a separate tab', async ({ page }, testInfo) => {
  await page.goto('/');
  await loadExample(page);
  const checks = page.getByRole('tab', { name: 'Checks', exact: true });
  const checklist = page.getByRole('tab', { name: 'Part checklist', exact: true });
  await expect(page.getByRole('tab')).toHaveCount(3);
  await checklist.click();
  await expect(page.locator('#checklist-panel')).toBeVisible();
  await expect(page.locator('#checklist-panel .review-row')).toHaveCount(3);
  await expect(page.locator('#checks-panel')).toBeHidden();
  await expect(page.locator('#checklist-panel input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(checks).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#checks-panel .review-row')).toHaveCount(0);
  await expect(page.locator('#checks-panel .intersection-group')).toHaveCount(2);
  const category = page.getByRole('button', { name: 'Intersections', exact: true });
  await expect(category).toContainText('1');
  await page.getByRole('button', { name: 'Intersections of B.stl', exact: true }).click();
  await expect(page.locator('#checks-panel .result-pair')).toHaveCount(1);
  // Isolation reloads the overlay. Capture the baseline after that response is
  // consumed and painted, rather than before an arbitrary 300 ms delay expires.
  const overlay = page.waitForResponse(response => response.url().endsWith('/intersection') && response.ok());
  await page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true }).click();
  await (await overlay).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = await page.locator('canvas').screenshot();
  await category.click();
  await expect(category).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#intersections-groups')).toBeHidden();
  await expect(page.getByLabel('Show intersections', { exact: true })).toBeChecked();
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  expect(Buffer.compare(before, await page.locator('canvas').screenshot())).toBe(0);
  await category.press('Enter');
  await expect(page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('checks-groups.png') });
  await checks.focus();
  await checks.press('ArrowRight');
  await expect(checklist).toBeFocused();
  await page.getByRole('checkbox', { name: 'Reviewed: B.stl', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Reviewed: C.stl', exact: true })).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('part-checklist.png') });
  await checklist.press('End');
  await expect(checklist).toBeFocused();
  await checklist.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Connections', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Connections', exact: true }).press('ArrowLeft');
  await expect(checklist).toBeFocused();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.getByRole('tab', { name: 'Checklista części', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('checkbox', { name: 'Sprawdzone: B.stl', exact: true })).toBeChecked();
});

test('The same selection blue is used for ordinary, multiple and inspected objects', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  const a = page.locator('.object-row').filter({ hasText: 'A.stl' });
  const b = page.locator('.object-row').filter({ hasText: 'B.stl' });
  await a.locator('.object-select').click();
  await expect(a.locator('.part-swatch')).toHaveCSS('background-color', blue);
  await b.locator('.object-select').click({ modifiers: ['Control'] });
  await expect(b.locator('.part-swatch')).toHaveCSS('background-color', blue);
  await expect(a.locator('.part-swatch')).toHaveCSS('background-color', blue);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.getByRole('button', { name: 'Intersections of B.stl', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true }).click();
  await expect(page.locator('.object-row[aria-selected=true] .part-swatch')).toHaveCount(2);
  for (const swatch of await page.locator('.object-row[aria-selected=true] .part-swatch').all()) await expect(swatch).toHaveCSS('background-color', blue);
  await expect(a.locator('.part-swatch')).toHaveCSS('background-color', 'rgb(148, 148, 148)');
  await page.getByRole('button', { name: 'Transparency', exact: true }).click();
  await expect(b.locator('.part-swatch')).toHaveCSS('background-color', blue);
  await expect(page.locator('.selection-color-legend')).toHaveText('Not selectedSelected');
});

test('Uncertain pairs are exposed separately and each result has one inspection action', async ({ page }, testInfo) => {
  const { stlBox } = await import('./fixtures');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  const broken = stlBox('open.stl', 0);
  broken.buffer = Buffer.from(broken.buffer.toString().replace(/facet normal[^]*?endfacet\n/, ''));
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', 0), broken]);
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Needs review', exact: true })).toBeVisible();
  await expect(page.locator('.category-intersections')).toContainText('No intersections found');
  await page.getByRole('button', { name: 'Intersections of A.stl', exact: true }).click();
  await expect(page.locator('.category-uncertain .pair-actions button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect pair: A.stl / open.stl', exact: true }).click();
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('uncertain-results.png') });
});
