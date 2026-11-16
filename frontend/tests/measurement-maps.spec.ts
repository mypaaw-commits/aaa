import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadExample, stlBox } from './fixtures';

async function colours(page:Page){
 const png=await page.locator('canvas').screenshot({mask:[page.locator('.rainbow-legend'),page.locator('.viewport-legend')],maskColor:'#777777'});
 return page.evaluate(async bytes=>{
  const image=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
  const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;let red=0,teal=0,blue=0,white=0;
  for(let i=0;i<rgba.length;i+=4){const r=rgba[i],g=rgba[i+1],b=rgba[i+2];if(r>150&&r>g*1.7&&r>b*1.7)red++;if(g>120&&g>r*1.5&&b>90&&g>b)teal++;if(b>130&&b>r*1.3&&b>g*1.1)blue++;if(r>235&&g>235&&b>235&&Math.max(r,g,b)-Math.min(r,g,b)<8)white++;}
  image.close();return{red,teal,blue,white};
 },[...png]);
}
const input=(page:Page)=>page.locator('input[type=file]:not([webkitdirectory])');

test('Shift-eye toggles all parts and visible-only analysis checks precisely the visible scope',async({page})=>{
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
 expect((await post).postDataJSON()).toMatchObject({check:'INTERSECTIONS'});expect((await post).postDataJSON().part_ids).toHaveLength(2);
 await expect(page.locator('.analysis-heading')).toHaveText('0 intersection pairs');
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();await expect(page.locator('.review-row')).toHaveCount(3);
});

test('Boolean contact is a substantial turquoise surface and remains cached through camera and visibility changes',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 await input(page).setInputFiles(['socket.stl','key.stl'].map(name=>fileURLToPath(new URL(`./fixtures/${name}`,import.meta.url))));
 await expect(page.locator('.object-row')).toHaveCount(2);await expect(page.locator('.geometry-loading')).toHaveCount(0);
 let maps=0,posts=0;page.on('request',r=>{if(r.url().endsWith('/contact-map'))maps++;if(r.method()==='POST'&&r.url().endsWith('/analysis'))posts++;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();await expect(page.getByRole('button',{name:'Analyze',exact:true})).toBeEnabled();
 await expect.poll(async()=>(await colours(page)).teal).toBeGreaterThan(1000);
 expect((await colours(page)).red).toBe(0);expect(maps).toBe(1);
 await page.screenshot({path:testInfo.outputPath('contact-turquoise.png')});
 for(let i=0;i<5;i++)await page.keyboard.press('Numpad6');
 await page.getByRole('button',{name:'Hide key.stl',exact:true}).click();await page.getByRole('button',{name:'Show key.stl',exact:true}).click();
 await page.getByRole('checkbox',{name:'Show intersections',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Show intersections',exact:true}).check();
 await page.locator('canvas').screenshot();expect(maps).toBe(1);expect(posts).toBe(1);await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Intersections always show turquoise-to-red measurements over neutral parts with no Display selector',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();await input(page).setInputFiles([stlBox('A.stl',0),stlBox('B.stl',1.8)]);
 await expect(page.locator('.object-row')).toHaveCount(2);await expect(page.locator('.geometry-loading')).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Display',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Analyze',exact:true}).click();await expect(page.locator('.analysis-heading')).toHaveText('1 intersection pair');
 await expect.poll(async()=>(await colours(page)).red).toBeGreaterThan(100);
 await expect.poll(async()=>(await colours(page)).teal).toBeGreaterThan(100);
 await page.getByRole('button',{name:'Part results: A.stl',exact:true}).click();await page.getByRole('button',{name:'Inspect pair: A.stl / B.stl',exact:true}).click();
 expect((await colours(page)).blue).toBe(0);
 await page.screenshot({path:testInfo.outputPath('intersection-depth.png')});
});

test('Thickness is independent, reports mm extrema and shortfall, and supports colours and framing without recalculation',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();
 const thin=stlBox('wall.stl',0);thin.buffer=Buffer.from(thin.buffer.toString().replace(/vertex (\S+) (\S+) (\S+)/g,(_,x,y,z)=>`vertex ${x} ${y} ${Number(z)*.2}`));
 await input(page).setInputFiles([thin]);await expect(page.locator('.object-row')).toHaveCount(1);await expect(page.locator('.geometry-loading')).toHaveCount(0);
 await page.getByRole('button',{name:'Wall thickness analysis',exact:true}).click();await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).fill('2');
 let posts=0,maps=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analysis')){posts++;expect(r.postDataJSON().check).toBe('THICKNESS');}if(r.url().endsWith('/thickness'))maps++;});
 await page.getByRole('button',{name:'Measure wall thickness',exact:true}).click();
 await expect(page.locator('.thickness-card .minimum')).toContainText('0.4 mm');await expect(page.locator('.thickness-card .maximum')).toContainText('2 mm');
 await expect(page.locator('.thickness-card dl')).toContainText('1.6 mm');await expect(page.locator('#thickness-panel')).not.toContainText('faces below');
 await expect.poll(async()=>(await colours(page)).red).toBeGreaterThan(100);await expect.poll(async()=>(await colours(page)).white).toBeGreaterThan(100);
 await page.screenshot({path:testInfo.outputPath('wall-dimensions.png')});
 const canvas=page.locator('canvas'),before=await canvas.screenshot();await page.getByTitle('Frame thinnest location',{exact:true}).click();expect(Buffer.compare(before,await canvas.screenshot())).not.toBe(0);
 await page.getByTitle('Frame thickest location',{exact:true}).click();await expect(page.locator('.object-row[aria-selected=true]')).toHaveCount(1);
 await page.getByRole('checkbox',{name:'Show thickness colours',exact:true}).uncheck();await expect.poll(async()=>(await colours(page)).red).toBe(0);
 await page.getByRole('checkbox',{name:'Show thickness colours',exact:true}).check();
 await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).fill('0.2');await page.getByRole('spinbutton',{name:'Minimum thickness',exact:true}).blur();
 await expect(page.locator('.thickness-card dl')).toContainText('0 mm');await expect.poll(async()=>(await colours(page)).red).toBe(0);
 expect(posts).toBe(1);expect(maps).toBe(1);
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();await expect(page.locator('.review-row')).toHaveCount(1);await expect(page.locator('.review-object')).toContainText('Wall thickness');
 await page.getByRole('button',{name:'Intersection analysis',exact:true}).click();await expect(page.getByRole('button',{name:'Analyze',exact:true})).toBeDisabled();await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Many-part result maps are downloaded once and are reused during orbit and eye changes',async({page})=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled();await input(page).setInputFiles(Array.from({length:16},(_,i)=>stlBox(`part-${i+1}.stl`,i*1.5)));
 await expect(page.locator('.object-row')).toHaveCount(16);await expect(page.locator('.geometry-loading')).toHaveCount(0);
 let finished=0,posts=0;page.on('requestfinished',r=>{if(r.url().endsWith('/fit-map'))finished++;});page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analysis'))posts++;});
 await page.getByRole('button',{name:'Analyze',exact:true}).click();await expect(page.locator('.analysis-heading')).toHaveText('15 intersection pairs',{timeout:15000});await expect.poll(()=>finished).toBe(15);
 for(let i=0;i<8;i++)await page.keyboard.press('Numpad6');await page.getByRole('button',{name:'Hide part-1.stl',exact:true}).click();await page.getByRole('button',{name:'Show part-1.stl',exact:true}).click();
 await page.getByRole('checkbox',{name:'Show intersections',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Show intersections',exact:true}).check();await page.locator('canvas').screenshot();expect(finished).toBe(15);expect(posts).toBe(1);
});

test('Importing a directory recreates folders, supports group eyes, moves, rename, nesting and recursive deletion',async({page},testInfo)=>{
 const directory=testInfo.outputPath('Assembly');mkdirSync(join(directory,'Head'),{recursive:true});
 writeFileSync(join(directory,'Head','top.stl'),stlBox('top.stl',0).buffer);writeFileSync(join(directory,'Head','pin.stl'),stlBox('pin.stl',2).buffer);writeFileSync(join(directory,'body.stl'),stlBox('body.stl',4).buffer);writeFileSync(join(directory,'notes.txt'),'Ignored');
 await page.goto('/');await expect(page.getByRole('button',{name:'Import folder',exact:true})).toBeEnabled();
 const upload=page.waitForRequest(r=>r.url().endsWith('/parts')&&r.method()==='POST');await page.locator('input[webkitdirectory]').setInputFiles(directory);const prefix=(await upload).url().replace(/\/parts$/,'');
 await expect(page.locator('.object-row')).toHaveCount(3);await expect(page.locator('.folder-row')).toHaveCount(2);
 await page.getByRole('button',{name:'Folder: Head',exact:true}).click();await expect(page.locator('.object-row')).toHaveCount(1);await expect(page.locator('.scene-label')).toContainText('3 / 3 visible');await page.getByRole('button',{name:'Folder: Head',exact:true}).click();
 await page.getByRole('button',{name:'Hide folder Assembly',exact:true}).click();await expect(page.locator('.scene-label')).toContainText('0 / 3 visible');await page.getByRole('button',{name:'Show folder Assembly',exact:true}).click();
 await page.getByRole('button',{name:'Scene',exact:true}).click();page.once('dialog',dialog=>dialog.accept('Checked'));await page.getByTitle('New folder',{exact:true}).click();await expect(page.getByRole('button',{name:'Folder: Checked',exact:true})).toBeVisible();
 await input(page).setInputFiles([stlBox('extra.stl',10)]);await expect(page.locator('.object-row')).toHaveCount(4);
 await page.locator('.object-row').filter({hasText:'top.stl'}).locator('.object-select').click();await page.locator('.object-row').filter({hasText:'pin.stl'}).locator('.object-select').click({modifiers:['Control']});
 await page.locator('.object-row').filter({hasText:'top.stl'}).click({button:'right'});await page.getByRole('combobox',{name:'Move to folder',exact:true}).selectOption({label:'Checked'});
 const folders=await(await page.request.get(prefix+'/folders')).json();const checked=folders.find((f:{name:string})=>f.name==='Checked');
 await expect.poll(async()=>{const parts=await(await page.request.get(prefix+'/parts')).json();return parts.filter((p:{folder_id:string})=>p.folder_id===checked.id).length;}).toBe(3);
 await page.getByRole('button',{name:'Folder options: Checked',exact:true}).click();page.once('dialog',dialog=>dialog.accept('Ready'));await page.getByRole('menuitem',{name:'Rename folder',exact:true}).click();await expect(page.getByRole('button',{name:'Folder: Ready',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Folder options: Ready',exact:true}).click();page.once('dialog',dialog=>dialog.accept('Details'));await page.getByRole('menuitem',{name:'New subfolder',exact:true}).click();await expect(page.getByRole('button',{name:'Folder: Details',exact:true})).toBeVisible();
 await page.locator('.object-row').filter({hasText:'top.stl'}).locator('.object-select').click();await page.locator('.object-row').filter({hasText:'top.stl'}).locator('.object-select').dragTo(page.getByRole('button',{name:'Folder: Details',exact:true}));
 await expect.poll(async()=>{const data=await(await page.request.get(prefix+'/parts')).json();const current=await(await page.request.get(prefix+'/folders')).json();return data.find((p:{name:string})=>p.name==='top.stl').folder_id===current.find((f:{name:string})=>f.name==='Details').id;}).toBe(true);
 await page.screenshot({path:testInfo.outputPath('object-folders.png')});
 await page.getByRole('button',{name:'Folder options: Ready',exact:true}).click();await page.getByRole('menuitem',{name:'Delete folder and contents',exact:true}).click();await expect(page.locator('.object-row')).toHaveCount(1);await expect(page.getByRole('button',{name:'Folder: Details',exact:true})).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Overall thickness extrema identify their parts and checklist confirmations remain separate',async({page},testInfo)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'Import STL',exact:true})).toBeEnabled({timeout:15000});
 const thin=stlBox('thin.stl',0);thin.buffer=Buffer.from(thin.buffer.toString().replace(/vertex (\S+) (\S+) (\S+)/g,(_,x,y,z)=>`vertex ${x} ${y} ${Number(z)*.2}`));
 await input(page).setInputFiles([thin,stlBox('thick.stl',10,3)]);await expect(page.locator('.object-row')).toHaveCount(2);
 await page.getByRole('button',{name:'Wall thickness analysis',exact:true}).click();await page.getByRole('button',{name:'Measure wall thickness',exact:true}).click();
 await expect(page.locator('.thickness-overall')).toContainText('0.4 mm');await expect(page.locator('.thickness-overall')).toContainText('3 mm');
 await expect(page.locator('.thickness-overall .thickness-extreme').first()).toContainText('thin.stl');await expect(page.locator('.thickness-overall .thickness-extreme').last()).toContainText('thick.stl');
 await page.screenshot({path:testInfo.outputPath('overall-thickness.png')});
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();await page.getByRole('checkbox',{name:'Reviewed: thin.stl · Wall thickness',exact:true}).check();await page.getByRole('checkbox',{name:'Reviewed: thick.stl · Wall thickness',exact:true}).check();
 await expect(page.locator('.review-count')).toHaveText('2 / 2 reviewed');
 await page.getByRole('button',{name:'Intersection analysis',exact:true}).click();await page.getByRole('button',{name:'Analyze',exact:true}).click();await expect(page.getByRole('button',{name:'Analyze',exact:true})).toBeEnabled();
 await page.getByRole('tab',{name:'Part checklist',exact:true}).click();await expect(page.locator('.review-row')).toHaveCount(4);await expect(page.locator('.review-row input:checked')).toHaveCount(2);await expect(page.locator('.review-count')).toHaveText('0 / 2 reviewed');
 await page.getByRole('checkbox',{name:'Reviewed: thin.stl',exact:true}).check();await expect(page.locator('.review-count')).toHaveText('1 / 2 reviewed');
});
