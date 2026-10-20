import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { loadExample } from './fixtures';

// Tiny floating-point changes at a grid's horizon can affect a few antialiased pixels.
async function changedPixels(page: import('@playwright/test').Page, a: Buffer, b: Buffer) {
  return page.evaluate(async ({ a, b }) => {
    const images = await Promise.all([a, b].map(bytes => createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))));
    const canvas = new OffscreenCanvas(images[0].width, images[0].height);
    const context = canvas.getContext('2d')!;
    const pixels = images.map(image => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); return context.getImageData(0, 0, canvas.width, canvas.height).data; });
    let changed = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
      if ([0, 1, 2].some(c => Math.abs(pixels[0][i + c] - pixels[1][i + c]) > 8)) changed++;
    }
    images.forEach(image => image.close());
    return changed / (canvas.width * canvas.height);
  }, { a: [...a], b: [...b] });
}

test('Six views and numpad shortcuts agree in both projections and preserve selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await loadExample(page);
  const canvas = page.locator('canvas');
  const projection = page.getByRole('combobox', { name: 'Projection', exact: true });
  const b = page.locator('.object-row').filter({ hasText: 'B.stl' });
  await b.locator('.object-select').click();
  await page.getByRole('button', { name: 'Isolate selection', exact: true }).click();
  const views = [['Front', 'Numpad1'], ['Back', 'Control+Numpad1'], ['Left', 'Control+Numpad3'],
    ['Right', 'Numpad3'], ['Top', 'Numpad7'], ['Bottom', 'Control+Numpad7']];
  for (const mode of ['perspective', 'orthographic']) {
    await projection.selectOption(mode);
    // Leave the select so camera shortcuts can operate without changing form inputs.
    await projection.blur();
    for (const [view, shortcut] of views) {
      const button = page.getByRole('button', { name: view, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const preset = await canvas.screenshot();
      await page.getByRole('button', { name: 'Interactive 3D view', exact: true }).click();
      expect(Buffer.compare(preset, await canvas.screenshot())).not.toBe(0);
      await page.keyboard.press(shortcut);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(await changedPixels(page, preset, await canvas.screenshot()), `${mode} ${view}`).toBeLessThan(.001);
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
      const bounds = (await canvas.boundingBox())!;
      await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      await expect(b).toHaveAttribute('aria-selected', 'true');
    }
  }
  await page.keyboard.press('Numpad5');
  await expect(projection).toHaveValue('perspective');
  await page.keyboard.press('Numpad5');
  await expect(projection).toHaveValue('orthographic');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  for (const shortcut of ['Numpad4', 'Numpad8', 'Numpad6', 'Numpad2']) {
    const before = await canvas.screenshot();
    await page.keyboard.press(shortcut);
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  }
  await expect(page.locator('.camera-views button[aria-pressed=true]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Frame all visible', exact: true }).click();
  const beforeZoom = await canvas.screenshot();
  await canvas.hover();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  expect(Buffer.compare(beforeZoom, await canvas.screenshot())).not.toBe(0);
  await page.keyboard.press('NumpadDecimal');
  await expect(b).toHaveAttribute('aria-selected', 'true');
  expect(await changedPixels(page, beforeZoom, await canvas.screenshot())).toBeLessThan(.001);
  expect(errors).toEqual([]);
});

test('Lighting presets change shading without changing selection, framing or result overlays', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(['socket.stl', 'key.stl'].map(name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  await expect(page.locator('.object-row')).toHaveCount(2);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await page.locator('.object-select').first().click();
  const canvas = page.locator('canvas');
  const lighting = page.getByRole('combobox', { name: 'Lighting', exact: true });
  await expect(lighting).toHaveValue('soft');
  const soft = await canvas.screenshot();
  await page.screenshot({ path: testInfo.outputPath('viewport-soft.png') });
  for (const preset of ['studio', 'surface', 'flat']) {
    await lighting.selectOption(preset);
    expect(Buffer.compare(soft, await canvas.screenshot())).not.toBe(0);
    await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`viewport-${preset}.png`) });
  }
  await lighting.selectOption('soft');
  expect(Buffer.compare(soft, await canvas.screenshot())).toBe(0);
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('0 intersection pairs · 1 within tolerance');
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Transparency', exact: true }).click();
  // With overlays visible, returning to the same light restores exactly the same image.
  await expect(page.locator('.fit-legend')).toBeVisible();
  await page.waitForTimeout(250);
  const fittedSoft = await canvas.screenshot();
  await lighting.selectOption('surface');
  expect(Buffer.compare(fittedSoft, await canvas.screenshot())).not.toBe(0);
  await lighting.selectOption('soft');
  expect(Buffer.compare(fittedSoft, await canvas.screenshot())).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('viewport-fit.png') });
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.getByRole('combobox', { name: 'Oświetlenie', exact: true })).toHaveValue('soft');
  await expect(page.getByRole('button', { name: 'Tył', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 780 });
  for (const button of await page.locator('.camera-views button').all()) await expect(button).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Oświetlenie', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('viewport-compact-pl.png') });
  expect(errors).toEqual([]);
});

test('Numpad camera controls do not interfere with search and notes', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  const a = page.locator('.object-row').filter({ hasText: 'A.stl' });
  await a.locator('.object-select').click();
  await page.keyboard.press('Numpad1');
  await expect(a).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Front', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('End');
  await expect(page.locator('.object-row').filter({ hasText: 'C.stl' })).toHaveAttribute('aria-selected', 'true');
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  await page.getByRole('button', { name: 'Search objects', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search objects', exact: true });
  await search.fill('35');
  await search.focus();
  await page.keyboard.press('Numpad3');
  await page.keyboard.press('Numpad5');
  await expect(search).toHaveValue('35');
  await expect(page.getByRole('combobox', { name: 'Projection', exact: true })).toHaveValue('perspective');
  expect(Buffer.compare(before, await canvas.screenshot())).toBe(0);
  await page.getByRole('button', { name: 'Search objects', exact: true }).click();
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  await page.getByRole('checkbox', { name: 'Show intersections', exact: true }).uncheck();
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await page.getByRole('button', { name: 'Notes: B.stl', exact: true }).click();
  const notes = page.getByRole('textbox', { name: 'Notes: B.stl', exact: true });
  const beforeNotes = await canvas.screenshot();
  await notes.focus();
  await notes.fill('7');
  await page.keyboard.press('Numpad7');
  await expect(notes).toHaveValue('7');
  await expect(page.getByRole('button', { name: 'Front', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await changedPixels(page, beforeNotes, await canvas.screenshot())).toBe(0);
});
