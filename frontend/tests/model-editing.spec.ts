import { expect, test } from '@playwright/test';
import { loadExample, stlBox } from './fixtures';

test('Delete selected removes a batch, Delete works on the list, and the empty scene accepts another import', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await loadExample(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  const rows = page.locator('.object-row');
  await rows.filter({ hasText: 'A.stl' }).locator('.object-select').click();
  await rows.filter({ hasText: 'B.stl' }).locator('.object-select').click({ modifiers: ['Control'] });
  await rows.filter({ hasText: 'B.stl' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveText('Delete selected (2)');
  const deleted: string[][] = [];
  page.on('request', request => {
    if (request.method() === 'DELETE' && request.url().endsWith('/parts')) deleted.push(request.postDataJSON().part_ids);
  });
  await page.getByRole('menuitem', { name: 'Delete selected (2)', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('C.stl');
  expect(deleted).toHaveLength(1);
  expect(deleted[0]).toHaveLength(2);
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-row')).toHaveCount(1);
  await expect(page.locator('.review-row')).toContainText('Out of date');
  await rows.locator('.object-select').click();
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No model loaded', exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', 0)]);
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await expect(page.locator('.scene-label')).toContainText('1 / 1 visible');
  expect(errors).toEqual([]);
});

test('Deleting a part whose 3D geometry is still loading keeps the loaded count correct', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/sessions/*/parts/*/stl', async route => {
    requests++;
    if (requests === 3) await gate;
    await route.continue();
  });
  try {
    await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', 0), stlBox('B.stl', 3), stlBox('C.stl', 6)]);
    await expect(page.locator('.geometry-loading')).toHaveText('Loading 3D view: 2 / 3');
    await page.locator('.object-row').filter({ hasText: 'C.stl' }).locator('.object-select').click();
    await page.keyboard.press('Delete');
    await expect(page.locator('.object-row')).toHaveCount(2);
    await expect(page.locator('.geometry-loading')).toHaveCount(0);
    await expect(page.locator('.scene-label')).toContainText('2 / 2 visible');
  } finally { release(); }
});

test('Additional imports queue during analysis and upload, then leave isolation and clear the list filter', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  await page.locator('.object-row').filter({ hasText: 'B.stl' }).locator('.object-select').click();
  await page.getByRole('button', { name: 'Isolate selection', exact: true }).click();
  await page.getByRole('button', { name: 'Search objects', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search objects', exact: true }).fill('B.stl');
  let holdAnalysis = true;
  await page.route('**/api/sessions/*/analysis', async route => {
    if (route.request().method() !== 'GET' || !holdAnalysis) { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    if (body.job) body.job.state = 'running';
    await route.fulfill({ response, json: body });
  });
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  let firstUpload = true;
  await page.route('**/api/sessions/*/parts', async route => {
    if (route.request().method() === 'POST' && firstUpload) { firstUpload = false; await uploadGate; }
    await route.continue();
  });
  const importButton = page.getByRole('button', { name: 'Import STL', exact: true });
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analyzing…', exact: true })).toBeDisabled();
  await expect(importButton).toBeEnabled();
  const chooser = page.waitForEvent('filechooser');
  await importButton.click();
  await (await chooser).setFiles([stlBox('D.stl', 20)]);
  await page.locator('input[type=file]').setInputFiles([stlBox('E.stl', 25)]);
  await expect(page.locator('.import-queue')).toHaveText('Queued for import: 2');
  await expect(page.locator('.object-row')).toHaveCount(1); // Search still shows B before the import starts.
  holdAnalysis = false;
  await expect(page.locator('.statusbar').getByRole('status')).toHaveText('Processing…');
  await expect(page.locator('.import-queue')).toHaveText('');
  await page.locator('input[type=file]').setInputFiles([stlBox('F.stl', 30)]);
  await expect(page.locator('.import-queue')).toHaveText('Queued for import: 1');
  releaseUpload();
  await expect(page.locator('.object-row')).toHaveCount(6);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await expect(page.locator('.import-queue')).toHaveText('');
  await expect(page.locator('.scene-label')).toContainText('Full model');
  await expect(page.locator('.scene-label')).toContainText('6 / 6 visible');
  await expect(page.getByRole('textbox', { name: 'Search objects', exact: true })).toHaveValue('');
  await expect(page.locator('.object-row[aria-selected=true]')).toContainText('B.stl');
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).not.toBeChecked();
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-row')).toHaveCount(6);
  await expect(page.locator('.review-row .review-status.stale')).toHaveCount(3);
});

test('The floor stays below the complete model when framing, isolating or hiding a higher part', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  const low = stlBox('Low.stl', -3, 6, -3), high = stlBox('High.stl', -3, 6, -3);
  function atZ(file: typeof low, z: number) {
    file.buffer = Buffer.from(file.buffer.toString().replace(/vertex (\S+) (\S+) (\S+)/g, (_, x, y, original) => `vertex ${x} ${y} ${Number(original) + z}`));
    return file;
  }
  await page.locator('input[type=file]').setInputFiles([atZ(low, -30), atZ(high, 30)]);
  await expect(page.locator('.object-row')).toHaveCount(2);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Projection', exact: true }).selectOption('orthographic');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  const canvas = page.locator('canvas');
  const floor = page.getByRole('button', { name: 'Floor', exact: true });
  await page.locator('.object-row').filter({ hasText: 'High.stl' }).locator('.object-select').click();
  await page.keyboard.press('NumpadDecimal');
  let on = await canvas.screenshot();
  await floor.click();
  expect(Buffer.compare(on, await canvas.screenshot())).toBe(0); // Floor at Z=-30 is outside this close-up.
  await floor.click();
  await page.getByRole('button', { name: 'Isolate selection', exact: true }).click();
  on = await canvas.screenshot();
  await floor.click();
  expect(Buffer.compare(on, await canvas.screenshot())).toBe(0);
  await floor.click();
  await page.locator('.object-row').filter({ hasText: 'Low.stl' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.object-row')).toHaveCount(1);
  // Removing the lowest part moves the floor to the new base at Z=30.
  on = await canvas.screenshot();
  await floor.click();
  expect(Buffer.compare(on, await canvas.screenshot())).not.toBe(0);
});
