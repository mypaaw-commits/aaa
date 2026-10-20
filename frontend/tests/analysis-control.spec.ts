import { expect, test } from '@playwright/test';
import { loadExample } from './fixtures';

test('Running analysis shows its real stage and elapsed time, supports cancellation and translates live', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  let cancelled = false;
  let cancelRequests = 0;
  await page.route('**/api/sessions/*/analysis/cancel', async route => {
    expect(route.request().method()).toBe('POST');
    cancelled = true; cancelRequests++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/sessions/*/analysis', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch();
    const result = await response.json();
    result.job = { ...result.job, state: cancelled ? 'cancelled' : 'running', stage: cancelled ? 'stopping' : 'fit', seconds: 42.4 };
    result.relations = []; result.tasks = [];
    await route.fulfill({ json: result });
  });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-stage')).toHaveText('Verifying the fit margin · 42 s');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('pl');
  await expect(page.locator('.analysis-stage')).toHaveText('Weryfikacja marginesu dopasowania · 42 s');
  await page.getByRole('button', { name: 'Przerwij analizę', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analiza', exact: true })).toBeEnabled();
  await expect(page.locator('.statusbar')).toContainText('Analiza przerwana. Poprzednie wyniki zostały zachowane.');
  await expect(page.locator('.analysis-stage')).toHaveCount(0);
  await expect(page.locator('.review-row')).toHaveCount(3);
  await expect(page.locator('.review-row input[type=checkbox]')).toHaveCount(0);
  expect(cancelRequests).toBe(1);
});

test('A computation limit is explicit in the results and checklist, never reported as clear', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  await page.route('**/api/sessions/*/analysis', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch();
    const result = await response.json();
    if (result.job?.state === 'done') {
      const row = result.relations.find((relation: { kind: string }) => relation.kind === 'INTERSECTION');
      row.kind = 'UNCERTAIN'; row.reason = 'COMPUTATION_LIMIT'; row.volume = null;
      for (const task of result.tasks) if (row.part_ids.includes(task.part_id)) {
        task.result = 'UNCERTAIN'; task.uncertain_pairs = 1; task.intersections = 0;
      }
    }
    await route.fulfill({ json: result });
  });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-warning')).toHaveText('1 pair needs manual verification');
  const group = page.locator('.category-uncertain .connection-group-toggle').first();
  await group.click();
  await expect(page.locator('.pair-explanation:visible')).toContainText('Automatic verification incomplete');
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-status.uncertain')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
});
