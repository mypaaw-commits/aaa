import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loadExample } from './fixtures';

test('PDF download waits for the final note and includes hidden parts in manual order', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  await page.locator('.object-row').filter({ hasText: 'C.stl' }).locator('.object-select').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await page.getByTitle('Hide C.stl', { exact: true }).click();
  const order = await page.locator('.object-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-id')));
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export PDF', exact: true })).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Reviewed: B.stl', exact: true }).check();
  await page.getByRole('button', { name: 'Notes: B.stl', exact: true }).click();
  const latestNote = 'Final note: sprawdzono łączenie <socket> & peg.';
  await page.getByRole('textbox', { name: 'Notes: B.stl', exact: true }).fill(latestNote);
  let saved = false;
  await page.route('**/api/sessions/*/tasks/*', async route => {
    if (route.request().method() === 'PATCH') await new Promise(resolve => setTimeout(resolve, 300));
    await route.continue();
  });
  page.on('response', response => { if (response.url().includes('/tasks/') && response.ok()) saved = true; });
  const requested = page.waitForRequest(request => request.url().endsWith('/report'));
  const [download, request] = await Promise.all([
    page.waitForEvent('download'), requested,
    page.getByRole('button', { name: 'Export PDF', exact: true }).click(),
  ]);
  expect(saved).toBe(true);
  expect(request.postDataJSON()).toMatchObject({ language: 'en', part_ids: order });
  expect(download.suggestedFilename()).toMatch(/^modelcheck-checklist-\d{4}-\d{2}-\d{2}\.pdf$/);
  const file = await readFile((await download.path())!);
  expect(file.subarray(0, 5).toString()).toBe('%PDF-');
  expect(file.length).toBeGreaterThan(10000);
  const sid = request.url().match(/sessions\/([^/]+)/)![1];
  const state = await (await page.request.get(`/api/sessions/${sid}/analysis`)).json();
  expect(state.tasks.some((task: { note: string }) => task.note === latestNote)).toBe(true);
  await expect(page.locator('.review-count')).toHaveText('1 / 3 reviewed');
  await expect(page.locator('.scene-label')).toContainText('2 / 3 visible');
});

test('A failed review save blocks PDF export until the edit succeeds; Polish export downloads', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  let failed = false;
  await page.route('**/api/sessions/*/tasks/*', async route => {
    if (!failed && route.request().method() === 'PATCH') { failed = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Save failed' }) }); }
    else await route.continue();
  });
  let reports = 0;
  page.on('request', request => { if (request.url().endsWith('/report')) reports++; });
  const review = page.getByRole('checkbox', { name: 'Reviewed: B.stl', exact: true });
  await review.check();
  await expect(page.getByRole('alert')).toContainText('Save failed');
  await expect(review).not.toBeChecked();
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review changes could not be saved');
  expect(reports).toBe(0);
  await review.check();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Eksportuj PDF', exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(reports).toBe(1);
});

test('The export footer stays visible while a long checklist scrolls', async ({ page }, testInfo) => {
  const { stlBox } = await import('./fixtures');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 24 }, (_, i) => stlBox(`Part ${i + 1}.stl`, i * 3)));
  await expect(page.locator('.object-row')).toHaveCount(24);
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  const button = page.getByRole('button', { name: 'Export PDF', exact: true });
  const panel = (await page.locator('#checklist-panel').boundingBox())!;
  const footer = (await page.locator('.checklist-footer').boundingBox())!;
  expect(Math.abs(footer.y + footer.height - panel.y - panel.height)).toBeLessThan(3);
  await page.locator('.part-review-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.review-row').last()).toBeInViewport();
  await expect(button).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('checklist-long.png') });
});
