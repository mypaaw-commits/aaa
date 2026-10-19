import { useLayoutEffect, useRef } from 'react';

export type ObjectMenuState = { id: string; x: number; y: number; trigger: HTMLButtonElement | null };

type Props = { menu: ObjectMenuState; name: string; disabled: boolean; onClose: () => void; onDelete: () => void };

export function ObjectMenu({ menu, name, disabled, onClose, onDelete }: Props) {
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

  return <div ref={ref} className="object-context-menu" role="menu" aria-label={`Opcje elementu ${name}`} tabIndex={-1} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()}>
    <button role="menuitem" disabled={disabled} onClick={onDelete}>Usuń</button>
  </div>;
}
