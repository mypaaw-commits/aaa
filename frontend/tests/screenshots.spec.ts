import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadExample } from './fixtures';

test('Camera saves the current 3D image as PNG by default, JPEG or WebP, with real pixels and no UI', async ({ page }, testInfo) => {
  await page.goto('/');
  const camera = page.getByRole('button', { name: 'Save screenshot', exact: true });
  await expect(camera).toBeDisabled();
  await loadExample(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
  await page.getByRole('button', { name: 'Intersections of B.stl', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect pair: B.stl / C.stl', exact: true }).click();
  await page.getByRole('button', { name: 'Transparency', exact: true }).click();
  const format = page.getByRole('combobox', { name: 'Image format', exact: true });
  await expect(format).toHaveValue('png');
  const dimensions = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
  for (const kind of ['png', 'jpeg', 'webp']) {
    await format.selectOption(kind);
    const downloaded = page.waitForEvent('download');
    await camera.click();
    const download = await downloaded;
    const extension = kind === 'jpeg' ? 'jpg' : kind;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^modelcheck-view-.*\\.${extension}$`));
    const path = testInfo.outputPath(`viewport.${extension}`);
    await download.saveAs(path);
    const bytes = readFileSync(path);
    if (kind === 'png') expect([...bytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
    if (kind === 'jpeg') expect([...bytes.subarray(0, 3)]).toEqual([255,216,255]);
    if (kind === 'webp') { expect(bytes.toString('ascii',0,4)).toBe('RIFF'); expect(bytes.toString('ascii',8,12)).toBe('WEBP'); }
    const image = await page.evaluate(async ({ bytes, kind }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: `image/${kind}` }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0, blue = 0;
      for (let i=0; i<pixels.length; i+=4) {
        if (pixels[i]>160 && pixels[i]>pixels[i+1]*1.5 && pixels[i]>pixels[i+2]*1.5) red++;
        if (pixels[i+2]>pixels[i]*1.3 && pixels[i+2]>pixels[i+1]*1.1) blue++;
      }
      bitmap.close(); return { width: canvas.width, height: canvas.height, red, blue };
    }, { bytes: [...bytes], kind });
    expect({ width: image.width, height: image.height }).toEqual(dimensions);
    expect(image.red).toBeGreaterThan(50);
    expect(image.blue).toBeGreaterThan(50);
  }
  await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Transparency', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Show intersections', exact: true })).toBeChecked();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await format.selectOption('png');
  await page.getByRole('combobox', { name: 'Projection', exact: true }).selectOption('orthographic');
  await page.getByRole('button', { name: 'Left', exact: true }).click();
  const changed = page.waitForEvent('download');
  await camera.click();
  const changedImage = await changed;
  const changedPath = testInfo.outputPath('orthographic-left.png');
  await changedImage.saveAs(changedPath);
  expect(Buffer.compare(readFileSync(testInfo.outputPath('viewport.png')), readFileSync(changedPath))).not.toBe(0);
});

test('Screenshot waits for the overlay instead of downloading an incomplete frame', async ({ page }) => {
  await page.goto('/');
  await loadExample(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let overlays = 0;
  await page.route('**/relations/*/intersection', async route => { overlays++; await gate; await route.continue(); });
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  try {
    await page.getByRole('button', { name: 'Analyze', exact: true }).click();
    await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
    await expect.poll(() => overlays).toBe(1);
    const camera = page.getByRole('button', { name: 'Save screenshot', exact: true });
    await camera.click();
    await expect(camera).toBeDisabled();
    expect(downloads).toHaveLength(0);
    const pending = page.waitForEvent('download');
    release();
    await pending;
    await expect(camera).toBeEnabled();
    expect(downloads).toHaveLength(1);
  } finally { release(); }
});
