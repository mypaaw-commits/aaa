import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Boxes, Check, ChevronDown, ChevronRight, CircleAlert, Eye, EyeOff, Focus, HelpCircle, Layers3, ListChecks, LoaderCircle, Maximize, Play, Plus, Search, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import { api, labels, number, palette } from './types';
import type { Job, Part, Relation } from './types';
import './style.css';

type Imported = { parts: Omit<Part, 'color' | 'visible'>[]; errors: { name: string; message: string }[] };
const statusLabel = { TODO: 'Do sprawdzenia', OK: 'OK', FIX: 'Wymaga poprawki' };
function ReviewCard({ relation, parts, disabled, onReview, onClose }: { relation: Relation; parts: Part[]; disabled: boolean; onReview: (status: Relation['status'], note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(relation.note);
  useEffect(() => { setNote(relation.note); }, [relation.id, relation.note]);
  const names = relation.part_ids.map(id => parts.find(part => part.id === id)?.name ?? '?').sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
  return <section className="review-card" aria-label="Kontrola wybranej pary">
    <div className="review-heading"><h3>Kontrola pary</h3><button className="icon-button" title="Zamknij ocenę" onClick={onClose}><X size={18} /></button></div>
    <p className="pair-names">{names[0]} <span>↔</span> {names[1]}</p>
    <p className={`result-banner ${relation.kind.toLowerCase()}`}>{relation.kind === 'CONNECTED' ? 'Powiązane — bez intersekcji' : labels[relation.kind]}</p>
    {relation.kind === 'UNCERTAIN' && <p className="result-explanation">{relation.message}</p>}
    <label className="field-label" htmlFor="review-status">Twoja ocena</label>
    <select id="review-status" disabled={disabled} value={relation.status} onChange={event => onReview(event.target.value as Relation['status'], note)}>
      {(['TODO', 'OK', 'FIX'] as const).map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}
    </select>
    <label className="field-label" htmlFor="note">Notatka</label>
    <textarea id="note" disabled={disabled} maxLength={5000} placeholder="Dodaj uwagę do tej pary…" value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== relation.note) onReview(relation.status, note); }} />
    <p className="microcopy">Ocena i notatka są wspólne dla obu elementów.</p>
  </section>;
}

export default function App() {
  const [session, setSession] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [isolated, setIsolated] = useState<string[] | null>(null);
  const [activePair, setActivePair] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [intersections, setIntersections] = useState(false);
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
          else setNotice(`Sprawdzono par: ${result.job.total}. Czas: ${number(result.job.seconds, 2)} s.`);
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
    setLoading(true); setError(''); setNotice('');
    try {
      await reviewQueue.current;
      const result = await api<Job>(`/sessions/${session}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part_ids: scope === 'selected' ? selected : null }) });
      // Always poll once: a small model can finish before POST returns.
      setJob({ ...result, state: 'running' });
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  function select(id: string | null, multi: boolean) {
    setActivePair(null);
    if (!id) { if (!multi) setSelected([]); return; }
    if (isolated && !isolated.includes(id)) setIsolated(null);
    setExpanded(previous => new Set([...previous, id]));
    requestAnimationFrame(() => document.getElementById(`check-${id}`)?.scrollIntoView({ block: 'nearest' }));
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
      await reviewQueue.current;
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

  function toggleVisibility(part: Part) {
    const visible = part.visible && (!isolated || isolated.includes(part.id));
    setParts(previous => previous.map(item => item.id === part.id ? { ...item, visible: !visible } : item));
    if (!visible && isolated && !isolated.includes(part.id)) setIsolated([...isolated, part.id]);
  }
  const intersectionCount = relations.filter(row => row.kind === 'INTERSECTION').length;
  const connectedCount = relations.filter(row => row.kind === 'CONNECTED' || row.kind === 'INTERSECTION').length;
  const uncertainCount = relations.filter(row => row.kind === 'UNCERTAIN').length;

  return <div className="app"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(event.dataTransfer.files); }}>
    <input type="file" ref={fileInput} accept=".stl" multiple hidden onChange={event => { if (event.target.files) void importFiles(event.target.files); }} />

    <header className="topbar">
      <div className="brand"><Boxes size={27} /><strong>ModelCheck <span>3D</span></strong></div>
      <span className="app-purpose">Powiązania części i intersekcje</span>
      <div className="header-actions">
        <button className="button secondary help-button" onClick={() => setHelp(true)}><HelpCircle size={18} />Jak obsługiwać?</button>
        <button className="button primary" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Plus size={18} />Wczytaj STL</button>
      </div>
    </header>

    <main className="workspace">
      <aside className="objects panel" aria-label="Lista elementów">
        <div className="panel-heading"><h2><Layers3 size={19} />Elementy</h2><span className="count">{parts.length}</span></div>
        <label className="panel-search"><Search size={17} /><input aria-label="Szukaj elementu" placeholder="Szukaj elementu…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <p className="selection-hint">Kliknij element. Shift + klik dodaje kolejne.</p>
        <div className="object-list">
          {!parts.length && <p className="empty-note">Wczytane pliki STL pojawią się tutaj.</p>}
          {parts.filter(part => part.name.toLowerCase().includes(search.toLowerCase())).map(part => {
            const visible = part.visible && (!isolated || isolated.includes(part.id));
            return <div key={part.id} className={`object-row ${selected.includes(part.id) ? 'selected' : ''} ${!visible ? 'muted' : ''}`}>
              <button className="object-select" aria-pressed={selected.includes(part.id)} onClick={event => select(part.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                <span className="part-swatch" style={{ background: part.color }} /><span title={part.name}>{part.name}{duplicateName(part)}</span>
                {!part.solid && <TriangleAlert size={15} className="warning-text" aria-label="Siatka wymaga weryfikacji" />}
              </button>
              <button className="icon-button visibility-button" title={`${visible ? 'Ukryj' : 'Pokaż'} ${part.name}`} onClick={() => toggleVisibility(part)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</button>
              <button className="icon-button remove-button" title={`Usuń ${part.name}`} disabled={busy} onClick={() => void removePart(part.id)}><Trash2 size={16} /></button>
            </div>;
          })}
          {parts.length > 0 && !parts.some(part => part.name.toLowerCase().includes(search.toLowerCase())) && <p className="empty-note">Nie znaleziono elementu.</p>}
        </div>
        <div className="selection-tools">
          <div className="selection-summary"><strong>Zaznaczone: {selected.length}</strong><button className="text-button" disabled={!parts.length} onClick={() => setSelected(parts.map(part => part.id))}>Zaznacz wszystkie</button></div>
          <button className="button secondary wide" disabled={!selected.length} onClick={fitSelected}><Focus size={18} />Izoluj wybrane</button>
          <button className="button secondary wide" disabled={!parts.length} onClick={showAll}><Eye size={18} />Pokaż cały model</button>
          {selected.length > 0 && <button className="text-button wide" onClick={() => { setSelected([]); setActivePair(null); }}>Odznacz wszystkie</button>}
        </div>
      </aside>

      <section className="center" aria-label="Analiza i widok 3D">
        <section className="analysis-panel">
          <div className="analysis-controls">
            <label className="scope-control"><span>Zakres sprawdzania</span><select aria-label="Zakres sprawdzania" value={scope} disabled={busy} onChange={event => setScope(event.target.value as 'all' | 'selected')}><option value="all">Cały model</option><option value="selected">Zaznaczone ({selected.length})</option></select></label>
            <button className="button primary analyze-button" disabled={busy || !session || (scope === 'all' ? parts.length : selected.length) < 2} onClick={() => void analyze()}>{busy ? <LoaderCircle size={18} className="spin" /> : <Play size={17} />}{job?.state === 'running' ? 'Sprawdzanie…' : 'Sprawdź powiązania'}</button>
          </div>
          <p className="scope-hint">{scope === 'all' ? 'Sprawdza wszystkie elementy, również ukryte.' : 'Sprawdza zaznaczone elementy tylko między sobą.'}</p>
          <div className="analysis-result">
            <label className={`intersection-toggle ${intersections ? 'enabled' : ''}`}><input type="checkbox" checked={intersections} disabled={!parts.length} onChange={event => setIntersections(event.target.checked)} /><span>Pokaż intersekcje</span></label>
            <span className="analysis-heading">{job?.state === 'running' ? `${job.completed} / ${job.total} par` : job?.state === 'done' ? `Analiza zakończona · intersekcje: ${intersectionCount}` : 'Najpierw sprawdź powiązania.'}</span>
          </div>
          {job?.state === 'running' && <progress aria-label="Postęp analizy" max={job.total} value={job.completed} />}
        </section>

        <div className="viewport">
          <Viewer ref={viewer} session={session} parts={parts} relations={overlayRelations} selected={selected} isolated={isolated} intersections={intersections} onSelect={select} onError={setError} onLoaded={setLoaded} />
          <div className="scene-label"><Box size={17} /><strong>{isolated ? 'Wybrane elementy' : 'Cały model'}</strong><span>Widoczne: {parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).length}/{parts.length}</span></div>
          <div className="view-controls"><button title="Dopasuj kamerę do widocznych części" onClick={() => viewer.current?.fit()}><Maximize size={17} />Dopasuj widok</button><div className="axis-controls"><button title="Widok z przodu" onClick={() => viewer.current?.view('y')}>Przód</button><button title="Widok z góry" onClick={() => viewer.current?.view('z')}>Góra</button><button title="Widok perspektywiczny" onClick={() => viewer.current?.view('perspective')}>3D</button></div></div>
          {!parts.length && <div className="welcome"><Boxes size={48} strokeWidth={1.3} /><h1>Wczytaj części modelu</h1><p>Wybierz pliki STL, aby zobaczyć model<br />i sprawdzić powiązania między elementami.</p><button className="button primary" disabled={busy || !session} onClick={() => fileInput.current?.click()}><Upload size={19} />Wybierz pliki STL</button><button className="text-button" disabled={busy || !session} onClick={() => void demo()}>Wypróbuj przykład A / B / C</button><small>Możesz też przeciągnąć pliki do okna.</small></div>}
          {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={17} className="spin" />Wczytywanie widoku 3D: {loaded}/{parts.length}</div>}
          {isolated && <button className="exit-isolation button secondary" onClick={showAll}><ArrowLeft size={17} />Wróć do całego modelu</button>}
          {intersections && <p className="view-legend"><span />Czerwony obszar = intersekcja</p>}
          <div className="camera-hint"><span><b>Obrót:</b> środkowy przycisk</span><span><b>Przesuwanie:</b> Shift + środkowy</span><span><b>Zoom:</b> kółko</span></div>
        </div>
      </section>

      <aside className="checklist panel" aria-label="Powiązania i checklista">
        <div className="panel-heading"><h2><ListChecks size={20} />Powiązania i checklista</h2></div>
        <div className="checklist-intro"><p>Wybierz parę, aby obejrzeć ją w 3D i oznaczyć wynik kontroli.</p><div className="review-progress"><strong>{reviewed} / {relevant.length}</strong> par sprawdzonych</div></div>
        <div className="checklist-content">
          {!parts.length && <p className="empty-note">Tutaj znajdziesz wszystkie wczytane elementy i ich powiązania.</p>}
          {parts.map(part => {
            const all = relations.filter(row => row.part_ids.includes(part.id));
            const otherName = (row: Relation) => parts.find(item => item.id === row.part_ids.find(id => id !== part.id))?.name ?? '';
            const rows = all.filter(row => row.kind !== 'DISCONNECTED').sort((a, b) => otherName(a).localeCompare(otherName(b), 'pl', { numeric: true }));
            const complete = all.length === parts.length - 1;
            const isExpanded = expanded.has(part.id);
            return <section className={`check-part ${selected.includes(part.id) ? 'highlight' : ''}`} key={part.id} id={`check-${part.id}`}>
              <button className="check-part-heading" onClick={() => toggleExpanded(part.id)} aria-expanded={isExpanded}>
                <span className="part-swatch" style={{ background: part.color }} /><strong title={part.name}>{part.name}{duplicateName(part)}</strong>{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              {isExpanded && <div className="check-part-relations">
                {rows.length > 0 && <p className="relation-list-label">{rows.some(row => row.kind === 'UNCERTAIN') ? 'Powiązania i pary do weryfikacji:' : 'Powiązany z:'}</p>}
                {rows.map(row => {
                  const other = parts.find(item => item.id === row.part_ids.find(id => id !== part.id));
                  return <button key={row.id} className={`relation-row ${activePair === row.id ? 'active' : ''}`} onClick={() => focusPair(row)}>
                    <div className="relation-title"><strong title={other?.name}>{other?.name}{other ? duplicateName(other) : ''}</strong><span className={`relation-kind ${row.kind.toLowerCase()}`}>{labels[row.kind]}</span></div>
                    <div className={`review-status ${row.status.toLowerCase()}`}>{row.status === 'OK' ? <Check size={15} /> : row.status === 'FIX' ? <TriangleAlert size={15} /> : <span className="status-circle" />}{statusLabel[row.status]}<ChevronRight size={16} /></div>
                  </button>;
                })}
                {!rows.length && <p className="no-relations">{parts.length === 1 ? 'Brak innych elementów.' : complete ? 'Brak powiązań z innymi elementami.' : all.length ? 'Brak powiązań w sprawdzonej grupie.' : 'Uruchom sprawdzanie powiązań.'}</p>}
                {rows.length > 0 && !complete && <p className="partial-analysis">Pozostałe pary nie zostały jeszcze sprawdzone.</p>}
              </div>}
            </section>;
          })}
        </div>
        {active && <ReviewCard relation={active} parts={parts} disabled={busy} onReview={(status, note) => void review(active, status, note)} onClose={() => setActivePair(null)} />}
      </aside>
    </main>

    <footer className="statusbar"><span role="status">{busy ? 'Przetwarzanie…' : notice || 'Gotowy do pracy'}</span><span>{parts.length} elementów · {connectedCount} powiązań{uncertainCount > 0 ? ` · ${uncertainCount} do weryfikacji` : ''}</span><span className="session-note">Dane tylko w bieżącej sesji</span></footer>
    {error && <div className="error-message" role="alert"><TriangleAlert size={20} /><span>{error}</span><button className="icon-button" title="Zamknij komunikat" onClick={() => setError('')}><X size={20} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={48} /><h2>Upuść pliki STL</h2><p>Każdy plik to osobny element modelu.</p></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="Jak obsługiwać aplikację" onClick={event => event.stopPropagation()}><button className="icon-button close-modal" title="Zamknij pomoc" onClick={() => setHelp(false)}><X size={22} /></button><h2>Jak sprawdzić model?</h2><ol><li>Wczytaj osobne pliki STL. Elementy pozostają w oryginalnym położeniu.</li><li>Kliknij <strong>Sprawdź powiązania</strong>. Lista po prawej pokaże, które części są ze sobą powiązane.</li><li>Włącz <strong>Pokaż intersekcje</strong>, aby zobaczyć na czerwono miejsca przenikania.</li><li>Kliknij powiązaną część na checkliście. Obejrzysz parę w 3D, wybierzesz ocenę i dodasz notatkę.</li></ol><h3>Sterowanie jak w Blenderze</h3><dl><dt>Środkowy przycisk myszy</dt><dd>Obrót</dd><dt>Shift + środkowy przycisk</dt><dd>Przesuwanie</dd><dt>Kółko</dt><dd>Zoom</dd><dt>Shift + klik</dt><dd>Wybór wielu części</dd></dl><p>Analiza całego modelu obejmuje także ukryte części. Wybrany zakres porównuje tylko zaznaczone części między sobą.</p><p>Powiązanie oznacza, że części bezpośrednio się łączą. Intersekcja oznacza, że jedna część wchodzi w drugą. O poprawności decydujesz sam.</p><div className="help-note"><CircleAlert size={20} /><span>Pracujemy w milimetrach. Odświeżenie strony usuwa bieżącą sesję; zapis projektu nie jest jeszcze dostępny.</span></div><button className="button primary wide" onClick={() => setHelp(false)}>Rozumiem</button></section></div>}
  </div>;
}
