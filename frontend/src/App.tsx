import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Grid2X2, Layers2, Languages, ScanLine, Upload, Eye, LoaderCircle, Maximize, Search, SquareDashedMousePointer, BoxSelect, TriangleAlert, FolderPlus, FolderUp, Ruler, X } from 'lucide-react';
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
import { api } from './types';
import { folderPath } from './objectTree';
import type { AnalysisResult, CheckTask, Job, Part, Relation, Folder } from './types';
import type { ColourMode } from './SurfaceMap';
import './style.css';

type Imported = { parts: Omit<Part, 'visible'>[]; errors: { name: string; message: string }[]; folders?: Folder[] };
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
  const [tool, setTool] = useState<'intersections' | 'thickness'>('intersections');
  const [thicknessColours, setThicknessColours] = useState(true);
  const colourMode: ColourMode = tool === 'intersections' ? 'fit' : thicknessColours ? 'thickness' : 'solid';
  const [folders,setFolders]=useState<Folder[]>([]);
  const [activeFolder,setActiveFolder]=useState<string|null>(null);
  const importStarted=useRef(0);
  const [importSeconds,setImportSeconds]=useState(0);
  const [importProgress,setImportProgress]=useState<{name:string;stage:string;completed:number;total:number}|null>(null);
  const [minimumThickness, setMinimumThickness] = useState(.5);
  const [scope, setScope] = useState<'all' | 'visible'>('all');
  const savedMinimum = useRef(.5);
  const displayMinimum=Number.isFinite(minimumThickness)&&minimumThickness>=.01&&minimumThickness<=10?minimumThickness:savedMinimum.current;
  const minimumQueue = useRef<Promise<void>>(Promise.resolve());
  const reviewVersions = useRef(new Map<string, number>());
  const [floor, setFloor] = useState(true);
  const [projection, setProjection] = useState<Projection>('perspective');
  const [cameraView, setCameraView] = useState<CameraView | null>('isometric');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const importTargets=useRef(new WeakMap<File,string|null>());
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [objectMenu, setObjectMenu] = useState<ObjectMenuState | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const reviewQueue = useRef<Promise<void>>(Promise.resolve());
  const reviewSaveFailed = useRef(false);
  const busy = loading || exporting || job?.state === 'running';
  const intersectionsReady = tasks.some(task => task.check === 'INTERSECTIONS' && !task.stale);

  function focusThickness(id:string,point?:number[]|null){
    setSelected([id]);setIsolated([id]);setParts(previous=>previous.map(part=>part.id===id?{...part,visible:true}:part));setTool('thickness');setPanelTab('thickness');setThicknessColours(true);
    requestAnimationFrame(()=>point?viewer.current?.focusPoint(point,Math.max(.15,minimumThickness*1.5)):viewer.current?.fit([id]));
  }
  async function createFolder(parent:string|null){
    const name=window.prompt(t('folderName'),t('newFolder'));if(!name)return;
    try{const folder=await api<Folder>(`/sessions/${session}/folders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent_id:parent})});setFolders(previous=>[...previous,folder]);setActiveFolder(folder.id);setObjectMenu(null);}catch(err){setError((err as Error).message);}
  }
  async function renameFolder(id:string){
    const folder=folders.find(folder=>folder.id===id);if(!folder)return;const name=window.prompt(t('folderName'),folder.name);if(!name)return;
    try{const updated=await api<Folder>(`/sessions/${session}/folders/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent_id:folder.parent_id})});setFolders(previous=>previous.map(item=>item.id===id?updated:item));setObjectMenu(null);}catch(err){setError((err as Error).message);}
  }
  async function moveParts(ids:string[],target:string|null){
    if(busy)return;
    try{await api(`/sessions/${session}/parts-folder`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({part_ids:ids,folder_id:target})});setParts(previous=>previous.map(part=>ids.includes(part.id)?{...part,folder_id:target}:part));setObjectMenu(null);}catch(err){setError((err as Error).message);}
  }
  async function moveFolder(id:string,parent:string|null){
    if(busy)return;const folder=folders.find(folder=>folder.id===id);if(!folder)return;
    try{const updated=await api<Folder>(`/sessions/${session}/folders/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:folder.name,parent_id:parent})});setFolders(previous=>previous.map(item=>item.id===id?updated:item));setObjectMenu(null);}catch(err){setError((err as Error).message);}
  }
  async function deleteFolder(id:string){
    if(busy)return;
    try{const result=await api<{folders:Folder[];removed_parts:string[]}>(`/sessions/${session}/folders/${id}`,{method:'DELETE'});setFolders(result.folders);setParts(previous=>previous.filter(part=>!result.removed_parts.includes(part.id)));setSelected(previous=>previous.filter(pid=>!result.removed_parts.includes(pid)));setActiveFolder(null);setObjectMenu(null);setIsolated(null);if(result.removed_parts.length){setRelations(previous=>previous.filter(row=>!row.part_ids.some(pid=>result.removed_parts.includes(pid))));setTasks((await api<AnalysisResult>(`/sessions/${session}/analysis`)).tasks);setJob(null);setIntersections(false);}}catch(err){setError((err as Error).message);}
  }
  function toggleFolderVisibility(ids:string[]){
    const show=parts.filter(part=>ids.includes(part.id)).some(part=>!part.visible||!!isolated&&!isolated.includes(part.id));setIsolated(null);setParts(previous=>previous.map(part=>ids.includes(part.id)?{...part,visible:show}:part));
  }
  useEffect(()=>{
    if(!loading||!session||!importStarted.current)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const abort=new AbortController();
    const poll=async()=>{
      try{const data=await api<{name:string;stage:string;completed:number;total:number}|null>(`/sessions/${session}/import-status`,{signal:abort.signal});if(!stopped)setImportProgress(data);}catch{}
      if(!stopped)timer=setTimeout(poll,700);
    };
    timer=setTimeout(poll,250);
    const clock=setInterval(()=>setImportSeconds(Math.floor((Date.now()-importStarted.current)/1000)),1000);
    return()=>{stopped=true;clearTimeout(timer);clearInterval(clock);abort.abort();setImportProgress(null);};
  },[loading,session]);

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
          if (result.job.state === 'done' && result.job.check !== 'THICKNESS') setIntersections(true);
          if (result.job.state === 'error') setError(result.job.error ?? 'Analiza nie powiodła się.');
          else if (result.job.state === 'cancelled') setNotice({ key: 'analysisCancelled' });
          else setNotice({ key: result.job.check === 'THICKNESS' ? 'thicknessFinished' : 'analysisFinished', values: { count: result.job.total, seconds: result.job.seconds.toFixed(2) } });
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
    if(result.folders)setFolders(result.folders);
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
  function queueImport(files: FileList | File[], target=activeFolder) {
    const incoming = Array.from(files);
    for(const file of incoming)importTargets.current.set(file,target);
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
    importStarted.current=Date.now();setImportSeconds(0);
    setLoading(true); setError(''); setNotice({ key: 'importing' });
    try {
      const form = new FormData(); const valid: File[] = [];
      const destination=importTargets.current.get(files[0])??null;if(destination)form.append('parent_folder_id',destination);
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.stl')) throw new Error('Wybierz pliki w formacie STL.');
        if (file.size > 1024 * 1024 * 1024) throw new Error(`${file.name}: Maximum STL size is 1 GiB.`);
        valid.push(file); form.append('files', file, file.webkitRelativePath || file.name);
      }
      const duplicates = valid.some(file => parts.some(part => part.name === file.name)) || new Set(valid.map(file => file.name)).size < valid.length;
      await marginQueue.current;
      await reviewQueue.current;
      if(valid.reduce((total,file)=>total+file.size,0)>64*1024*1024||valid.some(file=>(importTargets.current.get(file)??null)!==destination)){
        for(const file of valid){const single=new FormData();const target=importTargets.current.get(file);if(target)single.append('parent_folder_id',target);single.append('files',file,file.webkitRelativePath||file.name);await addImported(await api<Imported>(`/sessions/${session}/parts`,{method:'POST',body:single}));}
      }else await addImported(await api<Imported>(`/sessions/${session}/parts`, { method: 'POST', body: form }));
      const result = {parts:valid};
      if (duplicates && result.parts.length) setNotice({ key: 'duplicates' });
    } catch (err) { setError((err as Error).message); setNotice(null); }
    finally { setLoading(false); }
  }
  async function analyze() {
    importStarted.current=0;
    setLoading(true); setError(''); setNotice(null);
    try {
      if(tool==='intersections')await saveMargin();
      if(tool==='thickness')await saveMinimum();
      await reviewQueue.current;
      const result = await api<Job>(`/sessions/${session}/analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: tool === 'thickness' ? 'THICKNESS' : 'INTERSECTIONS', ...(scope === 'visible' ? { part_ids: parts.filter(part => part.visible && (!isolated || isolated.includes(part.id))).map(part => part.id) } : {}) }) });
      // Always poll once: a small model can finish before POST returns.
      setJob({ ...result, state: 'running' });
      setPanelTab(tool === 'thickness' ? 'thickness' : 'checks');
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
    const destination=parts.find(part=>part.id===target)?.folder_id??null;
    if((parts.find(part=>part.id===id)?.folder_id??null)!==destination){if(busy)return;void moveParts([id],destination);}
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
  const listedParts = parts.filter(part => (part.name+' '+folderPath(folders,part.folder_id)).toLowerCase().includes(search.toLowerCase()));
  const intersectionCount = relations.filter(row => row.kind === 'INTERSECTION').length;
  const fitCount = relations.filter(row => row.kind === 'WITHIN_TOLERANCE').length;
  const connectedCount = relations.filter(row => ['CONNECTED', 'INTERSECTION', 'WITHIN_TOLERANCE'].includes(row.kind)).length;


  return <div className="app"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => event.preventDefault()}
    onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); queueImport(event.dataTransfer.files); }}>
    <input type="file" ref={directoryInput} multiple hidden {...{webkitdirectory:'',directory:''}} onChange={event=>{if(event.target.files)queueImport(Array.from(event.target.files).filter(file=>file.name.toLowerCase().endsWith('.stl')));event.currentTarget.value='';}} />
    <input type="file" ref={fileInput} accept=".stl" multiple hidden onChange={event => { if (event.target.files) queueImport(event.target.files); }} />
    <header className="topbar">
      <div className="brand"><Box size={20} /><strong>ModelCheck <span>3D</span></strong><span className="app-version">0.27</span></div>
      <div className="header-actions">
        <label className="language-picker" title={t('language')}><Languages size={16} /><select aria-label={t('language')} value={language} onChange={event => setLanguage(event.target.value as 'en' | 'pl')}><option value="en">English</option><option value="pl">Polski</option></select></label>
        <span className="import-queue" aria-live="polite">{queuedFiles.length > 0 ? t('importQueued', { count: queuedFiles.length }) : ''}</span>
        <button className="button" disabled={!session} onClick={()=>directoryInput.current?.click()}><FolderUp size={16}/>{t('importFolder')}</button>
        <button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={16} />{t('import')}</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="objects panel" aria-label={t('objects')}>
        <div className="panel-heading"><h2><Box size={15} />{t('objects')}</h2><span className="count">{parts.length}</span></div>
        <section className="analysis-panel">
          <div className="tool-tabs" role="group" aria-label={t('analysisTool')}>
            <button aria-label={t('intersectionTool')} aria-pressed={tool==='intersections'} onClick={()=>{setTool('intersections');setPanelTab('checks');}}><ScanLine size={15}/>{t('intersections')}</button>
            <button aria-label={t('thicknessTool')} aria-pressed={tool==='thickness'} onClick={()=>{setTool('thickness');setPanelTab('thickness');}}><Ruler size={15}/>{t('thicknessMap')}</button>
          </div>
          <label className="tool-label">{t('analysisScope')}<select aria-label={t('analysisScope')} value={scope} disabled={!!busy} onChange={event=>setScope(event.target.value as 'all'|'visible')}><option value="all">{t('allParts')}</option><option value="visible">{t('visibleParts')}</option></select></label>
          {tool==='intersections'?<>
            <label className="fit-margin" title={t('marginHelp')}><span>{t('fitMarginLabel')}</span><input aria-label={t('fitMarginInput')} inputMode="decimal" value={marginDraft} disabled={!!busy||savingMargin||!session} onChange={event=>setMarginDraft(event.target.value)} onBlur={()=>{void saveMargin().catch(err=>setError(err.message));}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/><span>mm</span></label>
            <input className="analysis-slider" type="range" aria-label={t('fitSlider')} min="0" max={Math.max(.1,fitTolerance??.001)} step="0.0001" value={Number(marginDraft.replace(',','.'))||0} disabled={!!busy} onChange={event=>setMarginDraft(event.target.value)} onPointerUp={event=>{void saveMargin(event.currentTarget.value).catch(err=>setError(err.message));}} onKeyUp={event=>{void saveMargin(event.currentTarget.value).catch(err=>setError(err.message));}}/>
            <label className="intersection-toggle"><input type="checkbox" checked={intersections&&intersectionsReady} disabled={!intersectionsReady} onChange={event=>setIntersections(event.target.checked)}/><span>{t('showIntersections')}</span></label>
          </>:<div className="wall-settings">
            <label>{t('minimumThickness')}<input type="number" aria-label={t('minimumThickness')} min="0.01" max="10" step="0.01" value={minimumThickness} disabled={!!busy} onChange={event=>setMinimumThickness(Number(event.target.value))} onBlur={()=>{void saveMinimum().catch(err=>setError(err.message));}}/> mm</label>
            <input className="analysis-slider" type="range" aria-label={t('thicknessSlider')} min="0.01" max={Math.max(5,minimumThickness)} step="0.01" value={minimumThickness} disabled={!!busy} onChange={event=>setMinimumThickness(Number(event.target.value))} onPointerUp={event=>{void saveMinimum(Number(event.currentTarget.value)).catch(err=>setError(err.message));}} onKeyUp={event=>{void saveMinimum(Number(event.currentTarget.value)).catch(err=>setError(err.message));}}/>
            <label className="analysis-option"><input type="checkbox" checked={thicknessColours} onChange={event=>setThicknessColours(event.target.checked)}/>{t('showThicknessColours')}</label><p>{t('thicknessMethod')}</p>
          </div>}
          <div className="analysis-controls">
            <button className="button analyze-button" disabled={!!busy||!session||parts.filter(part=>scope==='all'||part.visible&&(!isolated||isolated.includes(part.id))).length<(tool==='thickness'?1:2)} onClick={()=>void analyze()}>{job?.state==='running'?<LoaderCircle size={16} className="spin"/>:tool==='thickness'?<Ruler size={16}/>:<ScanLine size={16}/>} {t(job?.state==='running'?'analyzing':tool==='thickness'?'measureThickness':'analyze')}</button>
            {job?.state==='running'&&<button className="button" disabled={job.stage==='stopping'} onClick={()=>void stopAnalysis()}><X size={15}/>{t('stopAnalysis')}</button>}
          </div>
          {job?.state==='running'&&<><p className="analysis-stage" role="status">{t(`stage_${job.stage??'bounds'}`)} · {job.seconds.toFixed(0)} s</p><progress aria-label={t('analysisProgress')} max={Math.max(job.stage==='thickness'?job.surface_total??1:job.total,1)} value={job.stage==='thickness'?job.surface_done??0:job.completed}/></>}
          {job?.state==='done'&&job.check!=='THICKNESS'&&<span className="analysis-heading">{t(intersectionCount===1?'intersectionsFoundOne':'intersectionsFound',{count:intersectionCount})}{fitCount>0&&` · ${t('withinToleranceCount',{count:fitCount})}`}</span>}
          {job?.state==='done'&&relations.some(row=>row.kind==='UNCERTAIN')&&<p className="analysis-stage analysis-warning">{t(relations.filter(row=>row.kind==='UNCERTAIN').length===1?'uncertainSummaryOne':'uncertainSummary',{count:relations.filter(row=>row.kind==='UNCERTAIN').length})}</p>}
          {loading&&importStarted.current>0&&<p className="analysis-stage" role="status">{importProgress?`${importProgress.name} · ${t('import_'+importProgress.stage as TextKey)}${importProgress.total>0?` · ${Math.round(100*importProgress.completed/importProgress.total)}%`:''}`:t('importing')} · {importSeconds} s</p>}
        </section>
        <ObjectList inventory={parts} onRenameFolder={id=>void renameFolder(id)} onDeleteFolder={id=>void deleteFolder(id)} onFileDrop={(files,target)=>queueImport(files,target)} folders={folders} searching={!!search} activeFolder={activeFolder} onActiveFolder={setActiveFolder} onMoveParts={(ids,target)=>void moveParts(ids,target)} onMoveFolder={(id,target)=>void moveFolder(id,target)} onFolderVisibility={toggleFolderVisibility} parts={listedParts} selected={selected} isolated={isolated} nameSuffix={duplicateName} onMenu={setObjectMenu} onDelete={ids => void removeParts(ids)} onVisibility={toggleVisibility} onReorder={reorderPart}
          onChange={ids => { setSelected(ids); if(ids.length)setActiveFolder(parts.find(part=>part.id===ids[0])?.folder_id??null); setActivePair(null); if (isolated && ids.some(id => !isolated.includes(id))) setIsolated(null); }} />
        <div className="object-tools">
          {searchOpen && <label className="object-search"><Search size={16} /><input autoFocus aria-label={t('search')} placeholder={t('searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); setSearch(''); } }} /></label>}
          <div className="object-tool-rail" role="toolbar" aria-label={t('objects')}>
            <button className="icon-button" title={t('newFolder')} disabled={!!busy} onClick={()=>void createFolder(activeFolder)}><FolderPlus size={18}/></button>
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
            <Viewer ref={viewer} session={session} parts={parts} relations={relations} selected={selected} transparent={transparent} isolated={isolated} intersections={tool==='intersections' && intersections && intersectionsReady} floor={floor} projection={projection} colourMode={colourMode} fitTolerance={fitTolerance ?? .001} minimumThickness={displayMinimum} thicknessIds={tasks.filter(task => !!task.thickness && !task.stale).map(task => task.part_id)} onViewChange={setCameraView} onSelect={select} onError={setError} onLoaded={setLoaded} />
            {!parts.length && <div className="welcome"><h1>{t('noModel')}</h1><p>{t('importHint')}</p><button className="button primary" disabled={!session} onClick={() => fileInput.current?.click()}><Upload size={17} />{t('chooseFiles')}</button></div>}
            {parts.length > 0 && loaded < parts.length && <div className="geometry-loading"><LoaderCircle size={17} className="spin" />{t('loadingGeometry', { count: loaded, total: parts.length })}</div>}
            {isolated && <button className="exit-isolation button" onClick={showAll}><ArrowLeft size={16} />{t('back')}</button>}
            {tool==='intersections'&&intersections&&intersectionsReady&&<div className="rainbow-legend"><strong>{t('intersections')}</strong><div className="fit-gradient"/><div className="rainbow-labels"><span>{t('contact')}</span><span>{t('penetration')}</span></div></div>}
            {tool==='thickness'&&thicknessColours&&<div className="rainbow-legend"><strong>{t('thicknessMap')} · mm</strong><div className="thickness-gradient"/><div className="rainbow-labels"><span>0</span><span>≥{displayMinimum.toLocaleString(language)} mm</span></div><small>{t('whiteMinimum')} · {t('unknownGrey')}</small></div>}

          </div>
        </div>
      </section>
      <ResultsPanel onThickness={(id,point)=>focusThickness(id,point)} parts={parts} relations={relations} tasks={tasks} busy={!!busy||savingMargin} tab={panelTab} onTab={tab=>{setPanelTab(tab);if(tab!=='checklist')setTool(tab==='thickness'?'thickness':'intersections');}} inspected={activePair} onChoose={choosePair} onIsolate={isolatePair} onInspect={focusIntersection} exporting={exporting} onExport={exportChecklist} onReview={(task,done,note)=>void reviewTask(task,done,note)} name={part=>part.name+duplicateName(part)}/>

    </main>
    <footer className="statusbar"><span role="status">{busy ? t('processing') : notice ? t(notice.key, notice.values) : t('ready')}</span><span>{t('modelSummary', { parts: parts.length, pairs: connectedCount })}</span><span className="session-note">{t('sessionOnly')}</span></footer>
    {objectMenu&&(objectMenu.kind==='folder'?folders.some(folder=>folder.id===objectMenu.id):parts.some(part=>part.id===objectMenu.id))&&<ObjectMenu menu={objectMenu} folders={folders} name={objectMenu.kind==='folder'?folders.find(folder=>folder.id===objectMenu.id)!.name:parts.find(part=>part.id===objectMenu.id)!.name} count={menuIds.length} disabled={!!busy} onClose={()=>setObjectMenu(null)} onDelete={()=>objectMenu.kind==='folder'?void deleteFolder(objectMenu.id):void removeParts(menuIds)} onRename={()=>void renameFolder(objectMenu.id)} onNewFolder={()=>void createFolder(objectMenu.id)} onMove={target=>objectMenu.kind==='folder'?void moveFolder(objectMenu.id,target):void moveParts(menuIds,target)}/>}
    {error && <div className="error-message" role="alert"><TriangleAlert size={20} /><span>{localizeError(error, language)}</span><button className="icon-button" title={t('close')} onClick={() => setError('')}><X size={20} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={32} /><h2>{t('dropFiles')}</h2></div>}
  </div>;
}
