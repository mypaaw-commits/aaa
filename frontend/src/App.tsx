import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Box, Boxes, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleAlert, Crosshair, Eye, EyeOff, Focus, Grid2X2, Layers3, ListChecks, LoaderCircle, Maximize, MousePointer2, Play, Plus, RotateCcw, ScanLine, Search, Settings2, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import { api, labels, number, palette } from './types';
import type { Job, Part, Relation } from './types';
import './style.css';

type Imported = { parts: Omit<Part, 'color' | 'visible'>[]; errors: { name: string; message: string }[] };
const statusLabel = { TODO: 'Do sprawdzenia', OK: 'OK', FIX: 'Wymaga poprawki' };
function measurement(relation: Relation) {
  if (relation.kind === 'INTERSECTION') return `${number(relation.volume ?? 0)} mm³`;
  if (relation.kind === 'CONTACT') return '~0 mm';
  if (relation.distance !== null) return `${number(relation.distance)} mm`;
  return relation.kind === 'DISCONNECTED' ? 'poza progiem' : 'wynik niepewny';
}

function ReviewCard({ relation, parts, disabled, onReview }: { relation: Relation; parts: Part[]; disabled: boolean; onReview: (status: Relation['status'], note: string) => void }) {
  const [note, setNote] = useState(relation.note);
  useEffect(() => { setNote(relation.note); }, [relation.id, relation.note]);
  const names = relation.part_ids.map(id => parts.find(part => part.id === id)?.name ?? '?');
  return <div className="review-card">
    <div className="eyebrow">WYBRANE POŁĄCZENIE</div>
    <h3 title={names.join(' ↔ ')}>{names[0]} <span>↔</span> {names[1]}</h3>
    <div className={`result-banner ${relation.kind.toLowerCase()}`}><span className="dot" />{labels[relation.kind]}<strong>{measurement(relation)}</strong></div>
    {relation.message && <p className="result-explanation">{relation.message}</p>}
    {relation.kind === 'GAP' && <p className="result-explanation">Pomarańczowy znacznik wskazuje najbliższe punkty powierzchni, a nie cały obszar szczeliny.</p>}
    <label className="field-label">Twoja ocena połączenia</label>
    <div className="review-actions">{(['TODO', 'OK', 'FIX'] as const).map(status => <button key={status} disabled={disabled} className={`${relation.status === status ? 'active' : ''} ${status.toLowerCase()}`} onClick={() => onReview(status, note)}>{status === 'OK' ? <Check size={14} /> : status === 'FIX' ? <TriangleAlert size={13} /> : <Circle size={12} />}{statusLabel[status]}</button>)}</div>
    <label className="field-label" htmlFor="note">Notatka</label>
    <textarea id="note" disabled={disabled} maxLength={5000} placeholder="Co warto sprawdzić w tym połączeniu?" value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== relation.note) onReview(relation.status, note); }} />
    <p className="microcopy">Ocena ręczna • wspólna dla obu elementów</p>
  </div>;
}

export default function App() {
  const [session, setSession] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [isolated, setIsolated] = useState<string[] | null>(null);
  const [activePair, setActivePair] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [gap, setGap] = useState('0.1');
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [checkSearch, setCheckSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('all');
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [intersections, setIntersections] = useState(false);
  const [gaps, setGaps] = useState(false);
  const [contacts, setContacts] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const viewer = useRef<ViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const reviewQueue = useRef<Promise<void>>(Promise.resolve());
  const busy = loading || job?.state === 'running';
  const relevant = relations.filter(relation => relation.kind !== 'DISCONNECTED');
  const reviewed = relevant.filter(relation => relation.status !== 'TODO').length;
  const active = relations.find(relation => relation.id === activePair);
  const overlayRelations = scope === 'all' ? relations : relations.filter(relation => relation.part_ids.every(id => selected.includes(id)));

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
        const result = await api<{ job: Job; relations: Relation[] }>(`/sessions/${session}/analysis`);
        if (stopped) return;
        setJob(result.job);
        if (result.job.state === 'running') timer = setTimeout(poll, 400);
        else {
          setRelations(result.relations);
          if (result.job.state === 'error') setError(result.job.error ?? 'Analiza nie powiodła się.');
          else setNotice(`Analiza zakończona: ${result.job.total} unikalnych par · ${number(result.job.seconds, 2)} s.`);
        }
      } catch (err) {
        if (!stopped) { setError((err as Error).message); setJob(previous => previous ? { ...previous, state: 'error' } : null); }
      }
    };
    timer = setTimeout(poll, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, job?.id, job?.state]);

  const addImported = (result: Imported) => {
    setParts(previous => [...previous, ...result.parts.map((part, i) => ({ ...part, color: palette[(previous.length + i) % palette.length], visible: true }))]);
    setExpanded(previous => new Set([...previous, ...result.parts.map(part => part.id)]));
    if (result.errors.length) setError(result.errors.map(item => `${item.name}: ${item.message}`).join('\n'));
    if (result.parts.length) setNotice(`Wczytano ${result.parts.length} ${result.parts.length === 1 ? 'część' : 'części'}. Współrzędne STL zostały zachowane.`);
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
      const result = await api<Imported>(`/sessions/${session}/parts`, { method: 'POST', body: form });
      addImported(result);
      if (duplicates && result.parts.length) setNotice('Wczytano części. Powtarzające się nazwy oznaczono numerem na liście; każda część ma osobny identyfikator.');
    } catch (err) { setError((err as Error).message); setNotice(''); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function demo() {
    if (busy || !session) return;
    setLoading(true); setError('');
    try { addImported(await api<Imported>(`/sessions/${session}/demo`, { method: 'POST' })); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  async function analyze() {
    const threshold = Number(gap.replace(',', '.'));
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) { setError('Próg szczeliny musi wynosić od 0 do 10 mm.'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      await reviewQueue.current;
      const result = await api<Job>(`/sessions/${session}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gap: threshold, part_ids: scope === 'selected' ? selected : null }) });
      // Always poll once: a small model can finish before POST returns.
      setJob({ ...result, state: 'running' });
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  function select(id: string | null, multi: boolean) {
    setActivePair(null);
    if (!id) { if (!multi) setSelected([]); return; }
    if (isolated && !isolated.includes(id)) setIsolated(null);
    setSelected(previous => multi ? previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id] : [id]);
  }
  function focusPair(relation: Relation) {
    setActivePair(relation.id); setSelected(relation.part_ids); setIsolated(relation.part_ids);
    setParts(previous => previous.map(part => relation.part_ids.includes(part.id) ? { ...part, visible: true } : part));
    requestAnimationFrame(() => viewer.current?.fit(relation.part_ids));
  }
  function showAll() { setIsolated(null); setParts(previous => previous.map(part => ({ ...part, visible: true }))); }
  async function removePart(id: string) {
    setLoading(true);
    try {
      await api(`/sessions/${session}/parts/${id}`, { method: 'DELETE' });
      setParts(previous => previous.filter(part => part.id !== id));
      setRelations(previous => previous.filter(relation => !relation.part_ids.includes(id)));
      setSelected(previous => previous.filter(pid => pid !== id));
      setIsolated(null); setActivePair(null); setLoaded(previous => Math.max(0, previous - 1));
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  function review(relation: Relation, status: Relation['status'], note: string) {
    // Serialize note blur and status clicks so a slower response cannot revert a newer edit.
    reviewQueue.current = reviewQueue.current.then(async () => {
    try {
      await api(`/sessions/${session}/relations/${relation.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, note }) });
      setRelations(previous => previous.map(row => row.id === relation.id ? { ...row, status, note } : row));
    } catch (err) { setError((err as Error).message); }
    });
    return reviewQueue.current;
  }
  const toggleExpanded = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const duplicateName = (part: Part) => parts.filter(other => other.name === part.name).length > 1 ? ` · ${parts.indexOf(part) + 1}` : '';
  const fitSelected = () => { if (selected.length) { setIsolated(selected); setParts(previous => previous.map(part => selected.includes(part.id) ? { ...part, visible: true } : part)); requestAnimationFrame(() => viewer.current?.fit(selected)); } };

  return <div className="app" onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <input type="file" ref={fileInput} accept=".stl" multiple hidden onChange={event => { if (event.target.files) void importFiles(event.target.files); }} />
    <header className="topbar">
      <a href="#" className="brand" onClick={event => event.preventDefault()} aria-label="ModelCheck 3D"><span className="brand-icon"><Boxes size={23} /></span><span>modelcheck<span className="brand-3d">3D</span></span></a>
      <span className="header-divider" /><div className="project-title">Przestrzeń robocza <span>PROTOTYP 0.1</span></div>
      <div className="header-right"><span className="local-indicator"><span />Lokalnie · bez zapisu</span><button className="icon-button" title="Sterowanie i informacje" onClick={() => setHelp(!help)}><Settings2 size={18}/></button><button className="button primary import-header" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Plus size={16} />Importuj STL</button></div>
    </header>
    <div className="workspace-toolbar"><div className="breadcrumb"><Box size={15} /><span>Projekt bez nazwy</span><ChevronRight size={13} /><strong>Kontrola połączeń</strong></div><span className="units">Jednostki <b>mm</b><span className="small-divider" />Geometria nieruchoma</span></div>
    <main className="workspace">
      <aside className="objects panel">
        <div className="panel-heading"><h2><Layers3 size={16} />Obiekty <span className="count">{parts.length}</span></h2><button className="icon-button" title="Dodaj pliki STL" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Plus size={17}/></button></div>
        <div className="panel-search"><Search size={14}/><input aria-label="Szukaj obiektu" placeholder="Szukaj obiektu…" value={search} onChange={event => setSearch(event.target.value)} /><kbd>STL</kbd></div>
        <div className="tree-heading"><ChevronDown size={13}/><Boxes size={14}/><span>Elementy modelu</span><span>{parts.length}</span></div>
        <div className="object-list">
          {!parts.length && <div className="object-empty"><Box size={28}/><p>Tu pojawią się Twoje części</p><span>Zaimportuj osobne pliki STL</span></div>}
          {parts.filter(part => part.name.toLowerCase().includes(search.toLowerCase())).map(part => <div key={part.id} className={`object-row ${selected.includes(part.id) ? 'selected' : ''} ${!part.visible || (isolated && !isolated.includes(part.id)) ? 'muted' : ''}`} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') select(part.id, event.shiftKey); }} onClick={event => select(part.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
            <Box size={15} style={{ color: part.color }} /><span className="object-name" title={part.name}>{part.name}{duplicateName(part)}</span>{!part.solid && <span title="Siatka nie jest poprawną zamkniętą bryłą"><TriangleAlert size={12} className="warning-text"/></span>}
            <button className="icon-button visibility-button" title={part.visible ? `Ukryj ${part.name}` : `Pokaż ${part.name}`} onClick={event => { event.stopPropagation(); setParts(previous => previous.map(item => item.id === part.id ? { ...item, visible: !item.visible } : item)); }}>{part.visible && (!isolated || isolated.includes(part.id)) ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
            <button className="icon-button remove-button" title={`Usuń ${part.name}`} disabled={busy} onClick={event => { event.stopPropagation(); void removePart(part.id); }}><Trash2 size={13}/></button>
          </div>)}
          {parts.length > 0 && !parts.some(part => part.name.toLowerCase().includes(search.toLowerCase())) && <p className="subtle-empty">Brak pasujących obiektów.</p>}
        </div>
        <div className="object-actions"><button className="button quiet" disabled={!parts.length} onClick={() => setSelected(parts.map(part => part.id))}><CheckCheck size={14}/>Zaznacz wszystkie</button><button className="icon-button" title="Odznacz wszystkie" disabled={!selected.length} onClick={() => { setSelected([]); setActivePair(null); }}><X size={15}/></button></div>
        <div className="selection-info"><span className="eyebrow">ZAZNACZENIE</span><strong>{selected.length ? `${selected.length} ${selected.length === 1 ? 'element' : 'elementów'}` : 'Brak zaznaczenia'}</strong><p>Shift + klik, aby wybrać kilka części.</p><button className="button secondary wide" disabled={!selected.length} onClick={fitSelected}><Focus size={15}/>Izoluj zaznaczenie</button><button className="text-button" disabled={!parts.length} onClick={showAll}><Eye size={14}/>Pokaż wszystkie</button></div>
        <div className="import-card"><ArrowDownToLine size={18}/><div><strong>Dodaj części modelu</strong><span>Przeciągnij STL do okna</span></div><button className="icon-button" disabled={busy || !session} title="Wybierz pliki" onClick={() => fileInput.current?.click()}><Plus size={17}/></button></div>
      </aside>
      <section className="center">
        <div className="viewport-top"><div><span className="live-dot"/><strong>Widok 3D</strong><span className="view-label">Perspektywa</span></div><div><button className={`icon-button ${wireframe ? 'active' : ''}`} title="Przełącz widok siatki" aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}><Grid2X2 size={16}/></button><button className="icon-button" title="Dopasuj kamerę do widocznych części" onClick={() => viewer.current?.fit()}><Maximize size={16}/></button></div></div>
        <div className="viewport">
          <Viewer ref={viewer} session={session} parts={parts} relations={overlayRelations} selected={selected} isolated={isolated} intersections={intersections} gaps={gaps} contacts={contacts} wireframe={wireframe} onSelect={select} onError={setError} onLoaded={setLoaded}/>
          <div className="scene-label"><Box size={13}/>{isolated ? 'Izolacja części' : 'Cały model'}<span>{parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).length} widocznych</span></div>
          <div className="axis-controls"><button className="axis-z" title="Widok z góry" onClick={() => viewer.current?.view('z')}>Z</button><div><button className="axis-y" title="Widok z przodu" onClick={() => viewer.current?.view('y')}>Y</button><button className="axis-x" title="Widok z boku" onClick={() => viewer.current?.view('x')}>X</button></div><button className="axis-perspective" title="Widok perspektywiczny" onClick={() => viewer.current?.view('perspective')}><Box size={13}/></button></div>
          {!parts.length && <div className="welcome"><div className="welcome-symbol"><Boxes size={39} strokeWidth={1}/></div><span className="eyebrow">OD MODELU DO PEWNEGO POŁĄCZENIA</span><h1>Każda część.<br/><span>Każde połączenie.</span></h1><p>Wczytaj części modelu i sprawdź,<br/>jak pasują do siebie w przestrzeni.</p><button className="button primary" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Upload size={16}/>Wczytaj pliki STL</button><button className="text-button demo-button" disabled={busy || !session} onClick={() => void demo()}>lub wypróbuj model A / B / C <ChevronRight size={14}/></button><span className="welcome-note">Wiele plików · do 100 MB na plik · jednostki mm</span></div>}
          {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={14} className="spin"/>Przygotowywanie widoku 3D… {loaded}/{parts.length}</div>}
          {isolated && <button className="exit-isolation button secondary" onClick={showAll}><ArrowLeft size={14}/>Wróć do całego modelu</button>}
          <div className="viewport-tools"><button className="icon-button active" title="Zaznaczanie: klik lub Shift + klik"><MousePointer2 size={17}/></button><span/><button className="icon-button" title="Dopasuj kamerę" onClick={() => viewer.current?.fit()}><Crosshair size={17}/></button><button className="icon-button" title="Przywróć widok perspektywiczny" onClick={() => viewer.current?.view('perspective')}><RotateCcw size={16}/></button></div>
          <div className="view-legend">{intersections && <span><i className="red"/>Wspólna objętość</span>}{gaps && <span><i className="orange"/>Najbliższe punkty szczeliny</span>}{contacts && <span><i className="teal"/>Punkt styku</span>}</div>
          <div className="camera-hint"><span>ŚPM <b>Obrót</b></span><span>Shift + ŚPM <b>Przesuwanie</b></span><span>Kółko <b>Zoom</b></span></div>
        </div>
        <section className="analysis-panel"><div className="analysis-heading"><h2><ScanLine size={17}/>Analiza połączeń</h2><span>{job?.state === 'running' ? 'Analizowanie…' : job?.state === 'done' ? 'Analiza zakończona' : 'Uruchamiana na żądanie'}</span></div>
          <div className="analysis-controls"><div className="scope-control"><span className="field-label">Zakres analizy</span><div className="segmented"><button disabled={busy} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}><Boxes size={14}/>Cały model</button><button disabled={busy} className={scope === 'selected' ? 'active' : ''} onClick={() => setScope('selected')}><MousePointer2 size={13}/>Zaznaczone <span>{selected.length}</span></button></div></div><label className="gap-control"><span className="field-label">Próg szczeliny</span><span className="number-input"><input aria-label="Próg szczeliny w milimetrach" inputMode="decimal" value={gap} disabled={busy} onChange={event => setGap(event.target.value)}/><span>mm</span></span></label><button className="button primary analyze-button" disabled={busy || !session || (scope === 'all' ? parts.length : selected.length) < 2} onClick={() => void analyze()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Play size={15}/>} {job?.state === 'running' ? 'Analizowanie' : 'Analizuj połączenia'}</button></div>
          {job?.state === 'running' && <div className="analysis-progress"><div><span style={{ width: `${job.total ? job.completed / job.total * 100 : 0}%` }}/></div><span>{job.completed} / {job.total} par</span></div>}
          <div className="overlays"><span>Pokaż w widoku</span><button className={`toggle-chip intersection ${intersections ? 'enabled' : ''}`} aria-pressed={intersections} onClick={() => setIntersections(!intersections)}><span className="toggle-switch"/>Intersekcje <small>{relations.filter(row => row.kind === 'INTERSECTION').length}</small></button><button className={`toggle-chip gap ${gaps ? 'enabled' : ''}`} aria-pressed={gaps} onClick={() => setGaps(!gaps)}><span className="toggle-switch"/>Szczeliny <small>{relations.filter(row => row.kind === 'GAP').length}</small></button><button className={`toggle-chip contact ${contacts ? 'enabled' : ''}`} aria-pressed={contacts} onClick={() => setContacts(!contacts)}><span className="toggle-switch"/>Styki <small>{relations.filter(row => row.kind === 'CONTACT').length}</small></button></div>
        </section>
      </section>
      <aside className="checklist panel"><div className="panel-heading"><h2><ListChecks size={17}/>Checklista</h2><span className="count">{parts.length}</span></div><div className="checklist-intro"><h3>Kontrola elementów</h3><p>Wszystkie części. Twoja ocena połączeń.</p><div className="review-progress"><span>Sprawdzone pary <strong>{reviewed}<span> / {relevant.length}</span></strong></span><div><i style={{ width: `${relevant.length ? reviewed / relevant.length * 100 : 0}%` }}/></div></div></div>
        <div className="checklist-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Wszystkie</button><button className={filter === 'TODO' ? 'active' : ''} onClick={() => setFilter('TODO')}>Do sprawdzenia</button><button className={filter === 'FIX' ? 'active' : ''} onClick={() => setFilter('FIX')}>Poprawki</button></div>
        <div className="panel-search checklist-search"><Search size={14}/><input aria-label="Szukaj na checkliście" placeholder="Szukaj elementu…" value={checkSearch} onChange={event => setCheckSearch(event.target.value)}/></div>
        <div className="checklist-content">
          {!parts.length && <div className="checklist-empty"><ListChecks size={30} strokeWidth={1.2}/><h3>Wszystko na swoim miejscu</h3><p>Po imporcie zobaczysz tu każdy element. Analiza uzupełni listę jego połączeń.</p><span><Circle size={10}/> Czeka na pierwszy model</span></div>}
          {parts.filter(part => part.name.toLowerCase().includes(checkSearch.toLowerCase())).map(part => {
            const all = relations.filter(row => row.part_ids.includes(part.id));
            const rows = all.filter(row => (showDisconnected || row.kind !== 'DISCONNECTED') && (filter === 'all' || row.status === filter));
            const isExpanded = expanded.has(part.id);
            return <div className={`check-part ${selected.includes(part.id) ? 'highlight' : ''}`} key={part.id}><button className="check-part-heading" onClick={() => toggleExpanded(part.id)}>{isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<span className="part-swatch" style={{ background: part.color }}/><strong title={part.name}>{part.name}{duplicateName(part)}</strong><span className="count">{all.filter(row => row.kind !== 'DISCONNECTED').length}</span></button>
              {isExpanded && <div className="check-part-relations">{!rows.length && <p className="no-relations">{!all.length ? 'Oczekuje na analizę' : filter !== 'all' ? 'Brak par z tym statusem' : 'Brak połączeń w wybranym progu'}</p>}{rows.map(row => {
                const other = parts.find(item => item.id === row.part_ids.find(id => id !== part.id));
                return <button key={row.id} className={`relation-row ${activePair === row.id ? 'active' : ''}`} onClick={() => focusPair(row)}><span className={`relation-dot ${row.kind.toLowerCase()}`}/><div><strong title={other?.name}>↔ {other?.name}{other ? duplicateName(other) : ''}</strong><span>{labels[row.kind]} <i>·</i> {measurement(row)}</span></div><span className={`review-status ${row.status.toLowerCase()}`} title={statusLabel[row.status]}>{row.status === 'OK' ? <Check size={13}/> : row.status === 'FIX' ? <TriangleAlert size={13}/> : <Circle size={12}/>}</span></button>;
              })}</div>}
            </div>;
          })}
        </div>
        {active && <ReviewCard relation={active} parts={parts} disabled={busy} onReview={(status, note) => void review(active, status, note)} />}
        <label className="show-disconnected"><input type="checkbox" checked={showDisconnected} onChange={event => setShowDisconnected(event.target.checked)}/>Pokaż także pary bez kontaktu</label>
        <div className="checklist-footer"><CircleAlert size={14}/><span>Wynik analizy nie zastępuje Twojej oceny.</span></div>
      </aside>
    </main>
    <footer className="statusbar"><span><span className={`status-dot ${busy ? 'working' : ''}`}/>{busy ? 'Przetwarzanie' : parts.length ? 'Gotowy do kontroli' : 'Gotowy do importu'}</span><span>{parts.length} części <i>·</i> {number(parts.reduce((sum, part) => sum + part.faces, 0), 0)} trójkątów <i>·</i> {relations.length} przeanalizowanych par</span><span className="status-right">ModelCheck 3D <b>0.1</b></span></footer>
    {(error || notice) && <div className={`notification ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <TriangleAlert size={17}/> : loading ? <LoaderCircle size={17} className="spin"/> : <Check size={17}/>}<span>{error || notice}</span><button className="icon-button" title="Zamknij komunikat" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={44}/><h2>Upuść pliki STL</h2><p>Każdy plik zostanie osobnym elementem modelu.</p></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="Obsługa prototypu" onClick={event => event.stopPropagation()}><button className="icon-button close-modal" title="Zamknij" onClick={() => setHelp(false)}><X size={20}/></button><div className="eyebrow">MODELCHECK 3D · PROTOTYP</div><h2>Twoja przestrzeń kontroli</h2><p>Importuj osobne STL w położeniu montażowym. Przyjmujemy 1 jednostkę = 1 mm. Program nie przesuwa ani nie skaluje części.</p><dl><dt>Środkowy przycisk myszy</dt><dd>Obrót kamery</dd><dt>Shift + środkowy przycisk</dt><dd>Przesuwanie widoku</dd><dt>Kółko myszy</dt><dd>Przybliżanie</dd><dt>Klik / Shift + klik</dt><dd>Zaznaczenie / wiele części</dd><dt>Dwuklik w widoku</dt><dd>Dopasowanie kamery</dd></dl><p>Analiza „Cały model” obejmuje także ukryte części. „Zaznaczone” sprawdza wybrane części wyłącznie między sobą.</p><p>Intersekcje pokazują czerwoną bryłę wspólnej objętości. Szczeliny i styki mają znaczniki najbliższych punktów. Przy intersekcjach części stają się przezroczyste.</p><p>Domyślny próg szczelin: 0,1 mm. Tolerancja numeryczna styku: 0,00001 mm; nie stanowi tolerancji produkcyjnej. Nieprawidłowe siatki wymagają ręcznej weryfikacji.</p><div className="help-note"><CircleAlert size={17}/>Dane są tylko w bieżącej sesji. Odświeżenie strony rozpoczyna nowy projekt; restart serwera usuwa wszystkie sesje.</div><button className="button primary wide" onClick={() => setHelp(false)}>Rozumiem</button></section></div>}
  </div>;
}
