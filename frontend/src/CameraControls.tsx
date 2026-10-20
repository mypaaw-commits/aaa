import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Camera, Sun } from 'lucide-react';
import type { CameraView, Lighting, ViewerHandle } from './Viewer';
import { useI18n } from './i18n';

type Props = {
  viewer: RefObject<ViewerHandle | null>;
  view: CameraView | null;
  selected: string[];
  lighting: Lighting;
  onLighting: (value: Lighting) => void;
  onToggleProjection: () => void;
};

const views = [
  { id: 'front', label: 'front', shortcut: 'Numpad 1' },
  { id: 'back', label: 'backView', shortcut: 'Ctrl + Numpad 1' },
  { id: 'left', label: 'leftView', shortcut: 'Ctrl + Numpad 3' },
  { id: 'right', label: 'rightView', shortcut: 'Numpad 3' },
  { id: 'top', label: 'top', shortcut: 'Numpad 7' },
  { id: 'bottom', label: 'bottomView', shortcut: 'Ctrl + Numpad 7' },
  { id: 'isometric', label: 'view3d', shortcut: '' },
] as const;

export function CameraControls({ viewer, view, selected, lighting, onLighting, onToggleProjection }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.altKey || event.metaKey || event.shiftKey ||
          target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"]')) return;
      const consume = () => { event.preventDefault(); event.stopPropagation(); };
      const direction = event.code === 'Numpad1' ? (event.ctrlKey ? 'back' : 'front')
        : event.code === 'Numpad3' ? (event.ctrlKey ? 'left' : 'right')
        : event.code === 'Numpad7' ? (event.ctrlKey ? 'bottom' : 'top') : null;
      if (direction) { consume(); viewer.current?.view(direction); return; }
      if (event.ctrlKey) return;
      if (event.code === 'Numpad5') { consume(); onToggleProjection(); }
      else if (event.code === 'NumpadDecimal') { consume(); viewer.current?.fit(selected.length ? selected : undefined); }
      else {
        const step = { Numpad4: [15, 0], Numpad6: [-15, 0], Numpad8: [0, -15], Numpad2: [0, 15] }[event.code];
        if (step) { consume(); viewer.current?.orbit(step[0], step[1]); }
      }
    };
    // Capture reserved numpad keys before the object list interprets NumLock-off Home/End/arrows.
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [viewer, selected, onToggleProjection]);

  return <div className="camera-toolbar">
    <div className="camera-views" role="group" aria-label={t('cameraViews')}>
      <Camera size={15} aria-hidden="true" />
      {views.map(item => <button key={item.id} aria-label={t(item.label)} aria-pressed={view === item.id}
        title={t(item.label) + (item.shortcut ? ` · ${item.shortcut}` : '')}
        onClick={() => viewer.current?.view(item.id)}>{item.id === 'isometric' ? '3D' : t(item.label)}</button>)}
    </div>
    <label className="lighting-picker"><Sun size={15} aria-hidden="true" /><select aria-label={t('lighting')} value={lighting} onChange={event => onLighting(event.target.value as Lighting)}>
      <option value="soft">{t('lightingSoft')}</option>
      <option value="studio">{t('lightingStudio')}</option>
      <option value="surface">{t('lightingSurface')}</option>
      <option value="flat">{t('lightingFlat')}</option>
    </select></label>
  </div>;
}
