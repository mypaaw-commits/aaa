import { expect, test } from '@playwright/test';
import { loadExample } from './fixtures';

test('English is the default; switching languages preserves models, reviews and notes', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'No model loaded' })).toBeVisible();
  await loadExample(page);
  await page.locator('.object-select').first().click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Reviewed: B.stl', exact: true }).check();
  await page.getByRole('button', { name: 'Notes: B.stl', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notes: B.stl', exact: true }).fill('Keep this note.');
  await page.getByRole('textbox', { name: 'Notes: B.stl', exact: true }).blur();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('button', { name: 'Analiza', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Sprawdzone: B.stl', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Notatki: B.stl', exact: true })).toHaveValue('Keep this note.');
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(1);
  await expect(page.locator('.scene-label')).toContainText('Widoczne: 3 / 3');
  await page.screenshot({ path: testInfo.outputPath('polish.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { name: 'Brak modelu', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Język', exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'No model loaded' })).toBeVisible();
});

test('Server errors are readable in English and follow the language switch', async ({ page }) => {
  await page.route('**/api/sessions', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Sesja wygasła. Odśwież stronę i wczytaj pliki ponownie.' }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Session expired. Refresh the page and import your files again.');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.getByRole('alert')).toContainText('Sesja wygasła. Odśwież stronę i wczytaj pliki ponownie.');
});
