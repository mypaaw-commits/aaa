import type { Folder } from './types';
import { folderDescendants, folderPath } from './objectTree';
import { useLayoutEffect, useRef } from 'react';
import { useI18n } from './i18n';

export type ObjectMenuState = { id: string; kind?: 'folder'; x: number; y: number; trigger: HTMLButtonElement | null };

type Props = { menu: ObjectMenuState; name: string; count: number; disabled: boolean; onClose: () => void; onDelete: () => void; folders: Folder[]; onMove: (folder:string|null) => void; onRename: () => void; onNewFolder: () => void };

export function ObjectMenu({ menu, name, count, disabled, onClose, onDelete, folders, onMove, onRename, onNewFolder }: Props) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - bounds.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - bounds.height - 4))}px`;
    const item = element.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (item ?? element).focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) onClose();
    };
    const keyboard = (event: KeyboardEvent) => {
      if(event.target instanceof HTMLSelectElement && event.key!=='Escape')return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        onClose();
        menu.trigger?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [menu, onClose]);

  const actions = [
    { id: 'delete', label: menu.kind==='folder'?t('deleteFolder'):count > 1 ? t('removeSelected', { count }) : t('remove'), disabled, run: onDelete },
    ...(menu.kind==='folder'?[{id:'rename',label:t('renameFolder'),disabled,run:onRename},{id:'new',label:t('newSubfolder'),disabled,run:onNewFolder}]:[]),
  ].sort((a, b) => a.label.localeCompare(b.label, language));
  return <div ref={ref} className="object-context-menu" role="menu" aria-label={t('objectOptions', { name })} tabIndex={-1} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()}>
    <label className="move-folder-label">{t('moveToFolder')}<select aria-label={t('moveToFolder')} defaultValue="" disabled={disabled} onChange={event=>{if(event.target.value)onMove(event.target.value==='root'?null:event.target.value);}}><option value="" disabled>{t('chooseFolder')}</option><option value="root">{t('sceneRoot')}</option>{folders.filter(folder=>menu.kind!=='folder'||!folderDescendants(folders,menu.id).has(folder.id)).map(folder=><option value={folder.id} key={folder.id}>{folderPath(folders,folder.id)}</option>)}</select></label>
    {actions.map(action => <button key={action.id} role="menuitem" disabled={action.disabled} onClick={action.run}>{action.label}</button>)}
  </div>;
}
