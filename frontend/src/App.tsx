import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, CircleAlert, CircleHelp, Grid2X2, Link2, ScanLine, Upload, Eye, EyeOff, Focus, LoaderCircle, Maximize, Search, TriangleAlert, X } from 'lucide-react';
import { Viewer } from './Viewer';
import { ObjectMenu } from './ObjectMenu';
import type { ObjectMenuState } from './ObjectMenu';
import type { ViewerHandle } from './Viewer';
import { api, labels, number, partColor, taskResult } from './types';
import type { AnalysisResult, CheckKind, CheckTask, Job, Part, Relation } from './types';
import './style.css';

type Imported = { parts: Omit<Part, 'visible'>[]; errors: { name: string; message: string }[] };
function TaskCard({ task, part, disabled, onReview, onClose }: { task: CheckTask; part: Part; disabled: boolean; onReview: (done: boolean, note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(task.note);
  useEffect(() => { setNote(task.note); }, [task.id, task.note]);
  return <section className="review-card" aria-label="Szczegóły kontroli elementu">
    <div className="review-heading"><h3>Intersekcje: {part.name}</h3><button className="icon-button" title="Zamknij kontrolę" onClick={onClose}><X size={18} /></button></div>
    <p className={`result-banner ${task.result.toLowerCase()}`}>{taskResult(task)}</p>
    <label className="task-confirm"><input type="checkbox" checked={task.done} disabled={disabled || task.stale} onChange={event => onReview(event.target.checked, note)} />Kontrola wykonana</label>
    <label className="field-label" htmlFor="note">Notatka do kontroli</label>
    <textarea id="note" disabled={disabled || task.stale} maxLength={5000} placeholder="Dodaj uwagę do kontroli tego elementu…" value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== task.note) onReview(task.done, note); }} />
    <p className="microcopy">Odhacz po ręcznym sprawdzeniu. Wynik obliczeń nie odhacza zadania.</p>
  </section>;
}

export default function App() {
  const [session, setSession] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [tasks, setTasks] = useState<CheckTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ ids: string[]; activeId: string | null }>({ ids: [], activeId: null });
  const selected = selection.ids;
  const activePartId = selection.activeId;
  const [isolated, setIsolated] = useState<string[] | null>(null);
  const [activePair, setActivePair] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [panelTab, setPanelTab] = useState<'relations' | 'checks'>('relations');
  const [intersections, setIntersections] = useState(false);
  const [floor, setFloor] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const [objectMenu, setObjectMenu] = useState<ObjectMenuState | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const reviewQueue = useRef<Promise<void>>(Promise.resolve());
  const busy = loading || job?.state === 'running';
  const reviewed = tasks.filter(task => task.done && !task.stale).length;
  const activeTask = tasks.find(task => task.id === activeTaskId);
  const activeTaskPart = parts.find(part => part.id === activeTask?.part_id);
  const intersectionsReady = tasks.length > 0 && tasks.every(task => !task.stale);

  useEffect(() => {
    api<{ id: string }>('/sessions', { method: 'POST' }).then(result => setSession(result.id)).catch(err => setError(err.message));
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
          else setNotice(`Sprawdzono par: ${result.job.total}. Czas: ${number(result.job.seconds, 2)} s.`);
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
      setNotice(`Wczytano ${result.parts.length} ${result.parts.length === 1 ? 'część' : 'części'}. Współrzędne STL zostały zachowane.`);
      const current = await api<AnalysisResult>(`/sessions/${session}/analysis`);
      setTasks(current.tasks);
      if (current.tasks.some(task => task.stale)) setIntersections(false);
    }
  };
  async function importFiles(files: FileList | File[]) {
    if (busy || !session || !files.length) return;
    setLoading(true); setError(''); setNotice('Wczytywanie plików i przygotowywanie geometrii…');
    try {
      const form = new FormData(); const valid: File[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.stl')) throw new Error('Wybierz pliki w formacie STL.');
        if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name}: maksymalny rozmiar jednego STL to 100 MB.`);
        valid.push(file); form.append('files', file);
      }
      const duplicates = valid.some(file => parts.some(part => part.name === file.name)) || new Set(valid.map(file => file.name)).size < valid.length;
      await reviewQueue.current;
      const result = await api<Imported>(`/sessions/${session}/parts`, { method: 'POST', body: form });
      await addImported(result);
      if (duplicates && result.parts.length) setNotice('Wczytano części. Powtarzające się nazwy oznaczono numerem na liście; każda część ma osobny identyfikator.');
    } catch (err) { setError((err as Error).message); setNotice(''); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function demo() {
    if (busy || !session) return;
    setLoading(true); setError('');
    try { await addImported(await api<Imported>(`/sessions/${session}/demo`, { method: 'POST' })); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  async function analyze(check: CheckKind = 'RELATIONS') {
    setLoading(true); setError(''); setNotice('');
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
    setActiveTaskId(null);
    if (!id) { if (!multi) setSelection(previous => ({ ...previous, ids: [] })); return; }
    if (isolated && !isolated.includes(id)) setIsolated(null);
    setSelection(previous => {
      const ids = !multi ? [id] : previous.ids.includes(id) ? previous.ids.filter(item => item !== id) : [...previous.ids, id];
      return { ...previous, ids };
    });
  }
  function focusPair(relation: Relation) {
    setActivePair(relation.id);
    viewer.current?.fit(relation.part_ids);
  }
  function showAll() {
    setIsolated(null);
    setParts(previous => previous.map(part => ({ ...part, visible: true })));
    requestAnimationFrame(() => viewer.current?.fit(parts.map(part => part.id)));
  }
  async function removePart(id: string) {
    if (busy) return;
    setObjectMenu(null);
    setLoading(true);
    try {
      await reviewQueue.current;
      await api(`/sessions/${session}/parts/${id}`, { method: 'DELETE' });
      setParts(previous => previous.filter(part => part.id !== id));
      setRelations(previous => previous.filter(relation => !relation.part_ids.includes(id)));
      setSelection(previous => {
        const ids = previous.ids.filter(pid => pid !== id);
        return { ids, activeId: previous.activeId === id ? null : previous.activeId };
      });
      setIsolated(null); setActivePair(null); setLoaded(previous => Math.max(0, previous - 1));
      setActiveTaskId(null);
      const current = await api<AnalysisResult>(`/sessions/${session}/analysis`);
      setTasks(current.tasks);
      if (current.tasks.some(task => task.stale)) setIntersections(false);
      setNotice('Usunięto element z modelu.');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  function reviewTask(task: CheckTask, done: boolean, note: string) {
    setTasks(previous => previous.map(row => row.id === task.id ? { ...row, done, note } : row));
    reviewQueue.current = reviewQueue.current.then(async () => {
      try {
        await api(`/sessions/${session}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done, note }) });
      } catch (err) {
        setError((err as Error).message);
        const current = await api<AnalysisResult>(`/sessions/${session}/analysis`).catch(() => null);
        if (current) setTasks(current.tasks);
      }
    });
    return reviewQueue.current;
  }
  const duplicateName = (part: Part) => parts.filter(other => other.name === part.name).length > 1 ? ` · ${parts.indexOf(part) + 1}` : '';
  const fitSelected = () => { if (selected.length) { setIsolated(selected); setParts(previous => previous.map(part => selected.includes(part.id) ? { ...part, visible: true } : part)); requestAnimationFrame(() => viewer.current?.fit(selected)); } };

  function toggleVisibility(part: Part) {
    const visible = part.visible && (!isolated || isolated.includes(part.id));
    setParts(previous => previous.map(item => item.id === part.id ? { ...item, visible: !visible } : item));
    if (!visible && isolated && !isolated.includes(part.id)) setIsolated([...isolated, part.id]);
  }
  const intersectionCount = relations.filter(row => row.kind === 'INTERSECTION').length;
  const relatedPairs = relations.filter(row => row.kind !== 'DISCONNECTED').map(row => ({
    relation: row,
    parts: row.part_ids.map(id => parts.find(part => part.id === id)).sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? '', 'pl', { numeric: true })),
  })).sort((a, b) => a.parts.map(part => part?.name).join(' / ').localeCompare(b.parts.map(part => part?.name).join(' / '), 'pl', { numeric: true }));
  const connectedCount = relations.filter(row => row.kind === 'CONNECTED' || row.kind === 'INTERSECTION').length;
  const uncertainCount = relations.filter(row => row.kind === 'UNCERTAIN').length;

  return <div className="app"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <input type="file" ref={fileInput} accept=".stl" multiple hidden onChange={event => { if (event.target.files) void importFiles(event.target.files); }} />

    <header className="topbar">
      <div className="brand"><Box size={20} /><strong>ModelCheck 3D</strong><span className="app-version">0.8</span></div>
      <div className="header-actions">
        <button className="button secondary help-button" onClick={() => setHelp(true)}><CircleHelp size={16} />Pomoc</button>
        <button className="button primary" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Upload size={16} />Wczytaj STL</button>
      </div>
    </header>

    <main className="workspace">
      <aside className="objects panel" aria-label="Lista elementów">
        <div className="panel-heading"><h2>Obiekty</h2><span className="count">{parts.length}</span></div>
        <label className="panel-search"><Search size={17} /><input aria-label="Szukaj elementu" placeholder="Szukaj elementu…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <p className="selection-hint">LPM: zaznacz. PPM: otwórz menu poleceń.</p>
        <div className="object-list">
          {!parts.length && <p className="empty-note">Wczytane pliki STL pojawią się tutaj.</p>}
          {parts.filter(part => part.name.toLowerCase().includes(search.toLowerCase())).map(part => {
            const visible = part.visible && (!isolated || isolated.includes(part.id));
            return <div key={part.id} className={`object-row ${selected.includes(part.id) ? 'selected' : ''} ${activePartId === part.id ? 'active-part' : ''} ${!visible ? 'muted' : ''}`} data-selection={activePartId === part.id ? 'active' : selected.includes(part.id) ? 'selected' : 'idle'}
              onContextMenu={event => {
                event.preventDefault();
                setObjectMenu({ id: part.id, x: event.clientX, y: event.clientY, trigger: event.currentTarget.querySelector<HTMLButtonElement>('.object-select') });
              }}
              onKeyDown={event => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                    setObjectMenu({ id: part.id, x: bounds.left + 20, y: bounds.bottom, trigger: event.currentTarget.querySelector<HTMLButtonElement>('.object-select') });
                }
              }}>

              <button className="object-select" aria-pressed={selected.includes(part.id)} aria-current={activePartId === part.id ? 'true' : undefined} onClick={event => select(part.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                <span className="part-swatch" style={{ background: partColor(part.id, selected, activePartId) }} /><span title={part.name}>{part.name}{duplicateName(part)}</span>
                {!part.solid && <span className="warning-text" title="Siatka wymaga weryfikacji">!</span>}
              </button>
              <button className="icon-button visibility-button" title={`${visible ? 'Ukryj' : 'Pokaż'} ${part.name}`} onClick={() => toggleVisibility(part)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
            </div>;
          })}
          {parts.length > 0 && !parts.some(part => part.name.toLowerCase().includes(search.toLowerCase())) && <p className="empty-note">Nie znaleziono elementu.</p>}
        </div>
        <div className="selection-tools">
          <p className="active-object" title={parts.find(part => part.id === activePartId)?.name}>Aktywny: {parts.find(part => part.id === activePartId)?.name ?? '—'}</p>
          <div className="selection-summary"><strong>Zaznaczone: {selected.length}</strong><button className="text-button" disabled={!parts.length} onClick={() => setSelection(previous => ({ ...previous, ids: parts.map(part => part.id) }))}>Zaznacz wszystkie</button></div>
          <button className="button secondary wide" disabled={!selected.length} onClick={fitSelected}><Focus size={18} />Izoluj wybrane</button>
          <button className="button secondary wide" disabled={!parts.length} onClick={showAll}><Eye size={18} />Pokaż cały model</button>
          {selected.length > 0 && <button className="text-button wide" onClick={() => { setSelection(previous => ({ ...previous, ids: [] })); setActivePair(null); }}>Odznacz wszystkie</button>}
        </div>
      </aside>

      <section className="center" aria-label="Analiza i widok 3D">
        <section className="analysis-panel">
          <div className="analysis-controls">
            <button className="button primary analyze-button" disabled={busy || !session || parts.length < 2} onClick={() => void analyze()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{job?.state === 'running' && job.check === 'RELATIONS' ? 'Sprawdzanie…' : 'Sprawdź powiązania'}</button>
            <button className="button secondary" disabled={busy || !session || parts.length < 2} onClick={() => void analyze('INTERSECTIONS')}><ScanLine size={16} />{job?.state === 'running' && job.check === 'INTERSECTIONS' ? 'Sprawdzanie…' : 'Sprawdź intersekcje'}</button><span className="analysis-scope-note">Cały model, także ukryte obiekty</span>
          </div>
          <div className="analysis-result">
            <label className={`intersection-toggle ${intersections ? 'enabled' : ''}`}><input type="checkbox" checked={intersections && intersectionsReady} disabled={!intersectionsReady} onChange={event => setIntersections(event.target.checked)} /><span>Pokaż intersekcje</span></label>
            <span className="analysis-heading">{job?.state === 'running' ? `${job.completed} / ${job.total} par` : job?.state === 'done' ? job.check === 'INTERSECTIONS' ? `Intersekcje sprawdzone: ${intersectionCount}` : 'Powiązania znalezione' : 'Najpierw sprawdź powiązania.'}</span>
          </div>
          {job?.state === 'running' && <progress aria-label="Postęp analizy" max={job.total} value={job.completed} />}
        </section>

        <div className="viewport">
          <div className="viewport-toolbar">
          <div className="scene-label"><Box size={17} /><strong>{isolated ? 'Wybrane elementy' : 'Cały model'}</strong><span>Widoczne: {parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).length}/{parts.length}</span></div>
          <div className="view-controls"><button className="floor-toggle" aria-label="Podłoga" aria-pressed={floor} title="Pokaż lub ukryj siatkę podłogi i osie" onClick={() => setFloor(value => !value)}><Grid2X2 size={15} />Podłoga</button><button title="Dopasuj kamerę do widocznych części" onClick={() => viewer.current?.fit()}><Maximize size={17} />Dopasuj widok</button><div className="axis-controls"><button title="Widok z przodu" onClick={() => viewer.current?.view('y')}>Przód</button><button title="Widok z góry" onClick={() => viewer.current?.view('z')}>Góra</button><button title="Widok perspektywiczny" onClick={() => viewer.current?.view('perspective')}>3D</button></div></div>
          </div>
          <Viewer ref={viewer} session={session} parts={parts} relations={relations} selected={selected} activePartId={activePartId} isolated={isolated} intersections={intersections && intersectionsReady} floor={floor} onSelect={select} onError={setError} onLoaded={setLoaded} />
          {!parts.length && <div className="welcome"><h1>Brak modelu</h1><p>Wczytaj pliki STL lub przeciągnij je do okna.</p><button className="button primary" disabled={busy || !session} onClick={() => fileInput.current?.click()}>Wybierz pliki STL</button><button className="text-button" disabled={busy || !session} onClick={() => void demo()}>Wypróbuj przykład A / B / C</button></div>}
          {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={17} className="spin" />Wczytywanie widoku 3D: {loaded}/{parts.length}</div>}
          {isolated && <button className="exit-isolation button secondary" onClick={showAll}><ArrowLeft size={17} />Wróć do całego modelu</button>}
          {intersections && intersectionsReady && <p className="view-legend"><span />Czerwony obszar = intersekcja</p>}
          <div className="camera-hint"><span><b>Obrót:</b> środkowy przycisk</span><span><b>Przesuwanie:</b> Shift + środkowy</span><span><b>Zoom:</b> kółko</span></div>
        </div>
      </section>

      <aside className="checklist panel" aria-label="Powiązania i kontrole">
        <div className="result-tabs" role="tablist" aria-label="Wyniki modelu" onKeyDown={event => {
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
          const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
          if (next >= 0) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
        }}>
          <button id="relations-tab" role="tab" aria-selected={panelTab === 'relations'} aria-controls="relations-panel" tabIndex={panelTab === 'relations' ? 0 : -1} onClick={() => setPanelTab('relations')}>Powiązania</button>
          <button id="checks-tab" role="tab" aria-selected={panelTab === 'checks'} aria-controls="checks-panel" tabIndex={panelTab === 'checks' ? 0 : -1} onClick={() => setPanelTab('checks')}>Kontrole</button>
        </div>
        <section id="relations-panel" className="result-panel" role="tabpanel" aria-labelledby="relations-tab" hidden={panelTab !== 'relations'}>
          <div className="checklist-intro"><p>Każda para jest pokazana raz. „Pokaż parę” dopasowuje tylko kamerę.</p></div>
          <div className="checklist-content pair-list">
            {relatedPairs.map(({ relation: row, parts: pair }) => {
              const name = (part: Part | undefined) => part ? part.name + duplicateName(part) : 'Usunięty element';
              const visible = pair.every(part => part?.visible && (!isolated || isolated.includes(part.id)));
              return <div className={`relation-row ${activePair === row.id ? 'active' : ''}`} key={row.id}>
                <div className="pair-names"><span title={name(pair[0])}>{name(pair[0])}</span><span className="pair-connector">↔</span><span title={name(pair[1])}>{name(pair[1])}</span></div>
                <div className="pair-actions"><span className={`relation-kind ${row.kind === 'UNCERTAIN' || intersectionsReady ? row.kind.toLowerCase() : 'connected'}`}>{row.kind === 'UNCERTAIN' || intersectionsReady ? labels[row.kind] : 'Powiązanie'}</span><button className="button" aria-label={`Pokaż parę ${name(pair[0])} i ${name(pair[1])}`} title={visible ? 'Dopasuj kamerę bez zaznaczania i ukrywania części' : 'Najpierw pokaż obie części na lewej liście'} disabled={!visible} onClick={() => focusPair(row)}><Focus size={14} />Pokaż parę</button></div>
              </div>;
            })}
            {!relations.some(row => row.kind !== 'DISCONNECTED') && <p className="empty-note">{!parts.length ? 'Wczytaj model, aby sprawdzić powiązania.' : parts.length === 1 ? 'Brak innych elementów.' : relations.length === parts.length * (parts.length - 1) / 2 ? 'Brak powiązań z innymi elementami.' : 'Uruchom „Sprawdź powiązania”, aby zobaczyć listę par.'}</p>}
          </div>
        </section>
        <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={panelTab !== 'checks'}>
          <div className="checklist-intro"><p>Wszystkie elementy modelu. Kontrole pojawiają się dopiero po ich uruchomieniu.</p>{tasks.length > 0 && <div className="review-progress"><span><strong>{reviewed} / {tasks.length}</strong> kontroli wykonanych</span><div className="review-meter" aria-hidden="true"><span style={{ width: `${reviewed / tasks.length * 100}%` }} /></div></div>}</div>
          <div className="checklist-content">
            {!parts.length && <p className="empty-note">Wczytane elementy pojawią się tutaj.</p>}
            {parts.map(part => <section className="check-part" key={part.id} id={`check-${part.id}`}>
              <div className="check-part-heading"><strong title={part.name}>{part.name}{duplicateName(part)}</strong></div>
              <div className="part-checks">
                {!tasks.some(task => task.part_id === part.id) && <p className="no-checks">Nie uruchomiono kontroli.</p>}
                {tasks.filter(task => task.part_id === part.id).map(task => <div className="check-task" key={task.id}>
                  <p className={task.stale || task.result === 'UNCERTAIN' ? 'task-warning' : ''}>{taskResult(task)}</p>
                  <div className="task-line"><label><input type="checkbox" aria-label={`Intersekcje: ${part.name} — sprawdzone`} checked={task.done} disabled={busy || task.stale} onChange={event => void reviewTask(task, event.target.checked, task.note)} />Intersekcje sprawdzone</label><button className="text-button" aria-label={`Szczegóły kontroli ${part.name}`} onClick={() => setActiveTaskId(task.id)}>Szczegóły</button></div>
                </div>)}
              </div>
            </section>)}
          </div>
          {activeTask && activeTaskPart && <TaskCard task={activeTask} part={activeTaskPart} disabled={!!busy} onReview={(done, note) => void reviewTask(activeTask, done, note)} onClose={() => setActiveTaskId(null)} />}
        </section>
      </aside>
    </main>

    <footer className="statusbar"><span role="status">{busy ? 'Przetwarzanie…' : notice || 'Gotowy do pracy'}</span><span>{parts.length} elementów · {connectedCount} powiązań{uncertainCount > 0 ? ` · ${uncertainCount} do weryfikacji` : ''}</span><span className="session-note">Dane tylko w bieżącej sesji</span></footer>
    {objectMenu && parts.some(part => part.id === objectMenu.id) && <ObjectMenu menu={objectMenu} name={parts.find(part => part.id === objectMenu.id)!.name} disabled={!!busy} onClose={() => setObjectMenu(null)} onActivate={() => { setSelection(previous => ({ ...previous, activeId: objectMenu.id })); setObjectMenu(null); }} onDelete={() => void removePart(objectMenu.id)} />}
    {error && <div className="error-message" role="alert"><TriangleAlert size={20} /><span>{error}</span><button className="icon-button" title="Zamknij komunikat" onClick={() => setError('')}><X size={20} /></button></div>}
    {dragging && <div className="drop-overlay"><h2>Upuść pliki STL</h2><p>Każdy plik to osobny element modelu.</p></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="Jak obsługiwać aplikację" onClick={event => event.stopPropagation()}><button className="icon-button close-modal" title="Zamknij pomoc" onClick={() => setHelp(false)}><X size={22} /></button><h2>Jak sprawdzić model?</h2><ol><li>Wczytaj osobne pliki STL. Elementy pozostają w oryginalnym położeniu.</li><li>Kliknij <strong>Sprawdź powiązania</strong>. Zakładka „Powiązania” pokaże listę par bez zaznaczania części w 3D.</li><li>Kliknij <strong>Sprawdź intersekcje</strong>. Powstaną zadania do ręcznego odhaczenia przy każdym elemencie. Przełącznik <strong>Pokaż intersekcje</strong> zmienia tylko widoczność wyniku.</li><li>Powiązania są informacyjne. Przycisk „Pokaż parę” dopasowuje tylko kamerę, bez zaznaczania i ukrywania części. Obie części muszą być widoczne. W osobnej zakładce „Kontrole” odhaczasz uruchomione kontrole; szczegóły zawierają notatkę.</li></ol><h3>Sterowanie jak w Blenderze</h3><dl><dt>Środkowy przycisk myszy</dt><dd>Obrót</dd><dt>Shift + środkowy przycisk</dt><dd>Przesuwanie</dd><dt>Kółko</dt><dd>Zoom</dd><dt>Shift + klik</dt><dd>Wybór wielu części</dd></dl><p>Przycisk „Podłoga” nad widokiem 3D ukrywa siatkę i osie. Nie zmienia położenia ani wyników analizy modelu.</p><p>Analiza zawsze obejmuje wszystkie wczytane części, także ukryte. Zaznaczenie i izolacja zmieniają tylko widok.</p><p>LPM zaznacza części. PPM na lewej liście otwiera menu. Polecenie „Aktywuj” aktywuje obiekt i oznacza go beżowo także w 3D. Inne zaznaczone części są zielone, pozostałe szare.</p><p>Powiązanie oznacza, że części bezpośrednio się łączą. Intersekcja oznacza, że jedna część wchodzi w drugą. O poprawności decydujesz sam.</p><div className="help-note"><CircleAlert size={20} /><span>Pracujemy w milimetrach. Odświeżenie strony usuwa bieżącą sesję; zapis projektu nie jest jeszcze dostępny.</span></div><button className="button primary wide" onClick={() => setHelp(false)}>Rozumiem</button></section></div>}
  </div>;
}
