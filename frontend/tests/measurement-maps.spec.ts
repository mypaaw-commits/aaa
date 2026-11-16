import { expect, test } from '@playwright/test';
import { loadExample, stlBox } from './fixtures';

async function colourCounts(page: import('@playwright/test').Page) {
 // Locator screenshots include DOM overlays above the canvas. Mask legends
 // so their rainbow cannot satisfy a measurement-map pixel assertion.
 const png = await page.locator('canvas').screenshot({mask:[page.locator('.rainbow-legend'),page.locator('.viewport-legend')],maskColor:'#777777'});
 return page.evaluate(async bytes => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bitmap.width,bitmap.height); const ctx=canvas.getContext('2d')!;
  ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let red=0,green=0,blue=0;
  for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
   if(r>130&&r>g*1.7&&r>b*1.5)red++;
   if(g>130&&g>r*1.5&&g>b*1.5)green++;
   if(b>130&&b>r*1.7&&b>g*1.5)blue++;
  }bitmap.close();return{red,green,blue};
 },[...png]);
}

test('Shift-eye toggles all parts and visible-only analysis uses the eye state explicitly',async({page})=>{
 await page.goto('/');await loadExample(page);
 await page.getByRole('button',{name:'Hide B.stl',exact:true}).click();
 await page.getByRole('button',{name:'Hide A.stl',exact:true}).click({modifiers:['Shift']});
 await expect(page.locator('.scene-label')).toContainText('3 / 3 visible');
 await page.getByRole('button',{name:'Hide A.stl',exact:true}).click({modifiers:['Shift']});
 await expect(page.locator('.scene-label')).toContainText('0 / 3 visible');
 await page.getByRole('button',{name:'Show A.stl',exact:true}).click({modifiers:['Shift']});
 await page.getByRole('button',{name:'Hide C.stl',exact:true}).click();
 await page.getByRole('combobox',{name:'Analysis scope',exact:true}).selectOption('visible');
 const post=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/analysis'));
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 expect((await post).postDataJSON().part_ids).toHaveLength(2);
 await expect(page.locator('.analysis-heading')).toHaveText('0 intersection pairs');
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();
 await expect(page.locator('.review-row')).toHaveCount(3);
});

test('Fit depth rainbow is measured once and orbit, visibility, transparency and filters reuse it',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles([stlBox('A.stl',0),stlBox('B.stl',1.9)]);
 await expect(page.locator('.object-row')).toHaveCount(2);
 await expect(page.locator('.geometry-loading')).toHaveCount(0);
 await page.getByRole('textbox',{name:'Fit margin (mm)',exact:true}).fill('0.05');
 await page.getByRole('combobox',{name:'Display',exact:true}).selectOption('fit');
 const analyses:string[]=[],maps:string[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analysis'))analyses.push(r.url());if(r.url().endsWith('/fit-map'))maps.push(r.url());});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.getByRole('button',{name:'Analyze',exact:true})).toBeEnabled();
 await expect.poll(()=>maps.length).toBe(1);
 await expect.poll(async()=>(await colourCounts(page)).red).toBeGreaterThan(5);
 await expect.poll(async()=>(await colourCounts(page)).blue).toBeGreaterThan(5);
 await expect.poll(async()=>(await colourCounts(page)).green).toBeGreaterThan(5);
 await expect(page.locator('.rainbow-legend')).toContainText('Fit depth map');
 await page.screenshot({path:testInfo.outputPath('fit-rainbow.png')});
 for(let i=0;i<4;i++)await page.keyboard.press('Numpad6');
 await page.getByRole('button',{name:'Transparency',exact:true}).click();
 await page.getByRole('button',{name:'Hide B.stl',exact:true}).click();
 await page.getByRole('button',{name:'Show B.stl',exact:true}).click();
 await page.getByRole('button',{name:'Intersections',exact:true}).click();
 await page.getByRole('button',{name:'Part results: A.stl',exact:true}).click();
 await page.getByRole('button',{name:'Inspect pair: A.stl / B.stl',exact:true}).click();
 expect(analyses).toHaveLength(1);expect(maps).toHaveLength(1);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Minimum thickness changes cached colour mapping and classification without another geometry analysis',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 const thin=stlBox('wall.stl',0);
 thin.buffer=Buffer.from(thin.buffer.toString().replace(/vertex (\S+) (\S+) (\S+)/g,(_,x,y,z)=>`vertex ${x} ${y} ${Number(z)*.2}`));
 await page.locator('input[type=file]').setInputFiles([thin]);
 await expect(page.locator('.object-row')).toHaveCount(1);
 await expect(page.locator('.geometry-loading')).toHaveCount(0);
 await page.getByRole('combobox',{name:'Display',exact:true}).selectOption('thickness');
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).fill('2');
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).blur();
 const analyses:string[]=[],maps:string[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analysis'))analyses.push(r.url());if(r.url().endsWith('/thickness'))maps.push(r.url());});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.getByRole('button',{name:'Analyze',exact:true})).toBeEnabled();
 await expect(page.locator('.thickness-result')).toContainText('0.4 mm');
 await expect.poll(async()=>(await colourCounts(page)).red).toBeGreaterThan(5);
 await page.screenshot({path:testInfo.outputPath('thickness-rainbow.png')});
 const opaque=await page.locator('canvas').screenshot();
 await page.getByRole('button',{name:'Transparency',exact:true}).click();
 expect(Buffer.compare(opaque,await page.locator('canvas').screenshot())).not.toBe(0);
 await page.getByRole('button',{name:'Transparency',exact:true}).click();
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).fill('0.2');
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).blur();
 await expect(page.locator('.thickness-result')).toContainText('0 faces below minimum');
 await expect.poll(async()=>(await colourCounts(page)).blue).toBeGreaterThan(5);
 await page.keyboard.press('Numpad4');
 await page.getByRole('button',{name:'Hide wall.stl',exact:true}).click();
 await page.getByRole('button',{name:'Show wall.stl',exact:true}).click();
 expect(analyses).toHaveLength(1);expect(maps).toHaveLength(1);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Many-part results are downloaded once and stay cached while orbiting and changing visibility', async ({page}) => {
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles(Array.from({length:16},(_,i)=>stlBox(`part-${i+1}.stl`,i*1.5)));
 await expect(page.locator('.object-row')).toHaveCount(16);
 await expect(page.locator('.geometry-loading')).toHaveCount(0);
 const analyses:string[]=[],overlays:string[]=[];
 let finished=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analysis'))analyses.push(r.url());if(r.url().endsWith('/intersection'))overlays.push(r.url());});
 page.on('requestfinished',r=>{if(r.url().endsWith('/intersection'))finished++;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.analysis-heading')).toHaveText('15 intersection pairs');
 await expect.poll(()=>overlays.length).toBe(15);
 await expect.poll(()=>finished).toBe(15);
 await page.locator('canvas').screenshot();
 for(let i=0;i<8;i++)await page.keyboard.press('Numpad6');
 await page.getByRole('button',{name:'Hide part-1.stl',exact:true}).click();
 await page.getByRole('button',{name:'Show part-1.stl',exact:true}).click();
 await page.getByLabel('Show intersections',{exact:true}).uncheck();
 await page.getByLabel('Show intersections',{exact:true}).check();
 await page.locator('canvas').screenshot();
 expect(analyses).toHaveLength(1);expect(overlays).toHaveLength(15);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('A manual review made after changing the thickness threshold waits for the new classification', async ({page}) => {
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles([stlBox('wall.stl',0)]);
 await expect(page.locator('.object-row')).toHaveCount(1);
 await page.getByRole('combobox',{name:'Display',exact:true}).selectOption('thickness');
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.thickness-result')).toBeVisible();
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/sessions/*/thickness-settings',async route=>{await gate;await route.continue();});
 let reviewWrites=0;
 page.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/tasks/'))reviewWrites++;});
 const settings=page.waitForRequest('**/api/sessions/*/thickness-settings');
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).fill('3');
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).blur();
 const settingsRequest=await settings;
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();
 const reviewed=page.getByRole('checkbox',{name:'Reviewed: wall.stl',exact:true});
 await reviewed.check();
 expect(reviewWrites).toBe(0);
 const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/tasks/'));
 release();await saved;
 await expect.poll(()=>reviewWrites).toBe(1);
 await expect(reviewed).toBeChecked();
 await expect(page.locator('.wall-badge')).toContainText('12 faces below minimum');
 const current=await(await page.request.get(settingsRequest.url().replace('/thickness-settings','/analysis'))).json();
 expect(current.tasks[0].done).toBe(true);
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Changing the fit margin updates a cached solid overlay from teal to red without downloading it again',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 await page.locator('input[type=file]').setInputFiles([stlBox('A.stl',0),stlBox('B.stl',1.9995)]);
 await expect(page.locator('.object-row')).toHaveCount(2);
 await expect(page.locator('.geometry-loading')).toHaveCount(0);
 let downloads=0;
 page.on('requestfinished',r=>{if(r.url().endsWith('/intersection'))downloads++;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.analysis-heading')).toContainText('1 within tolerance');
 await expect.poll(()=>downloads).toBe(1);
 await expect.poll(async()=>(await colourCounts(page)).red).toBe(0);
 await page.getByRole('textbox',{name:'Fit margin (mm)',exact:true}).fill('0');
 await page.getByRole('button',{name:'Analyze',exact:true}).click();
 await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
 await expect.poll(async()=>(await colourCounts(page)).red).toBeGreaterThan(100);
 expect(downloads).toBe(1);
});
