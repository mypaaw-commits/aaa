import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import type { CameraView, ViewerHandle, ImageFormat } from './Viewer';
import { useI18n } from './i18n';

type Props = {
  viewer: RefObject<ViewerHandle | null>;
  view: CameraView | null;
  selected: string[];
  onToggleProjection: () => void;
  ready: boolean;
  onError: (message: string) => void;
  onSaved: () => void;
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

export function CameraControls({ viewer, view, selected, onToggleProjection, ready, onError, onSaved }: Props) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ImageFormat>('png');
  const [capturing, setCapturing] = useState(false);
  async function screenshot() {
    if (!viewer.current || capturing) return;
    setCapturing(true);
    try {
      const image = await viewer.current.capture(format);
      const url = URL.createObjectURL(image);
      const link = document.createElement('a');
      const now = new Date();
      const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join('-');
      link.href = url; link.download = `modelcheck-view-${stamp}.${format === 'jpeg' ? 'jpg' : format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onSaved();
    } catch { onError(t('screenshotFailed')); }
    finally { setCapturing(false); }
  }
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
    <div className="screenshot-tools">
      <button className="icon-button screenshot-button" title={t('saveScreenshot')} aria-label={t('saveScreenshot')} disabled={!ready || capturing} onClick={() => void screenshot()}>
        {capturing ? <LoaderCircle size={17} className="spin" /> : <Camera size={17} />}
      </button>
      <select aria-label={t('imageFormat')} title={t('imageFormat')} value={format} disabled={capturing} onChange={event => setFormat(event.target.value as ImageFormat)}><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select>
    </div>
    <div className="camera-views" role="group" aria-label={t('cameraViews')}>
      {views.map(item => <button key={item.id} aria-label={t(item.label)} aria-pressed={view === item.id}
        title={t(item.label) + (item.shortcut ? ` · ${item.shortcut}` : '')}
        onClick={() => viewer.current?.view(item.id)}>{item.id === 'isometric' ? '3D' : t(item.label)}</button>)}
    </div>

  </div>;
}
