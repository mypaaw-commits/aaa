import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { stlBox } from './fixtures';

async function viewPixels(page: import('@playwright/test').Page) {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, teal = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 160 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) red++;
      if (pixels[i + 1] > 130 && pixels[i + 1] > pixels[i] * 1.5 && pixels[i + 2] > 90) teal++;
    }
    bitmap.close(); return { red, teal };
  }, [...png]);
}

test('A Boolean socket is teal within tolerance, never red, and remains manually reviewed', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(['socket.stl', 'key.stl'].map(name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  await expect(page.locator('.object-row')).toHaveCount(2);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  await page.getByRole('button', { name: 'Transparency', exact: true }).click();
  const contactRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/contact')) contactRequests.push(request.url()); });
  const image = await page.locator('canvas').screenshot();
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('Connections updated');
  expect(Buffer.compare(image, await page.locator('canvas').screenshot())).toBe(0);
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  const intersections = page.getByRole('checkbox', { name: 'Show intersections', exact: true });
  await expect(intersections).toBeChecked();
  await expect(page.locator('.analysis-heading')).toHaveText('0 intersection pairs · 1 within tolerance');
  await expect(page.locator('.fit-margin')).toHaveText('Fit margin: 0.001 mm');
  await expect.poll(async () => (await viewPixels(page)).teal).toBeGreaterThan(50);
  expect((await viewPixels(page)).red).toBe(0);
  await expect(page.locator('.fit-legend')).toHaveText('Within tolerance');
  await page.screenshot({ path: testInfo.outputPath('fitted-tolerance.png') });
  await intersections.uncheck();
  await expect.poll(async () => (await viewPixels(page)).teal).toBe(0);
  expect(Buffer.compare(image, await page.locator('canvas').screenshot())).toBe(0);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await page.getByRole('button', { name: 'Within tolerance', exact: true }).click();
  await page.getByRole('button', { name: 'Intersections of key.stl', exact: true }).click();
  await expect(page.locator('#checks-panel .pair-status.withinTolerance')).toHaveText('Within tolerance');
  await page.getByRole('button', { name: 'Inspect pair: key.stl / socket.stl', exact: true }).click();
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  for (const swatch of await page.locator('.object-row[aria-selected=true] .part-swatch').all()) await expect(swatch).toHaveCSS('background-color', 'rgb(98, 140, 168)');
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-status.withinTolerance')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.locator('.review-status.withinTolerance')).toHaveText(['W marginesie dopasowania', 'W marginesie dopasowania']);
  await expect(page.locator('.fit-margin')).toHaveText('Margines dopasowania: 0,001 mm');
  await page.screenshot({ path: testInfo.outputPath('fitted-tolerance-pl.png') });
  expect(contactRequests).toEqual([]);
  expect(errors).toEqual([]);
});


test('Real intersections stay red alongside independent within-tolerance pairs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(['socket.stl', 'key.stl'].map(name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.locator('input[type=file]').setInputFiles([stlBox('C.stl', 20, 4), stlBox('D.stl', 23.5, 4)]);
  await expect(page.locator('.object-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair · 1 within tolerance');
  await expect.poll(async () => (await viewPixels(page)).teal).toBeGreaterThan(20);
  await expect.poll(async () => (await viewPixels(page)).red).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Intersections of C.stl', exact: true }).click();
  await expect(page.locator('#checks-panel .pair-status')).toHaveText('Intersection');
  await page.getByRole('button', { name: 'Inspect pair: C.stl / D.stl', exact: true }).click();
  await expect(page.locator('.fit-legend')).toHaveCount(0);
  await expect.poll(async () => (await viewPixels(page)).teal).toBe(0);
  await expect.poll(async () => (await viewPixels(page)).red).toBeGreaterThan(50);
  await page.getByRole('tab', { name: 'Part checklist', exact: true }).click();
  await expect(page.locator('.review-status.withinTolerance')).toHaveCount(2);
  await expect(page.locator('.review-status.intersectionCountOne')).toHaveCount(2);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
});
