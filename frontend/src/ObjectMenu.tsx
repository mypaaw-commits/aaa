import { useLayoutEffect, useRef } from 'react';
import { useI18n } from './i18n';

export type ObjectMenuState = { id: string; x: number; y: number; trigger: HTMLButtonElement | null };

type Props = { menu: ObjectMenuState; name: string; disabled: boolean; onClose: () => void; onDelete: () => void };

export function ObjectMenu({ menu, name, disabled, onClose, onDelete }: Props) {
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
    { id: 'delete', label: t('remove'), disabled, run: onDelete },
  ].sort((a, b) => a.label.localeCompare(b.label, language));
  return <div ref={ref} className="object-context-menu" role="menu" aria-label={t('objectOptions', { name })} tabIndex={-1} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()}>
    {actions.map(action => <button key={action.id} role="menuitem" disabled={action.disabled} onClick={action.run}>{action.label}</button>)}
  </div>;
}
