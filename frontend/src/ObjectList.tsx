import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { ObjectMenuState } from './ObjectMenu';
import { partColor } from './types';
import { useI18n } from './i18n';
import type { Part } from './types';

type Props = {
  parts: Part[]; selected: string[]; isolated: string[] | null;
  onChange: (ids: string[]) => void; onVisibility: (part: Part) => void;
  onMenu: (menu: ObjectMenuState) => void; nameSuffix: (part: Part) => string;
  onReorder: (id: string, target: string, before: boolean) => void;
};
type Drag = { x: number; y: number; startX: number; startY: number; clientX: number; clientY: number; base: string[]; ctrl: boolean; shift: boolean; moved: boolean };

export function ObjectList({ parts, selected, isolated, onChange, onVisibility, onMenu, nameSuffix, onReorder }: Props) {
  const { t } = useI18n();
  const list = useRef<HTMLDivElement>(null);
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
    const ctrl = event.ctrlKey || event.metaKey;
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
    if (event.button !== 0 || (event.target as HTMLElement).closest('.object-row')) return;
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
    onKeyDown={keyboard} onPointerDown={down} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
    {!parts.length && <p className="empty-note">{t('noObjects')}</p>}
    {parts.map(part => {
      const visible = part.visible && (!isolated || isolated.includes(part.id));
      return <div key={part.id} role="option" aria-selected={selected.includes(part.id)} aria-label={part.name} data-id={part.id}
        className={`object-row ${selected.includes(part.id) ? 'selected' : ''} ${!visible ? 'muted' : ''} ${drop?.id === part.id ? drop.before ? 'drop-before' : 'drop-after' : ''}`}
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
          onDragStart={event => { moving.current = part.id; event.dataTransfer.setData('application/x-modelcheck-part', part.id); event.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { moving.current = null; setDrop(null); }}
          onClick={event => choose(part.id, event.ctrlKey || event.metaKey, event.shiftKey)} onFocus={() => setFocused(part.id)}>
          <span className="part-swatch" style={{ background: partColor(part.id, selected) }} /><span title={part.name}>{part.name}{nameSuffix(part)}</span>
          {!part.solid && <span className="warning-text" title={t('meshWarning')}>!</span>}
        </button>
        <button className="icon-button visibility-button" title={t(visible ? 'hide' : 'show', { name: part.name })} onClick={() => onVisibility(part)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
      </div>;
    })}
    {marquee && <div className="selection-marquee" style={marquee} />}
  </div>;
}
