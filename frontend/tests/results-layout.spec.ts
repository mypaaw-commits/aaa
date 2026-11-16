import { expect, test } from '@playwright/test';
import { loadExample, stlBox } from './fixtures';

test('Analysis combines connections and checks in one group per part, with useful filters and a separate checklist', async ({ page }, testInfo) => {
  await page.goto('/'); await loadExample(page);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Connections', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  await expect(page.locator('.connection-group-toggle')).toHaveCount(3);
  await page.getByRole('button', { name: 'Part results: B.stl', exact: true }).click();
  await expect(page.locator('#checks-panel .pair-status')).toHaveText(['Intersection', 'Connected']);
  await expect(page.locator('#checks-panel .pair-actions button')).toHaveCount(2);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/intersection')) requests.push(request.url()); });
  await page.getByRole('button', { name: 'Intersections', exact: true }).click();
  await expect(page.locator('.connection-group-toggle')).toHaveCount(2);
  await expect(page.locator('#checks-panel .pair-status')).toHaveText('Intersection');
  await page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true }).click();
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  await page.getByRole('button', { name: 'All relationships', exact: true }).click();
  await expect(page.locator('.connection-group-toggle')).toHaveCount(3);
  expect(requests).toHaveLength(0); // isolation and filters reuse the loaded result
  await page.screenshot({ path: testInfo.outputPath('checks-groups.png') });
  const analysis = page.getByRole('tab', { name: 'Analysis', exact: true });
  await analysis.focus(); await analysis.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Part checklist', exact: true })).toBeFocused();
  await page.getByRole('checkbox', { name: 'Reviewed: B.stl', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Reviewed: C.stl', exact: true })).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('part-checklist.png') });
});

test('One consistent blue is used for selection and pair inspection', async ({ page }) => {
  await page.goto('/'); await loadExample(page);
  await page.locator('.object-row').filter({ hasText: 'A.stl' }).locator('.object-select').click();
  await expect(page.locator('.object-row[aria-selected=true] .part-swatch')).toHaveCSS('background-color','rgb(78, 131, 186)');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.getByRole('button', { name: 'Part results: B.stl', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true }).click();
  for (const swatch of await page.locator('.object-row[aria-selected=true] .part-swatch').all()) await expect(swatch).toHaveCSS('background-color','rgb(78, 131, 186)');
});

test('Uncertain pairs have one inspection action and remain manually reviewed', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  const broken = stlBox('open.stl', 0);
  broken.buffer = Buffer.from(broken.buffer.toString().replace(/facet normal[^]*?endfacet\n/, ''));
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl',0),broken]);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Needs review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Needs review', exact: true }).click();
  await page.getByRole('button', { name: 'Part results: A.stl', exact: true }).click();
  await expect(page.locator('.pair-actions button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect pair: A.stl / open.stl', exact: true }).click();
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('uncertain-results.png') });
});
