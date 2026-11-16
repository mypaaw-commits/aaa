import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Grid2X2, Layers2, Languages, ScanLine, Upload, Eye, LoaderCircle, Maximize, Search, SquareDashedMousePointer, BoxSelect, TriangleAlert, X } from 'lucide-react';
import { Viewer } from './Viewer';
import { CameraControls } from './CameraControls';
import { ObjectMenu } from './ObjectMenu';
import { ObjectList } from './ObjectList';
import { ResultsPanel } from './ResultsPanel';
import type { ResultsTab } from './ResultsPanel';
import { localizeError, useI18n } from './i18n';
import type { TextKey, Values } from './i18n';
import type { ObjectMenuState } from './ObjectMenu';
import type { CameraView, Projection, ViewerHandle } from './Viewer';
import { api, partColors } from './types';
import type { AnalysisResult, CheckTask, Job, Part, Relation } from './types';
import { mapScale } from './SurfaceMap';
import type { ColourMode } from './SurfaceMap';
import './style.css';

type Imported = { parts: Omit<Part, 'visible'>[]; errors: { name: string; message: string }[] };
export default function App() {
  const { t, language, setLanguage } = useI18n();
  const [session, setSession] = useState('');
  const [fitTolerance, setFitTolerance] = useState<number | null>(null);
  const [marginDraft, setMarginDraft] = useState('0.001');
  const [savingMargin, setSavingMargin] = useState(false);
  const savedMargin = useRef<number | null>(null);
  const marginQueue = useRef<Promise<void>>(Promise.resolve());
  const [parts, setParts] = useState<Part[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [tasks, setTasks] = useState<CheckTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [isolated, setIsolated] = useState<string[] | null>(null);
  const [activePair, setActivePair] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ key: TextKey; values?: Values } | null>(null);
  const [search, setSearch] = useState('');
  const [panelTab, setPanelTab] = useState<ResultsTab>('checks');
  const [intersections, setIntersections] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [colourMode, setColourMode] = useState<ColourMode>('solid');
  const [checkThickness, setCheckThickness] = useState(false);
  const [minimumThickness, setMinimumThickness] = useState(.5);
  const [scope, setScope] = useState<'all' | 'visible'>('all');
  const savedMinimum = useRef(.5);
  const minimumQueue = useRef<Promise<void>>(Promise.resolve());
  const reviewVersions = useRef(new Map<string, number>());
  const [floor, setFloor] = useState(true);
  const [projection, setProjection] = useState<Projection>('perspective');
  const [cameraView, setCameraView] = useState<CameraView | null>('isometric');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [objectMenu, setObjectMenu] = useState<ObjectMenuState | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const reviewQueue = useRef<Promise<void>>(Promise.resolve());
  const reviewSaveFailed = useRef(false);
  const busy = loading || exporting || job?.state === 'running';
  const intersectionsReady = tasks.length > 0 && tasks.every(task => !task.stale);

  useEffect(() => {
    api<{ id: string; fit_tolerance: number }>('/sessions', { method: 'POST' }).then(result => { setSession(result.id); setFitTolerance(result.fit_tolerance); savedMargin.current = result.fit_tolerance; }).catch(err => setError(err.message));
  }, []);
  useEffect(() => {
    if (fitTolerance !== null) setMarginDraft(language === 'pl' ? String(fitTolerance).replace('.', ',') : String(fitTolerance));
  }, [fitTolerance, language]);

  function saveMargin(draft = marginDraft) {
    const value = Number(draft.trim().replace(',', '.'));
    if (!draft.trim() || !Number.isFinite(value) || value < 0 || value > 10) return Promise.reject(new Error(t('invalidMargin')));
    const precedingReviews = reviewQueue.current;
    const save = marginQueue.current.then(async () => {
      if (savedMargin.current === value) return;
      setSavingMargin(true);
      try {
        await precedingReviews;
        if (reviewSaveFailed.current) throw new Error(t('reviewSaveFailed'));
        const result = await api<{ fit_tolerance: number; tasks: CheckTask[] }>(`/sessions/${session}/settings`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fit_tolerance: value }),
        });
        savedMargin.current = result.fit_tolerance;
        setFitTolerance(result.fit_tolerance); setTasks(result.tasks); setRelations([]);
        setJob(null); setIntersections(false); setActivePair(null); setError('');
        setNotice({ key: 'marginChanged' });
      } finally { setSavingMargin(false); }
    });
    marginQueue.current = save.catch(() => {});
    return save;
  }
  function saveMinimum(value = minimumThickness) {
    if (!Number.isFinite(value) || value < .01 || value > 10) return Promise.reject(new Error(t('invalidThickness')));
    const precedingReviews = reviewQueue.current;
    const save = minimumQueue.current.then(async () => {
      if (savedMinimum.current === value) return;
      await precedingReviews;
      if (reviewSaveFailed.current) throw new Error(t('reviewSaveFailed'));
      const result = await api<{ tasks: CheckTask[] }>(`/sessions/${session}/thickness-settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimum: value }),
      });
      savedMinimum.current = value; setTasks(result.tasks);
    });
    minimumQueue.current = save.catch(() => {});
    return save;
  }
  useEffect(() => {
    if (!session) return;
    const close = (event: PageTransitionEvent) => {
      if (!event.persisted) navigator.sendBeacon(`/api/sessions/${session}/close`);
    };
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  }, [session]);
  useEffect(() => {
    if (!session || job?.state !== 'running') return;
    let stopped = false;
    let networkFailures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<AnalysisResult>(`/sessions/${session}/analysis`);
        if (stopped) return;
        networkFailures = 0;
        if (!result.job) throw new Error('Brak wyniku analizy.');
        setJob(result.job);
        if (result.job.state === 'running') timer = setTimeout(poll, 400);
        else {
          setRelations(result.relations);
          setTasks(result.tasks);
          if (result.job.state === 'done') setIntersections(true);
          if (result.job.state === 'error') setError(result.job.error ?? 'Analiza nie powiodła się.');
          else if (result.job.state === 'cancelled') setNotice({ key: 'analysisCancelled' });
          else setNotice({ key: 'analysisFinished', values: { count: result.job.total, seconds: result.job.seconds.toFixed(2) } });
        }
      } catch (err) {
        if (!stopped && err instanceof TypeError && ++networkFailures <= 3) {
          timer = setTimeout(poll, 400); return;
        }
        if (!stopped) { setError((err as Error).message); setJob(previous => previous ? { ...previous, state: 'error' } : null); }
      }
    };
    timer = setTimeout(poll, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, job?.id, job?.state]);

  const addImported = async (result: Imported) => {
    setParts(previous => [...previous, ...result.parts.map(part => ({ ...part, visible: true }))]);
    if (result.errors.length) setError(result.errors.map(item => `${item.name}: ${item.message}`).join('\n'));
    if (result.parts.length) {
      setIsolated(null); setSearch(''); setJob(null);
      setNotice({ key: 'imported', values: { count: result.parts.length } });
      const current = await api<AnalysisResult>(`/sessions/${session}/analysis`);
      setTasks(current.tasks);
      if (current.tasks.some(task => task.stale)) setIntersections(false);
    }
  };
  function queueImport(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (incoming.length) setQueuedFiles(previous => [...previous, ...incoming]);
    if (fileInput.current) fileInput.current.value = '';
  }
  useEffect(() => {
    if (busy || savingMargin || !session || !queuedFiles.length) return;
    setQueuedFiles([]);
    void importFiles(queuedFiles);
  }, [busy, savingMargin, session, queuedFiles]);

  async function importFiles(files: File[]) {
    if (busy || !session || !files.length) return;
    setLoading(true); setError(''); setNotice({ key: 'importing' });
    try {
      const form = new FormData(); const valid: File[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.stl')) throw new Error('Wybierz pliki w formacie STL.');
        if (file.size > 200 * 1024 * 1024) throw new Error(`${file.name}: Maksymalny rozmiar jednego STL to 200 MB.`);
        valid.push(file); form.append('files', file);
      }
      const duplicates = valid.some(file => parts.some(part => part.name === file.name)) || new Set(valid.map(file => file.name)).size < valid.length;
      await marginQueue.current;
      await reviewQueue.current;
      const result = await api<Imported>(`/sessions/${session}/parts`, { method: 'POST', body: form });
      await addImported(result);
      if (duplicates && result.parts.length) setNotice({ key: 'duplicates' });
    } catch (err) { setError((err as Error).message); setNotice(null); }
    finally { setLoading(false); }
  }
  async function analyze() {
    setLoading(true); setError(''); setNotice(null);
    try {
      await saveMargin();
      await saveMinimum();
      await reviewQueue.current;
      const result = await api<Job>(`/sessions/${session}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fit_map: colourMode === 'fit', thickness: checkThickness || colourMode === 'thickness', ...(scope === 'visible' ? { part_ids: parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).map(part => part.id) } : {}) }) });
      // Always poll once: a small model can finish before POST returns.
      setJob({ ...result, state: 'running' });
      setPanelTab('checks');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  async function stopAnalysis() {
    try {
      await api(`/sessions/${session}/analysis/cancel`, { method: 'POST' });
      setJob(previous => previous?.state === 'running' ? { ...previous, stage: 'stopping' } : previous);
    } catch (err) { setError((err as Error).message); }
  }
  function select(id: string | null, multi: boolean) {
    setActivePair(null);
    if (!id) { if (!multi) setSelected([]); return; }
    if (isolated && !isolated.includes(id)) setIsolated(null);
    setSelected(previous => !multi ? [id] : previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  }
  function choosePair(relation: Relation) {
    setActivePair(relation.id); setSelected(relation.part_ids);
    setParts(previous => previous.map(part => relation.part_ids.includes(part.id) ? { ...part, visible: true } : part));
    if (isolated && !relation.part_ids.every(id => isolated.includes(id))) setIsolated(null);
  }
  function isolatePair(relation: Relation) {
    choosePair(relation); setIsolated(relation.part_ids);
    requestAnimationFrame(() => viewer.current?.fit(relation.part_ids));
  }
  function focusIntersection(relation: Relation) {
    isolatePair(relation); setIntersections(true);
  }
  function reorderPart(id: string, target: string, before: boolean) {
    if (id === target) return;
    setParts(previous => {
      const item = previous.find(part => part.id === id);
      if (!item || !previous.some(part => part.id === target)) return previous;
      const next = previous.filter(part => part.id !== id);
      next.splice(next.findIndex(part => part.id === target) + (before ? 0 : 1), 0, item);
      return next;
    });
  }
  function showAll() {
    setIsolated(null);
    setParts(previous => previous.map(part => ({ ...part, visible: true })));
    requestAnimationFrame(() => viewer.current?.fit(parts.map(part => part.id)));
  }
  async function removeParts(ids: string[]) {
    if (busy || !ids.length) return;
    setObjectMenu(null);
    setLoading(true); setError('');
    try {
      await marginQueue.current;
      await reviewQueue.current;
      await api(`/sessions/${session}/parts`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part_ids: ids }) });
      setParts(previous => previous.filter(part => !ids.includes(part.id)));
      setRelations(previous => previous.filter(relation => !relation.part_ids.some(id => ids.includes(id))));
      setSelected(previous => previous.filter(pid => !ids.includes(pid)));
      setIsolated(null); setActivePair(null); setJob(null);
      const current = await api<AnalysisResult>(`/sessions/${session}/analysis`);
      setTasks(current.tasks);
      if (current.tasks.some(task => task.stale)) setIntersections(false);
      setNotice(ids.length === 1 ? { key: 'removed' } : { key: 'removedCount', values: { count: ids.length } });
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  function reviewTask(task: CheckTask, done: boolean, note: string) {
    const version = (reviewVersions.current.get(task.id) ?? 0) + 1;
    reviewVersions.current.set(task.id, version);
    setTasks(previous => previous.map(row => row.id === task.id ? { ...row, done, note } : row));
    const precedingSettings = Promise.all([marginQueue.current, minimumQueue.current]);
    reviewQueue.current = reviewQueue.current.then(async () => {
      try {
        await precedingSettings;
        await api(`/sessions/${session}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done, note }) });
        if (reviewVersions.current.get(task.id) === version) setTasks(previous => previous.map(row => row.id === task.id ? { ...row, done, note } : row));
        reviewSaveFailed.current = false;
      } catch (err) {
        reviewSaveFailed.current = true;
        setError((err as Error).message);
        const current = await api<AnalysisResult>(`/sessions/${session}/analysis`).catch(() => null);
        if (current) setTasks(current.tasks);
      }
    });
    return reviewQueue.current;
  }
  async function exportChecklist() {
    if (busy || !session || !parts.length) return;
    setExporting(true); setError('');
    try {
      await saveMargin();
      await saveMinimum();
      await reviewQueue.current;
      if (reviewSaveFailed.current) throw new Error(t('reviewSaveFailed'));
      const response = await fetch(`/api/sessions/${session}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, part_ids: parts.map(part => part.id), utc_offset_minutes: -new Date().getTimezoneOffset() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : t('exportFailed'));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'modelcheck-checklist.pdf';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError((err as Error).message); }
    finally { setExporting(false); }
  }
  const duplicateName = (part: Part) => parts.filter(other => other.name === part.name).length > 1 ? ` · ${parts.indexOf(part) + 1}` : '';
  const fitSelected = () => { if (selected.length) { setIsolated(selected); setParts(previous => previous.map(part => selected.includes(part.id) ? { ...part, visible: true } : part)); requestAnimationFrame(() => viewer.current?.fit(selected)); } };

  function toggleVisibility(part: Part, all = false) {
    if (all) {
      const visible = !!isolated || parts.some(part => !part.visible);
      setIsolated(null); setParts(previous => previous.map(item => ({ ...item, visible })));
      return;
    }
    const visible = part.visible && (!isolated || isolated.includes(part.id));
    setParts(previous => previous.map(item => item.id === part.id ? { ...item, visible: !visible } : item));
    if (!visible && isolated && !isolated.includes(part.id)) setIsolated([...isolated, part.id]);
  }
  const menuIds = objectMenu ? selected.includes(objectMenu.id) ? selected : [objectMenu.id] : [];
  const listedParts = parts.filter(part => part.name.toLowerCase().includes(search.toLowerCase()));
  const intersectionCount = relations.filter(row => row.kind === 'INTERSECTION').length;
  const fitCount = relations.filter(row => row.kind === 'WITHIN_TOLERANCE').length;
  const connectedCount = relations.filter(row => ['CONNECTED', 'INTERSECTION', 'WITHIN_TOLERANCE'].includes(row.kind)).length;
  const visibleIntersections = relations.filter(row => ['INTERSECTION', 'WITHIN_TOLERANCE'].includes(row.kind) && row.part_ids.every(id => parts.some(part => part.id === id && part.visible && (!isolated || isolated.includes(id)))));


  return <div className="app"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); queueImport(event.dataTransfer.files); }}>
    <input type="file" ref={fileInput} accept=".stl" multiple hidden onChange={event => { if (event.target.files) queueImport(event.target.files); }} />
    <header className="topbar">
      <div className="brand"><Box size={20} /><strong>ModelCheck <span>3D</span></strong><span className="app-version">0.26</span></div>
      <div className="header-actions">
        <label className="language-picker" title={t('language')}><Languages size={16} /><select aria-label={t('language')} value={language} onChange={event => setLanguage(event.target.value as 'en' | 'pl')}><option value="en">English</option><option value="pl">Polski</option></select></label>
        <span className="import-queue" aria-live="polite">{queuedFiles.length > 0 ? t('importQueued', { count: queuedFiles.length }) : ''}</span>
        <button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={16} />{t('import')}</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="objects panel" aria-label={t('objects')}>
        <div className="panel-heading"><h2><Box size={15} />{t('objects')}</h2><span className="count">{parts.length}</span></div>
        <section className="analysis-panel">
          <div className="analysis-controls">
            <button className="button analyze-button" disabled={busy || !session || parts.filter(part => scope === 'all' || part.visible && (!isolated || isolated.includes(part.id))).length < (checkThickness || colourMode === 'thickness' ? 1 : 2)} onClick={() => void analyze()}>{job?.state === 'running' ? <LoaderCircle size={16} className="spin" /> : <ScanLine size={16} />}{t(job?.state === 'running' ? 'analyzing' : 'analyze')}</button>
            {job?.state === 'running' && <button className="button" disabled={job.stage === 'stopping'} onClick={() => void stopAnalysis()}><X size={15} />{t('stopAnalysis')}</button>}
          </div>
          {job?.state === 'running' && <p className="analysis-stage" role="status">{t(`stage_${job.stage ?? 'bounds'}`)} · {job.seconds.toFixed(0)} s</p>}
          {job?.state === 'done' && relations.some(row => row.kind === 'UNCERTAIN') && <p className="analysis-stage analysis-warning">{t(relations.filter(row => row.kind === 'UNCERTAIN').length === 1 ? 'uncertainSummaryOne' : 'uncertainSummary', { count: relations.filter(row => row.kind === 'UNCERTAIN').length })}</p>}
          <div className="analysis-result">
            <label className="intersection-toggle"><input type="checkbox" checked={intersections && intersectionsReady} disabled={!intersectionsReady} onChange={event => setIntersections(event.target.checked)} /><span>{t('showIntersections')}</span></label>
            <span className="analysis-heading">{job?.state === 'running' ? job.stage === 'thickness' ? t('surfaceProgress', { done: job.surface_done ?? 0, total: job.surface_total ?? 0 }) : t('pairsProgress', { done: job.completed, total: job.total }) : job?.state === 'done' ? t(intersectionCount === 1 ? 'intersectionsFoundOne' : 'intersectionsFound', { count: intersectionCount }) : ''}{job?.state === 'done' && fitCount > 0 && ` · ${t('withinToleranceCount', { count: fitCount })}`}</span>
          </div>
          {fitTolerance !== null && <label className="fit-margin" title={t('marginHelp')}><span>{t('fitMarginLabel')}</span><input aria-label={t('fitMarginInput')} inputMode="decimal" value={marginDraft} disabled={busy || savingMargin || !session}
            onChange={event => setMarginDraft(event.target.value)}
            onBlur={() => { void saveMargin().catch(err => setError((err as Error).message)); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /><span>mm</span></label>}
          {fitTolerance !== null && <input className="analysis-slider" type="range" aria-label={t('fitSlider')} min="0" max={Math.max(.1, fitTolerance)} step="0.0001" value={Number(marginDraft.replace(',', '.')) || 0} disabled={!!busy} onChange={event => setMarginDraft(event.target.value)} onPointerUp={event => { void saveMargin(event.currentTarget.value).catch(err => setError(err.message)); }} onKeyUp={event => { void saveMargin(event.currentTarget.value).catch(err => setError(err.message)); }} />}
          {job?.state === 'running' && <progress aria-label={t('analysisProgress')} max={Math.max(job.stage === 'thickness' ? job.surface_total ?? 1 : job.total, 1)} value={job.stage === 'thickness' ? job.surface_done ?? 0 : job.completed} />}
          {colourMode === 'fit' && relations.some(row => ['INTERSECTION', 'WITHIN_TOLERANCE'].includes(row.kind) && !row.coincident && !row.map_ready) && <p className="map-hint">{t('runMapsHint')}</p>}
          {colourMode === 'thickness' && !tasks.some(task => task.thickness && !task.stale) && <p className="map-hint">{t('runMapsHint')}</p>}
          <label className="tool-label">{t('analysisScope')}<select aria-label={t('analysisScope')} value={scope} disabled={!!busy} onChange={event => setScope(event.target.value as 'all' | 'visible')}><option value="all">{t('allParts')}</option><option value="visible">{t('visibleParts')}</option></select></label>
          <label className="tool-label">{t('colourMap')}<select aria-label={t('colourMap')} value={colourMode} onChange={event => { const mode = event.target.value as ColourMode; setColourMode(mode); if (mode === 'thickness') setCheckThickness(true); }}><option value="solid">{t('solidColours')}</option><option value="fit">{t('fitMap')}</option><option value="thickness">{t('thicknessMap')}</option></select></label>
          <label className="analysis-option"><input type="checkbox" checked={checkThickness} disabled={!!busy} onChange={event => { setCheckThickness(event.target.checked); if (!event.target.checked && colourMode === 'thickness') setColourMode('solid'); }} />{t('measureThickness')}</label>
          {(checkThickness || colourMode === 'thickness') && <div className="wall-settings"><label>{t('minimumThickness')}<input type="number" aria-label={t('minimumThickness')} min="0.01" max="10" step="0.01" value={minimumThickness} disabled={!!busy} onChange={event => setMinimumThickness(Number(event.target.value))} onBlur={() => { void saveMinimum().catch(err => setError(err.message)); }} /> mm</label>
          <input className="analysis-slider" type="range" aria-label={t('thicknessSlider')} min="0.01" max={Math.max(5, minimumThickness)} step="0.01" value={minimumThickness} disabled={!!busy} onChange={event => setMinimumThickness(Number(event.target.value))} onPointerUp={event => { void saveMinimum(Number(event.currentTarget.value)).catch(err => setError(err.message)); }} onKeyUp={event => { void saveMinimum(Number(event.currentTarget.value)).catch(err => setError(err.message)); }} /><p>{t('thicknessMethod')}</p></div>}
        </section>
        <ObjectList parts={listedParts} selected={selected} isolated={isolated} nameSuffix={duplicateName} onMenu={setObjectMenu} onDelete={ids => void removeParts(ids)} onVisibility={toggleVisibility} onReorder={reorderPart}
          onChange={ids => { setSelected(ids); setActivePair(null); if (isolated && ids.some(id => !isolated.includes(id))) setIsolated(null); }} />
        <div className="object-tools">
          {searchOpen && <label className="object-search"><Search size={16} /><input autoFocus aria-label={t('search')} placeholder={t('searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setSearch(''); } }} /></label>}
          <div className="object-tool-rail" role="toolbar" aria-label={t('objects')}>
            <button className="icon-button" title={t('search')} aria-pressed={searchOpen} onClick={() => { setSearchOpen(value => !value); if (searchOpen) setSearch(''); }}><Search size={18} /></button>
            <span className="tool-separator" />
            <button className="icon-button" title={t('selectAll')} disabled={!listedParts.length} onClick={() => { setSelected(listedParts.map(part => part.id)); setActivePair(null); }}><SquareDashedMousePointer size={18} /></button>
            <button className="icon-button" title={t('deselect')} disabled={!selected.length} onClick={() => { setSelected([]); setActivePair(null); }}><X size={18} /></button>
            <button className="icon-button" title={t('isolate')} disabled={!selected.length} onClick={fitSelected}><BoxSelect size={18} /></button>
            <button className="icon-button" title={t('showAll')} disabled={!parts.length} onClick={showAll}><Eye size={18} /></button>
          </div>
          <span className="selection-count">{t('selected', { count: selected.length })}</span>
        </div>
      </aside>
      <section className="center" aria-label={t('workspace')}>
        <div className="viewport">
          <div className="viewport-toolbar">
            <div className="scene-label"><Box size={16} /><strong>{t(isolated ? 'isolated' : 'fullModel')}</strong><span>{t('visible', { count: parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).length, total: parts.length })}</span></div>
            <div className="view-controls"><select aria-label={t('projection')} title={t('projection') + ' · Numpad 5'} value={projection} onChange={event => setProjection(event.target.value as Projection)}><option value="perspective">{t('perspective')}</option><option value="orthographic">{t('orthographic')}</option></select><button className="transparency-toggle" aria-label={t('transparency')} aria-pressed={transparent} title={t('transparencyTip')} disabled={!parts.length} onClick={() => setTransparent(value => !value)}><Layers2 size={15} />{t('transparency')}</button><button className="floor-toggle" aria-label={t('floor')} aria-pressed={floor} title={t('floorTip')} onClick={() => setFloor(value => !value)}><Grid2X2 size={15} />{t('floor')}</button><button title={t('fit')} onClick={() => viewer.current?.fit()}><Maximize size={16} /></button></div>
          </div>
          <CameraControls viewer={viewer} view={cameraView} selected={selected} ready={parts.length > 0 && loaded === parts.length} onError={setError} onSaved={() => setNotice({ key: 'screenshotSaved' })} onToggleProjection={() => setProjection(value => value === 'perspective' ? 'orthographic' : 'perspective')} />
          <div className="viewport-stage">
            <Viewer ref={viewer} session={session} parts={parts} relations={relations} selected={selected} transparent={transparent} isolated={isolated} intersections={intersections && intersectionsReady} floor={floor} projection={projection} colourMode={colourMode} fitTolerance={fitTolerance ?? .001} minimumThickness={minimumThickness} thicknessIds={tasks.filter(task => !!task.thickness && !task.stale).map(task => task.part_id)} onViewChange={setCameraView} onSelect={select} onError={setError} onLoaded={setLoaded} />
            {!parts.length && <div className="welcome"><h1>{t('noModel')}</h1><p>{t('importHint')}</p><button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={17} />{t('chooseFiles')}</button></div>}
            {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={17} className="spin" />{t('loadingGeometry', { count: loaded, total: parts.length })}</div>}
            {isolated && <button className="exit-isolation button" onClick={showAll}><ArrowLeft size={16} />{t('back')}</button>}
            {colourMode !== 'solid' && <div className="rainbow-legend"><strong>{t(colourMode === 'fit' ? 'fitMap' : 'thicknessMap')} · mm</strong><div className={colourMode === 'thickness' ? 'rainbow reversed' : 'rainbow'} /><div className="rainbow-labels"><span>0</span><span>{(mapScale(colourMode === 'fit' ? fitTolerance ?? .001 : minimumThickness) / 2).toLocaleString(language, { maximumSignificantDigits: 4 })}</span><span>≥{mapScale(colourMode === 'fit' ? fitTolerance ?? .001 : minimumThickness).toLocaleString(language, { maximumSignificantDigits: 4 })}</span></div><small>{t('unknownGrey')}</small></div>}
            <div className="viewport-legend" aria-label={t('colorLegend')}>
              {colourMode !== 'thickness' && parts.length > 0 && <div className="selection-color-legend"><span><i style={{ background: partColors.idle }} />{t('unselected')}</span><span><i style={{ background: partColors.selected }} />{t('selectionLegend')}</span></div>}

              {colourMode === 'solid' && intersections && intersectionsReady && <div className="view-legend">{visibleIntersections.some(row => row.kind === 'WITHIN_TOLERANCE') && <span className="fit-legend"><i style={{ background: partColors.fit }} />{t('withinTolerance')}</span>}{visibleIntersections.some(row => row.kind === 'INTERSECTION' && !row.coincident) && <span><i style={{ background: partColors.intersection }} />{t('intersectionLegend')}</span>}{visibleIntersections.some(row => row.coincident) && <span><i style={{ background: partColors.coincident }} />{t('coincident')}</span>}</div>}
            </div>
          </div>
        </div>
      </section>
      <ResultsPanel onThickness={id => { setSelected([id]); setIsolated([id]); setColourMode('thickness'); requestAnimationFrame(() => viewer.current?.fit([id])); }} parts={parts} relations={relations} tasks={tasks} busy={!!busy || savingMargin} tab={panelTab} onTab={setPanelTab} inspected={activePair} onChoose={choosePair} onIsolate={isolatePair} onInspect={focusIntersection} exporting={exporting} onExport={exportChecklist} onReview={(task, done, note) => void reviewTask(task, done, note)} name={part => part.name + duplicateName(part)} />
    </main>
    <footer className="statusbar"><span role="status">{busy ? t('processing') : notice ? t(notice.key, notice.values) : t('ready')}</span><span>{t('modelSummary', { parts: parts.length, pairs: connectedCount })}</span><span className="session-note">{t('sessionOnly')}</span></footer>
    {objectMenu && parts.some(part => part.id === objectMenu.id) && <ObjectMenu menu={objectMenu} name={parts.find(part => part.id === objectMenu.id)!.name} count={menuIds.length} disabled={!!busy} onClose={() => setObjectMenu(null)} onDelete={() => void removeParts(menuIds)} />}
    {error && <div className="error-message" role="alert"><TriangleAlert size={20} /><span>{localizeError(error, language)}</span><button className="icon-button" title={t('close')} onClick={() => setError('')}><X size={20} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={32} /><h2>{t('dropFiles')}</h2></div>}
  </div>;
}
