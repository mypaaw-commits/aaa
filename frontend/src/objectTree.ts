import type { Folder, Part } from './types';
export function folderDescendants(folders: Folder[], id: string) {
  const ids=new Set([id]);
  for(let changed=true;changed;){changed=false;for(const folder of folders)if(folder.parent_id&&ids.has(folder.parent_id)&&!ids.has(folder.id)){ids.add(folder.id);changed=true;}}
  return ids;
}
export type TreeRow={kind:'folder';folder:Folder;depth:number}|{kind:'part';part:Part;depth:number};
export function objectTree(parts:Part[],folders:Folder[],collapsed:Set<string>,searching:boolean):TreeRow[]{
 const output:TreeRow[]=[];
 const visited=new Set<string>();
 function walk(parent:string|null,depth:number){
  for(const folder of folders.filter(f=>f.parent_id===parent)){
   if(visited.has(folder.id))continue;visited.add(folder.id);
   output.push({kind:'folder',folder,depth});
   if(searching||!collapsed.has(folder.id))walk(folder.id,depth+1);
  }
  for(const part of parts.filter(p=>(p.folder_id??null)===parent))output.push({kind:'part',part,depth});
 }
 walk(null,0);return output;
}
export function folderPath(folders:Folder[],id:string|null|undefined){
 const names:string[]=[];const visited=new Set<string>();
 while(id&&!visited.has(id)){visited.add(id);const folder=folders.find(f=>f.id===id);if(!folder)break;names.unshift(folder.name);id=folder.parent_id;}
 return names.join(' / ');
}
