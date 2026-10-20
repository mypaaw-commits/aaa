import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Grid2X2, Layers2, Languages, Link2, ScanLine, Upload, Eye, LoaderCircle, Maximize, Search, SquareDashedMousePointer, BoxSelect, TriangleAlert, X } from 'lucide-react';
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
import type { AnalysisResult, CheckKind, CheckTask, Job, Part, Relation } from './types';
import './style.css';

type Imported = { parts: Omit<Part, 'visible'>[]; errors: { name: string; message: string }[] };
export default function App() {
  const { t, language, setLanguage } = useI18n();
  const [session, setSession] = useState('');
  const [fitTolerance, setFitTolerance] = useState<number | null>(null);
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
    api<{ id: string; fit_tolerance: number }>('/sessions', { method: 'POST' }).then(result => { setSession(result.id); setFitTolerance(result.fit_tolerance); }).catch(err => setError(err.message));
  }, []);
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
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<AnalysisResult>(`/sessions/${session}/analysis`);
        if (stopped) return;
        if (!result.job) throw new Error('Brak wyniku analizy.');
        setJob(result.job);
        if (result.job.state === 'running') timer = setTimeout(poll, 400);
        else {
          setRelations(result.relations);
          setTasks(result.tasks);
          if (result.job.state === 'done' && result.job.check === 'INTERSECTIONS') setIntersections(true);
          if (result.job.state === 'error') setError(result.job.error ?? 'Analiza nie powiodła się.');
          else setNotice({ key: 'analysisFinished', values: { count: result.job.total, seconds: result.job.seconds.toFixed(2) } });
        }
      } catch (err) {
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
    if (busy || !session || !queuedFiles.length) return;
    setQueuedFiles([]);
    void importFiles(queuedFiles);
  }, [busy, session, queuedFiles]);

  async function importFiles(files: File[]) {
    if (busy || !session || !files.length) return;
    setLoading(true); setError(''); setNotice({ key: 'importing' });
    try {
      const form = new FormData(); const valid: File[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.stl')) throw new Error('Wybierz pliki w formacie STL.');
        if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name}: Maksymalny rozmiar jednego STL to 100 MB.`);
        valid.push(file); form.append('files', file);
      }
      const duplicates = valid.some(file => parts.some(part => part.name === file.name)) || new Set(valid.map(file => file.name)).size < valid.length;
      await reviewQueue.current;
      const result = await api<Imported>(`/sessions/${session}/parts`, { method: 'POST', body: form });
      await addImported(result);
      if (duplicates && result.parts.length) setNotice({ key: 'duplicates' });
    } catch (err) { setError((err as Error).message); setNotice(null); }
    finally { setLoading(false); }
  }
  async function analyze(check: CheckKind = 'RELATIONS') {
    setLoading(true); setError(''); setNotice(null);
    try {
      await reviewQueue.current;
      const result = await api<Job>(`/sessions/${session}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check }) });
      // Always poll once: a small model can finish before POST returns.
      setJob({ ...result, state: 'running' });
      setPanelTab(check === 'INTERSECTIONS' ? 'checks' : 'relations');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
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
    setTasks(previous => previous.map(row => row.id === task.id ? { ...row, done, note } : row));
    reviewQueue.current = reviewQueue.current.then(async () => {
      try {
        await api(`/sessions/${session}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done, note }) });
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

  function toggleVisibility(part: Part) {
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
      <div className="brand"><Box size={20} /><strong>ModelCheck <span>3D</span></strong><span className="app-version">0.20</span></div>
      <div className="header-actions">
        <label className="language-picker" title={t('language')}><Languages size={16} /><select aria-label={t('language')} value={language} onChange={event => setLanguage(event.target.value as 'en' | 'pl')}><option value="en">English</option><option value="pl">Polski</option></select></label>
        <span className="import-queue" aria-live="polite">{queuedFiles.length > 0 ? t('importQueued', { count: queuedFiles.length }) : ''}</span>
        <button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={16} />{t('import')}</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="objects panel" aria-label={t('objects')}>
        <div className="panel-heading"><h2><Box size={15} />{t('objects')}</h2><span className="count">{parts.length}</span></div>
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
        <section className="analysis-panel">
          <div className="analysis-controls">
            <button className="button analyze-button" disabled={busy || !session || parts.length < 2} onClick={() => void analyze()}>{job?.state === 'running' && job.check === 'RELATIONS' ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{t(job?.state === 'running' && job.check === 'RELATIONS' ? 'checking' : 'checkConnections')}</button>
            <button className="button" disabled={busy || !session || parts.length < 2} onClick={() => void analyze('INTERSECTIONS')}>{job?.state === 'running' && job.check === 'INTERSECTIONS' ? <LoaderCircle size={16} className="spin" /> : <ScanLine size={16} />}{t(job?.state === 'running' && job.check === 'INTERSECTIONS' ? 'checking' : 'checkIntersections')}</button>
          </div>
          <div className="analysis-result">
            <label className="intersection-toggle"><input type="checkbox" checked={intersections && intersectionsReady} disabled={!intersectionsReady} onChange={event => setIntersections(event.target.checked)} /><span>{t('showIntersections')}</span></label>
            <span className="analysis-heading">{job?.state === 'running' ? t('pairsProgress', { done: job.completed, total: job.total }) : job?.state === 'done' ? job.check === 'INTERSECTIONS' ? t(intersectionCount === 1 ? 'intersectionsFoundOne' : 'intersectionsFound', { count: intersectionCount }) : t('connectionsFound') : ''}{job?.state === 'done' && job.check === 'INTERSECTIONS' && fitCount > 0 && ` · ${t('withinToleranceCount', { count: fitCount })}`}</span>
          </div>
          {fitTolerance !== null && <span className="fit-margin" title={t('fitMarginTip')}>{t('fitMargin', { value: fitTolerance.toLocaleString(language, { maximumFractionDigits: 6 }) })}</span>}
          {job?.state === 'running' && <progress aria-label={t('analysisProgress')} max={job.total} value={job.completed} />}
        </section>
        <div className="viewport">
          <div className="viewport-toolbar">
            <div className="scene-label"><Box size={16} /><strong>{t(isolated ? 'isolated' : 'fullModel')}</strong><span>{t('visible', { count: parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).length, total: parts.length })}</span></div>
            <div className="view-controls"><select aria-label={t('projection')} title={t('projection') + ' · Numpad 5'} value={projection} onChange={event => setProjection(event.target.value as Projection)}><option value="perspective">{t('perspective')}</option><option value="orthographic">{t('orthographic')}</option></select><button className="transparency-toggle" aria-label={t('transparency')} aria-pressed={transparent} title={t('transparencyTip')} disabled={!parts.length} onClick={() => setTransparent(value => !value)}><Layers2 size={15} />{t('transparency')}</button><button className="floor-toggle" aria-label={t('floor')} aria-pressed={floor} title={t('floorTip')} onClick={() => setFloor(value => !value)}><Grid2X2 size={15} />{t('floor')}</button><button title={t('fit')} onClick={() => viewer.current?.fit()}><Maximize size={16} /></button></div>
          </div>
          <CameraControls viewer={viewer} view={cameraView} selected={selected} onToggleProjection={() => setProjection(value => value === 'perspective' ? 'orthographic' : 'perspective')} />
          <div className="viewport-stage">
            <Viewer ref={viewer} session={session} parts={parts} relations={relations} selected={selected} transparent={transparent} isolated={isolated} intersections={intersections && intersectionsReady} floor={floor} projection={projection} onViewChange={setCameraView} onSelect={select} onError={setError} onLoaded={setLoaded} />
            {!parts.length && <div className="welcome"><h1>{t('noModel')}</h1><p>{t('importHint')}</p><button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={17} />{t('chooseFiles')}</button></div>}
            {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={17} className="spin" />{t('loadingGeometry', { count: loaded, total: parts.length })}</div>}
            {isolated && <button className="exit-isolation button" onClick={showAll}><ArrowLeft size={16} />{t('back')}</button>}
            <div className="viewport-legend" aria-label={t('colorLegend')}>
              {parts.length > 0 && <div className="selection-color-legend"><span><i style={{ background: partColors.idle }} />{t('unselected')}</span><span><i style={{ background: partColors.selected }} />{t('selectionLegend')}</span></div>}

              {intersections && intersectionsReady && <div className="view-legend">{visibleIntersections.some(row => row.kind === 'WITHIN_TOLERANCE') && <span className="fit-legend"><i style={{ background: partColors.fit }} />{t('withinTolerance')}</span>}{visibleIntersections.some(row => row.kind === 'INTERSECTION' && !row.coincident) && <span><i style={{ background: partColors.intersection }} />{t('intersectionLegend')}</span>}{visibleIntersections.some(row => row.coincident) && <span><i style={{ background: partColors.coincident }} />{t('coincident')}</span>}</div>}
            </div>
          </div>
        </div>
      </section>
      <ResultsPanel parts={parts} relations={relations} tasks={tasks} busy={!!busy} tab={panelTab} onTab={setPanelTab} inspected={activePair} onChoose={choosePair} onIsolate={isolatePair} onInspect={focusIntersection} exporting={exporting} onExport={exportChecklist} onReview={(task, done, note) => void reviewTask(task, done, note)} name={part => part.name + duplicateName(part)} />
    </main>
    <footer className="statusbar"><span role="status">{busy ? t('processing') : notice ? t(notice.key, notice.values) : t('ready')}</span><span>{t('modelSummary', { parts: parts.length, pairs: connectedCount })}</span><span className="session-note">{t('sessionOnly')}</span></footer>
    {objectMenu && parts.some(part => part.id === objectMenu.id) && <ObjectMenu menu={objectMenu} name={parts.find(part => part.id === objectMenu.id)!.name} count={menuIds.length} disabled={!!busy} onClose={() => setObjectMenu(null)} onDelete={() => void removeParts(menuIds)} />}
    {error && <div className="error-message" role="alert"><TriangleAlert size={20} /><span>{localizeError(error, language)}</span><button className="icon-button" title={t('close')} onClick={() => setError('')}><X size={20} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={32} /><h2>{t('dropFiles')}</h2></div>}
  </div>;
}
