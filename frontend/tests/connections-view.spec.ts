import { expect, test } from '@playwright/test';
import { loadExample, stlBox } from './fixtures';

async function whitePixels(page: import('@playwright/test').Page) {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 215 && pixels[i + 1] > 215 && pixels[i + 2] > 215) count++;
    bitmap.close();
    return count;
  }, [...png]);
}

test('Connections expand per object, keep selection, and distinguish review icons', async ({ page }, testInfo) => {
  await page.goto('/');
  await loadExample(page);
  await page.locator('input[type=file]').setInputFiles([stlBox('D.stl', 30)]);
  await expect(page.locator('.object-row')).toHaveCount(4);
  await page.locator('.object-select').first().click();
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('Connections updated');
  await expect(page.locator('.connection-group-toggle')).toHaveCount(4);
  const a = page.getByRole('button', { name: 'Connections of A.stl', exact: true });
  const b = page.getByRole('button', { name: 'Connections of B.stl', exact: true });
  await a.click();
  await expect(page.locator('#relations-panel .result-pair')).toHaveCount(1);
  await b.click();
  await expect(a).toHaveAttribute('aria-expanded', 'false');
  await expect(b).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#relations-panel .pair-files > span:first-child')).toHaveText(['A.stl', 'C.stl']);
  await expect(page.locator('#relations-panel .pair-symbol.connection svg')).toHaveClass(/lucide-link/);
  await expect(page.locator('#relations-panel .pair-symbol.intersection svg')).toHaveClass(/lucide-scan-line/);
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('connections-grouped.png') });
  await b.press('Enter');
  await expect(b).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Connections of D.stl', exact: true }).click();
  await expect(page.locator('.connection-children:visible')).toHaveText('No connections found');
  const broken = stlBox('open.stl', 0);
  broken.buffer = Buffer.from(broken.buffer.toString().replace(/facet normal[^]*?endfacet\n/, ''));
  await page.locator('input[type=file]').setInputFiles([broken]);
  await expect(page.locator('.object-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('Connections updated');
  await page.getByRole('button', { name: 'Connections of open.stl', exact: true }).click();
  await expect(page.locator('#relations-panel .pair-status.uncertain')).toContainText(['Needs review']);
  await expect(page.locator('#relations-panel .pair-symbol.uncertain svg').first()).toHaveClass(/lucide-triangle-alert/);
});

test('Perspective and orthographic both support framing, picking, zoom and resize', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await loadExample(page);
  const projection = page.getByRole('combobox', { name: 'Projection', exact: true });
  const canvas = page.locator('canvas');
  const b = page.locator('.object-row').filter({ hasText: 'B.stl' });
  await b.locator('.object-select').click();
  await page.getByRole('button', { name: 'Isolate selection', exact: true }).click();
  await page.waitForTimeout(250);
  const perspective = await canvas.screenshot();
  await projection.selectOption('orthographic');
  expect(Buffer.compare(perspective, await canvas.screenshot())).not.toBe(0);
  for (const mode of ['orthographic', 'perspective', 'orthographic']) {
    await projection.selectOption(mode);
    await page.getByRole('button', { name: 'Frame all visible', exact: true }).click();
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    const bounds = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await expect(b).toHaveAttribute('aria-selected', 'true');
    const before = await canvas.screenshot();
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(250);
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  }
  const controlBounds = (await canvas.boundingBox())!;
  let previous = await canvas.screenshot();
  const x = controlBounds.x + controlBounds.width / 2, y = controlBounds.y + controlBounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 40, y + 20, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);
  expect(Buffer.compare(previous, await canvas.screenshot())).not.toBe(0);
  previous = await canvas.screenshot();
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 70, y + 40, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  expect(Buffer.compare(previous, await canvas.screenshot())).not.toBe(0);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.getByRole('button', { name: 'Frame all visible', exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  const resized = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: resized.width / 2, y: resized.height / 2 } });
  await expect(b).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('orthographic.png') });
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('pl');
  await expect(page.getByRole('combobox', { name: 'Projekcja', exact: true })).toHaveValue('orthographic');
  expect(errors).toEqual([]);
});

test('Exact contact patches render white and follow object visibility', async ({ page }, testInfo) => {
  await page.goto('/');
  await loadExample(page);
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
  const before = await whitePixels(page);
  const surface = page.waitForResponse(response => response.url().endsWith('/contact') && response.status() === 200);
  await page.getByRole('button', { name: 'Find connections', exact: true }).click();
  await surface;
  await expect(page.locator('.contact-legend')).toHaveText('Contact area · 70%');
  await expect.poll(() => whitePixels(page)).toBeGreaterThan(before + 100);
  await page.screenshot({ path: testInfo.outputPath('contact-area.png') });
  await page.getByTitle('Hide A.stl', { exact: true }).click();
  await expect(page.locator('.contact-legend')).toHaveCount(0);
  await expect.poll(() => whitePixels(page)).toBeLessThan(before + 50);
  await expect(page.locator('.review-row input[type=checkbox]')).toHaveCount(0);
});
