import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function contactPixels(page: import('@playwright/test').Page) {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let white = 0, darkBorder = 0, red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 215 && pixels[i + 1] > 215 && pixels[i + 2] > 215) white++;
      if (pixels[i] < 60 && pixels[i + 1] < 60 && pixels[i + 2] < 60) darkBorder++;
      if (pixels[i] > 160 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) red++;
    }
    bitmap.close(); return { white, darkBorder, red };
  }, [...png]);
}

test('A curved fitted socket shows contact with a contrast border and an independent red overlap layer', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(['socket.stl', 'key.stl'].map(name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  await expect(page.locator('.object-row')).toHaveCount(2);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  await page.getByRole('button', { name: 'Transparency', exact: true }).click();
  const before = await contactPixels(page);
  const response = page.waitForResponse(response => response.url().endsWith('/contact') && response.status() === 200);
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await response;
  const contacts = page.getByRole('checkbox', { name: 'Show contact areas', exact: true });
  await expect(contacts).toBeChecked();
  await expect.poll(async () => (await contactPixels(page)).white).toBeGreaterThan(before.white + 300);
  await expect.poll(async () => (await contactPixels(page)).darkBorder).toBeGreaterThan(before.darkBorder + 100);
  await page.screenshot({ path: testInfo.outputPath('fitted-contact.png') });
  await contacts.uncheck();
  await expect.poll(async () => (await contactPixels(page)).white).toBeLessThan(before.white + 20);
  await page.getByRole('button', { name: 'Check intersections', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).toBeChecked();
  await expect(contacts).not.toBeChecked();
  await expect.poll(async () => (await contactPixels(page)).red).toBeGreaterThan(50);
  await contacts.check();
  await expect.poll(async () => (await contactPixels(page)).white).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath('fitted-contact-and-intersection.png') });
  await expect(page.locator('.review-row input:checked')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.getByRole('checkbox', { name: 'Pokaż powierzchnie styku', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});
