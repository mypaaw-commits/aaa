import { expect, type Page } from '@playwright/test';

export function stlBox(name: string, x: number, size = 2, y = 0) {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return { name, mimeType: 'model/stl', buffer: Buffer.from(`solid box\n${faces.map(face => `facet normal 0 0 0\nouter loop\n${face.map(i => `vertex ${v[i][0] * size + x} ${v[i][1] * size + y} ${v[i][2] * size}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid box`) };
}

export async function loadExample(page: Page) {
  await expect(page.getByRole('button', { name: 'Wczytaj STL', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles([stlBox('A.stl', -12, 8, -4), stlBox('B.stl', -4, 8, -4), stlBox('C.stl', 3.5, 8, -4)]);
  await expect(page.locator('.object-row')).toHaveCount(3);
  await expect(page.locator('.geometry-loading')).toHaveCount(0);
}
