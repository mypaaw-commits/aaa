import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function viewPixels(page: import('@playwright/test').Page) {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 160 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) red++;
    }
    bitmap.close(); return { red };
  }, [...png]);
}

test('A fitted socket stays unchanged after finding connections and only highlights requested intersections', async ({ page }, testInfo) => {
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
  await expect.poll(async () => (await viewPixels(page)).red).toBeGreaterThan(50);
  await page.screenshot({ path: testInfo.outputPath('fitted-intersection.png') });
  await intersections.uncheck();
  await expect.poll(async () => (await viewPixels(page)).red).toBeLessThan(5);
  expect(Buffer.compare(image, await page.locator('canvas').screenshot())).toBe(0);
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  expect(contactRequests).toEqual([]);
  expect(errors).toEqual([]);
});
