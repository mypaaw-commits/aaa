import { expect, test } from '@playwright/test';
import { stlBox } from './fixtures';

test('Editable margin invalidates reviews, preserves notes and is applied before Analyze, including Polish decimals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', 0), stlBox('B.stl', 1.9995)]);
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('0 intersection pairs · 1 within tolerance');
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Reviewed: A.stl', exact: true }).check();
  await page.getByRole('button', { name: 'Notes: A.stl', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes: A.stl', exact: true }).fill('Retain this note');
  const margin = page.getByRole('textbox', { name: 'Fit margin (mm)', exact: true });
  await margin.fill('0.0001');
  await margin.press('Enter');
  await expect(page.locator('.review-status.stale')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Notes: A.stl', exact: true })).toHaveValue('Retain this note');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  const polishMargin = page.getByRole('textbox', { name: 'Margines dopasowania (mm)', exact: true });
  await polishMargin.fill('0,001');
  // A direct click must finish the setting save and run the analysis in one action.
  await page.getByRole('button', { name: 'Analiza', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('Pary z intersekcją: 0 · W marginesie: 1');
  await expect(polishMargin).toHaveValue('0,001');
  await polishMargin.fill('0');
  await page.getByRole('button', { name: 'Analiza', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('Pary z intersekcją: 1');
});

test('Invalid margin does not start an analysis or overwrite the saved setting', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', 0), stlBox('B.stl', 1)]);
  await expect(page.locator('.object-row')).toHaveCount(2);
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/analysis')) posts.push(request.url()); });
  const margin = page.getByRole('textbox', { name: 'Fit margin (mm)', exact: true });
  await margin.fill('-1');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a fit margin from 0 to 10 mm.');
  expect(posts).toHaveLength(0);
  await margin.fill('0.001');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  expect(posts).toHaveLength(1);
});
