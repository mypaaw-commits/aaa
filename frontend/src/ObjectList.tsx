import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Eye, EyeOff, Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { objectTree, folderDescendants } from './objectTree';
import type { ObjectMenuState } from './ObjectMenu';
import { partColor } from './types';
import { useI18n } from './i18n';
import type { Part, Folder } from './types';

type Props = {
  inventory:Part[]; onRenameFolder:(id:string)=>void; onDeleteFolder:(id:string)=>void; onFileDrop:(files:File[],target:string)=>void;
  folders: Folder[]; searching: boolean; activeFolder: string | null;
  onActiveFolder: (id: string | null) => void; onMoveParts: (ids: string[], folder: string | null) => void;
  onMoveFolder: (id: string, parent: string | null) => void; onFolderVisibility: (ids: string[]) => void;
  parts: Part[]; selected: string[]; isolated: string[] | null;
  onChange: (ids: string[]) => void; onVisibility: (part: Part, all?: boolean) => void;
  onMenu: (menu: ObjectMenuState) => void; nameSuffix: (part: Part) => string;
  onDelete: (ids: string[]) => void;
  onReorder: (id: string, target: string, before: boolean) => void;
};
type Drag = { x: number; y: number; startX: number; startY: number; clientX: number; clientY: number; base: string[]; ctrl: boolean; shift: boolean; moved: boolean };

export function ObjectList({ parts: allParts, inventory, onRenameFolder, onDeleteFolder, onFileDrop, folders, searching, activeFolder, onActiveFolder, onMoveParts, onMoveFolder, onFolderVisibility, selected, isolated, onChange, onVisibility, onMenu, nameSuffix, onReorder, onDelete }: Props) {
  const { t } = useI18n();
  const [collapsed,setCollapsed]=useState(new Set<string>());
  const knownFolders=useRef(new Set<string>());
  useEffect(()=>{const created=folders.filter(folder=>!knownFolders.current.has(folder.id));knownFolders.current=new Set(folders.map(folder=>folder.id));if(created.length)setCollapsed(previous=>{const next=new Set(previous);for(const folder of created){let parent=folder.parent_id;while(parent){next.delete(parent);parent=folders.find(item=>item.id===parent)?.parent_id??null;}}return next.size===previous.size?previous:next;});},[folders]);
  const entries=objectTree(allParts,folders,collapsed,searching);
  const parts=entries.flatMap(row=>row.kind==='part'?[row.part]:[]);
  const list = useRef<HTMLDivElement>(null);
  const dropItem=(event: import('react').DragEvent, target:string|null)=>{
    const folder=event.dataTransfer.getData('application/x-modelcheck-folder');
    const ids=event.dataTransfer.getData('application/x-modelcheck-parts');
    if(!folder&&!ids)return;
    event.preventDefault();event.stopPropagation();
    if(folder)onMoveFolder(folder,target);else onMoveParts(JSON.parse(ids),target);
    moving.current=null;setDrop(null);
  };
  const anchor = useRef<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean } | null>(null);
  const moving = useRef<string | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const latest = useRef({ selected, onChange }); latest.current = { selected, onChange };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function change(ids: string[]) {
    if (ids.length !== latest.current.selected.length || ids.some(id => !latest.current.selected.includes(id))) latest.current.onChange(ids);
  }
  function choose(id: string, ctrl: boolean, shift: boolean) {
    const first = parts.findIndex(part => part.id === anchor.current);
    const last = parts.findIndex(part => part.id === id);
    if (shift && first >= 0) {
      const range = parts.slice(Math.min(first, last), Math.max(first, last) + 1).map(part => part.id);
      change(ctrl ? [...new Set([...selected, ...range])] : range);
    } else {
      change(ctrl ? selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id] : [id]);
      anchor.current = id;
    }
    setFocused(id);
  }
  function focusRow(id: string) {
    const row = [...list.current!.querySelectorAll<HTMLElement>('.object-row')].find(element => element.dataset.id === id);
    row?.querySelector<HTMLButtonElement>('.object-select')?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('.visibility-button')) return;
    if (!(event.target as HTMLElement).closest('.folder-row') && event.key === 'Delete' && event.code !== 'NumpadDecimal' && !event.ctrlKey && !event.altKey && !event.metaKey && selected.length) {
      event.preventDefault(); onDelete(selected); return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    const folderRow=(event.target as HTMLElement).closest<HTMLElement>('.folder-row');
    if(folderRow){
      const id=folderRow.dataset.folderId!;
      if(event.key==='F2'){event.preventDefault();onRenameFolder(id);return;}
      if(event.key==='Delete'){event.preventDefault();onDeleteFolder(id);return;}
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setCollapsed(previous=>{const next=new Set(previous);if(event.key==='ArrowLeft')next.add(id);else next.delete(id);return next;});return;}
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();const buttons=[...list.current!.querySelectorAll<HTMLButtonElement>('.folder-toggle,.object-select')];const current=buttons.indexOf(folderRow.querySelector<HTMLButtonElement>('.folder-toggle')!);buttons[current+(event.key==='ArrowUp'?-1:1)]?.focus();return;}
      if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const box=folderRow.getBoundingClientRect();onMenu({id,kind:'folder',x:box.left+20,y:box.bottom,trigger:folderRow.querySelector('button')});return;}
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (drag.current) { change(drag.current.base); drag.current = null; cancelAnimationFrame(frame.current); setMarquee(null); }
      else change([]);
      return;
    }
    if (ctrl && event.key.toLowerCase() === 'a') {
      event.preventDefault(); change(parts.map(part => part.id)); return;
    }
    const found = parts.findIndex(part => part.id === (focused ?? selected[0]));
    const current = Math.max(0, found);
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && parts[current]) {
      event.preventDefault();
      const target = parts[current + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) onReorder(parts[current].id, target.id, event.key === 'ArrowUp');
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1 : event.key === 'ArrowDown' ? Math.min(found + 1, parts.length - 1) : event.key === 'ArrowUp' ? Math.max(current - 1, 0) : -1;
    if (next >= 0 && parts[next]) {
      event.preventDefault();
      const id = parts[next].id;
      if (!ctrl || event.shiftKey) choose(id, ctrl, event.shiftKey);
      else setFocused(id);
      focusRow(id);
    } else if (event.key === ' ' && parts[current]) {
      event.preventDefault(); choose(parts[current].id, true, event.shiftKey);
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && parts[current]) {
      event.preventDefault();
      const trigger = [...list.current!.querySelectorAll<HTMLButtonElement>('.object-select')][current];
      const bounds = trigger.getBoundingClientRect();
      onMenu({ id: parts[current].id, x: bounds.left + 20, y: bounds.bottom, trigger });
    }
  }
  function draw() {
    const current = drag.current, element = list.current;
    if (!current || !element || !current.moved) return;
    const bounds = element.getBoundingClientRect();
    const speed = current.clientY < bounds.top + 24 ? -12 : current.clientY > bounds.bottom - 24 ? 12 : 0;
    if (speed) element.scrollTop += speed;
    const x = Math.max(0, Math.min(bounds.width, current.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, current.clientY - bounds.top)) + element.scrollTop;
    const box = { left: Math.min(current.x, x), top: Math.min(current.y, y), width: Math.abs(current.x - x), height: Math.abs(current.y - y) };
    setMarquee(box);
    const hits = [...element.querySelectorAll<HTMLElement>('.object-row')].filter(row => {
      const rect = row.getBoundingClientRect();
      const top = rect.top - bounds.top + element.scrollTop, left = rect.left - bounds.left;
      return left < box.left + box.width && left + rect.width > box.left && top < box.top + box.height && top + rect.height > box.top;
    }).map(row => row.dataset.id!);
    change(current.ctrl ? [...current.base.filter(id => !hits.includes(id)), ...hits.filter(id => !current.base.includes(id))] : current.shift ? [...new Set([...current.base, ...hits])] : hits);
    frame.current = requestAnimationFrame(draw);
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.object-row, .folder-row, .folder-root')) return;
    event.preventDefault(); list.current!.focus();
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top + event.currentTarget.scrollTop, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, base: [...selected], ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current) return;
    const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    current.clientX = event.clientX; current.clientY = event.clientY;
    if (!current.moved && moved > 3) { current.moved = true; draw(); }
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = drag.current; if (!current) return;
    if (current.moved && !cancelled) { cancelAnimationFrame(frame.current); draw(); }
    cancelAnimationFrame(frame.current);
    if (cancelled) change(current.base);
    else if (!current.moved && !current.ctrl && !current.shift) { change([]); anchor.current = null; }
    drag.current = null; setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div ref={list} className="object-list" role="listbox" aria-label={t('objectList')} aria-multiselectable="true" tabIndex={0}
    onDragOver={event=>{if(event.dataTransfer.types.some(type=>type.startsWith('application/x-modelcheck-')))event.preventDefault();}} onDrop={event=>dropItem(event,null)}
    onKeyDown={keyboard} onPointerDown={down} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
    <button className="folder-root" aria-pressed={!activeFolder} onClick={()=>onActiveFolder(null)}>{t('sceneRoot')}</button>
    {!parts.length && !folders.length && <p className="empty-note">{t('noObjects')}</p>}
    {entries.map(entry => {
      if(entry.kind==='folder'){
        const folder=entry.folder;
        const descendants=folderDescendants(folders,folder.id);
        const contents=inventory.filter(part=>part.folder_id&&descendants.has(part.folder_id));
        const visible=contents.some(part=>part.visible&&(!isolated||isolated.includes(part.id)));
        const open=searching||!collapsed.has(folder.id);
        return <div key={'folder:'+folder.id} data-folder-id={folder.id} className={`folder-row ${activeFolder===folder.id?'active':''}`} style={{paddingLeft:entry.depth*14+7}} draggable
          onDragStart={event=>{event.stopPropagation();event.dataTransfer.setData('application/x-modelcheck-folder',folder.id);event.dataTransfer.effectAllowed='move';}}
          onDragOver={event=>{if(event.dataTransfer.types.some(type=>type.startsWith('application/x-modelcheck-'))){event.preventDefault();event.stopPropagation();event.currentTarget.classList.add('folder-drop');}}}
          onDragLeave={event=>event.currentTarget.classList.remove('folder-drop')}
          onDrop={event=>{event.currentTarget.classList.remove('folder-drop');if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();onFileDrop(Array.from(event.dataTransfer.files),folder.id);}else dropItem(event,folder.id);}}
          onContextMenu={event=>{event.preventDefault();onActiveFolder(folder.id);onChange([]);onMenu({id:folder.id,kind:'folder',x:event.clientX,y:event.clientY,trigger:event.currentTarget.querySelector('button')});}}>
          <button className="folder-toggle" aria-expanded={open} aria-label={t('folderLabel',{name:folder.name})} onClick={()=>{onActiveFolder(folder.id);onChange([]);setCollapsed(previous=>{const next=new Set(previous);if(open)next.add(folder.id);else next.delete(folder.id);return next;});}}>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>} {open?<FolderOpen size={16}/>:<FolderIcon size={16}/>}<span>{folder.name}</span><small>{contents.length}</small></button>
          <button className="icon-button" aria-label={t('folderOptions',{name:folder.name})} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();onMenu({id:folder.id,kind:'folder',x:box.right,y:box.bottom,trigger:event.currentTarget});}}><MoreHorizontal size={15}/></button>
          <button className="icon-button visibility-button" aria-label={t(visible?'hideFolder':'showFolder',{name:folder.name})} disabled={!contents.length} onClick={event=>event.shiftKey&&contents[0]?onVisibility(contents[0],true):onFolderVisibility(contents.map(part=>part.id))}>{visible?<Eye size={17}/>:<EyeOff size={17}/>}</button>
        </div>;
      }
      const part=entry.part;
      const visible = part.visible && (!isolated || isolated.includes(part.id));
      return <div key={part.id} role="option" aria-selected={selected.includes(part.id)} aria-label={part.name} data-id={part.id}
        style={{paddingLeft:entry.depth*14+8}} className={`object-row ${selected.includes(part.id) ? 'selected' : ''} ${!visible ? 'muted' : ''} ${drop?.id === part.id ? drop.before ? 'drop-before' : 'drop-after' : ''}`}
        onDragOver={event => {
          if (!moving.current || moving.current === part.id) return;
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
          const bounds = event.currentTarget.getBoundingClientRect();
          setDrop({ id: part.id, before: event.clientY < bounds.top + bounds.height / 2 });
          const area = list.current!.getBoundingClientRect();
          if (event.clientY < area.top + 30) list.current!.scrollTop -= 12;
          if (event.clientY > area.bottom - 30) list.current!.scrollTop += 12;
        }}
        onDrop={event => {
          if (!moving.current) return;
          event.preventDefault(); event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          onReorder(moving.current, part.id, event.clientY < bounds.top + bounds.height / 2);
          moving.current = null; setDrop(null);
        }}
        data-selection={selected.includes(part.id) ? 'selected' : 'idle'}
        onClick={event => { if (event.target === event.currentTarget) { choose(part.id, event.ctrlKey || event.metaKey, event.shiftKey); focusRow(part.id); } }}
        onContextMenu={event => { event.preventDefault(); setFocused(part.id); onMenu({ id: part.id, x: event.clientX, y: event.clientY, trigger: event.currentTarget.querySelector<HTMLButtonElement>('.object-select') }); }}>
        <button className="object-select" tabIndex={-1} draggable title={t('reorder')} aria-pressed={selected.includes(part.id)}
          onDragStart={event => { moving.current = part.id; event.dataTransfer.setData('application/x-modelcheck-part', part.id); event.dataTransfer.setData('application/x-modelcheck-parts',JSON.stringify(selected.includes(part.id)?selected:[part.id])); event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { moving.current = null; setDrop(null); }}
          onClick={event => choose(part.id, event.ctrlKey || event.metaKey, event.shiftKey)} onFocus={() => setFocused(part.id)}>
          <span className="part-swatch" style={{ background: partColor(part.id, selected) }} /><span title={part.name}>{part.name}{nameSuffix(part)}</span>
          {!part.solid && <span className="warning-text" title={t('meshWarning')}>!</span>}
        </button>
        <button className="icon-button visibility-button" aria-label={t(visible ? 'hide' : 'show', { name: part.name })} title={t(visible ? 'hide' : 'show', { name: part.name }) + ' · ' + t('shiftEyes')} onClick={event => onVisibility(part, event.shiftKey)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
      </div>;
    })}
    {marquee && <div className="selection-marquee" style={marquee} />}
  </div>;
}
