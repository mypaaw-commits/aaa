import { useState } from 'react';
import { BoxSelect, ChevronDown, ChevronRight, ClipboardCheck, Copy, Link2, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import type { CheckTask, Part, Relation } from './types';
import { useI18n } from './i18n';
import { PartChecklist } from './PartChecklist';

export type ResultsTab = 'checks' | 'thickness' | 'checklist';
type Props = {
  parts: Part[]; relations: Relation[]; tasks: CheckTask[]; busy: boolean;
  tab: ResultsTab; onTab: (tab: ResultsTab) => void; inspected: string | null;
  onThickness: (id: string, point?:number[]|null) => void; onChoose: (pair: Relation) => void;
  onInspect: (pair: Relation) => void; onIsolate: (pair: Relation) => void;
  exporting: boolean; onExport: () => Promise<void>;
  onReview: (task: CheckTask, done: boolean, note: string) => void; name: (part: Part) => string;
};

export function ResultsPanel({ parts, relations, tasks, busy, tab, onTab, inspected, onThickness, onChoose, onInspect, onIsolate, onReview, name, exporting, onExport }: Props) {
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const pairs = relations.filter(row => row.kind !== 'DISCONNECTED' && row.part_ids.every(id => tasks.some(task => task.part_id === id && task.check === 'INTERSECTIONS' && !task.stale)));
  const filters = [
    { id: 'all', label: 'allRelationships' as const, count: pairs.length },
    { id: 'INTERSECTION', label: 'intersections' as const, count: pairs.filter(row => row.kind === 'INTERSECTION').length },
    { id: 'CONNECTED', label: 'connections' as const, count: pairs.filter(row => row.kind === 'CONNECTED').length },
    { id: 'WITHIN_TOLERANCE', label: 'withinTolerance' as const, count: pairs.filter(row => row.kind === 'WITHIN_TOLERANCE').length },
    { id: 'UNCERTAIN', label: 'uncertain' as const, count: pairs.filter(row => row.kind === 'UNCERTAIN').length },
  ];
  const rows = pairs.filter(row => filter === 'all' || row.kind === filter);
  const measured=tasks.filter(task=>task.check==='THICKNESS'&&!task.stale&&task.thickness?.minimum!=null&&task.thickness?.maximum!=null);
  const overallMinimum=measured.reduce<CheckTask|null>((best,task)=>!best||task.thickness!.minimum!<best.thickness!.minimum!?task:best,null);
  const overallMaximum=measured.reduce<CheckTask|null>((best,task)=>!best||task.thickness!.maximum!>best.thickness!.maximum!?task:best,null);
  function pairRow(relation: Relation, owner: Part) {
    const other = parts.find(part => relation.part_ids.includes(part.id) && part.id !== owner.id);
    if (!other) return null;
    const pair = [owner, other].sort((a, b) => name(a).localeCompare(name(b), language, { numeric: true }));
    const kind = relation.coincident ? 'coincident' : relation.kind === 'UNCERTAIN' ? 'uncertain' : relation.kind === 'WITHIN_TOLERANCE' ? 'withinTolerance' : relation.kind === 'INTERSECTION' ? 'intersection' : 'connection';
    const Icon = relation.coincident ? Copy : relation.kind === 'UNCERTAIN' ? TriangleAlert : relation.kind === 'WITHIN_TOLERANCE' ? Ruler : relation.kind === 'INTERSECTION' ? ScanLine : Link2;
    const values = { a: name(pair[0]), b: name(pair[1]) };
    return <div className={`result-pair ${inspected === relation.id ? 'inspected' : ''}`} key={relation.id}>
      <span className={`pair-symbol ${kind}`} title={t(kind)}><Icon size={16} /></span>
      <button className="pair-files pair-select" aria-label={t('selectPair', values)} aria-pressed={inspected === relation.id} onClick={() => onChoose(relation)}><span title={name(other)}>{name(other)}</span><span className={`pair-status ${kind} ${relation.coincident ? 'coincident-label' : ''}`} title={relation.coincident ? t('coincidentTip') : undefined}>{t(kind)}</span></button>
      <div className="pair-actions"><button className="inspect-button" aria-label={t('inspectPair', values)} onClick={() => relation.kind === 'CONNECTED' ? onIsolate(relation) : onInspect(relation)}><BoxSelect size={15} /><span>{t('inspect')}</span></button></div>
      {relation.reason === 'COMPUTATION_LIMIT' && <p className="pair-explanation"><TriangleAlert size={13} />{t('computationLimit')}</p>}
    </div>;
  }
  return <aside className="checklist panel" aria-label={t('results')}>
    <div className="result-tabs" role="tablist" aria-label={t('results')} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowRight' ? (current + 1) % buttons.length : event.key === 'ArrowLeft' ? (current + buttons.length - 1) % buttons.length : -1;
      if (next >= 0) { event.preventDefault(); buttons[next].focus(); buttons[next].click(); }
    }}>
      <button id="checks-tab" role="tab" aria-selected={tab === 'checks'} aria-controls="checks-panel" tabIndex={tab === 'checks' ? 0 : -1} onClick={() => onTab('checks')}>{t('intersections')}</button>
      <button id="thickness-tab" role="tab" aria-selected={tab === 'thickness'} aria-controls="thickness-panel" tabIndex={tab === 'thickness'?0:-1} onClick={()=>onTab('thickness')}><Ruler size={14}/>{t('thicknessMap')}</button>
      <button id="checklist-tab" role="tab" aria-selected={tab === 'checklist'} aria-controls="checklist-panel" tabIndex={tab === 'checklist' ? 0 : -1} onClick={() => onTab('checklist')}><ClipboardCheck size={14} />{t('checklist')}</button>
    </div>
    <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={tab !== 'checks'}>
      <div className="result-filters" role="group" aria-label={t('resultFilter')}>{filters.filter(item => item.id === 'all' || item.id === 'INTERSECTION' || item.count > 0).map(item => <button key={item.id} aria-label={t(item.label)} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.label)}<span>{item.count}</span></button>)}</div>
      <div className="checks-scroll">
        {!tasks.some(task => task.check==='INTERSECTIONS'&&!task.stale) && <div className="results-empty"><ScanLine size={24} /><strong>{tasks.length ? t('stale') : t('noResults')}</strong><p>{t('runCheckHint')}</p></div>}
        {parts.map(part => {
          const priority: Record<string, number> = { UNCERTAIN: 0, INTERSECTION: 1, WITHIN_TOLERANCE: 2, CONNECTED: 3 };
          const otherName = (row: Relation) => { const other = parts.find(other => other.id !== part.id && row.part_ids.includes(other.id)); return other ? name(other) : ''; };
          const linked = rows.filter(row => row.part_ids.includes(part.id)).sort((a, b) => priority[a.kind] - priority[b.kind] || otherName(a).localeCompare(otherName(b), language, { numeric: true }));
          const task = tasks.find(task => task.part_id === part.id && task.check === 'INTERSECTIONS');
          const open = expanded === part.id;
          if (filter !== 'all' && !linked.length) return null;
          return <section className={`connection-group ${linked.some(row => row.kind === 'INTERSECTION') ? 'intersection-group' : ''} ${open ? 'expanded' : ''}`} key={part.id}>
            <button className="connection-group-toggle" aria-label={t('partResults', { name: name(part) })} aria-expanded={open} aria-controls={`part-results-${part.id}`} onClick={() => setExpanded(open ? null : part.id)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<strong title={name(part)}>{name(part)}</strong><span className="count">{task && !task.stale ? linked.length : '—'}</span></button>
            <div id={`part-results-${part.id}`} className="connection-children" hidden={!open}>{open && <>{linked.map(row => pairRow(row, part))}{!linked.length && <p className="empty-note compact">{task && !task.stale ? t('noConnections') : t('noResults')}</p>}</>}</div>
          </section>;
        })}

      </div>
    </section>
    <section id="thickness-panel" className="result-panel" role="tabpanel" aria-labelledby="thickness-tab" hidden={tab!=='thickness'}>
      <div className="result-section-heading"><h2>{t('thicknessDimensions')}</h2><span>mm</span></div>
      <div className="checks-scroll">
      {measured.length>1&&overallMinimum&&overallMaximum&&<section className="thickness-card thickness-overall"><h3>{t('measuredParts')}</h3><div className="thickness-metrics">{([{task:overallMinimum,field:'minimum',point:'minimum_location',label:'thinnest'},{task:overallMaximum,field:'maximum',point:'maximum_location',label:'thickest'}] as const).map(({task,field,point,label})=><button className="thickness-extreme" key={field} onClick={()=>onThickness(task.part_id,task.thickness![point])}><span>{t(label)}</span><strong>{task.thickness![field]!.toLocaleString(language,{maximumFractionDigits:4})} mm</strong><small>{parts.find(part=>part.id===task.part_id)?.name}</small><BoxSelect size={15}/></button>)}</div></section>}
      {parts.map(part=>{
        const task=tasks.find(task=>task.part_id===part.id&&task.check==='THICKNESS');
        const wall=task&&!task.stale?task.thickness:undefined;
        const mm=(value:number|null|undefined)=>value==null?'—':value.toLocaleString(language,{maximumFractionDigits:4})+' mm';
        return <section className={`thickness-card ${wall?.deficit?'thin':''}`} key={part.id}>
          <h3 title={name(part)}>{name(part)}</h3>
          {wall?<><div className="thickness-metrics">
            <button className="thickness-extreme minimum" disabled={wall.minimum==null} onClick={()=>onThickness(part.id,wall.minimum_location)} title={t('frameThinnest')}><span>{t('thinnest')}</span><strong>{mm(wall.minimum)}</strong><BoxSelect size={15}/></button>
            <button className="thickness-extreme maximum" disabled={wall.maximum==null} onClick={()=>onThickness(part.id,wall.maximum_location)} title={t('frameThickest')}><span>{t('thickest')}</span><strong>{mm(wall.maximum)}</strong><BoxSelect size={15}/></button>
          </div><dl><div><dt>{t('requiredThickness')}</dt><dd>{mm(wall.threshold)}</dd></div><div><dt>{t('thicknessDeficit')}</dt><dd className={wall.deficit?'deficit':''}>{mm(wall.deficit)}</dd></div></dl>{wall.unknown_faces>0&&<p className="measurement-warning"><TriangleAlert size={13}/>{t('incompleteThickness')}</p>}<button className="inspect-button" onClick={()=>onThickness(part.id)}><BoxSelect size={14}/>{t('viewPart')}</button></>:<p className="empty-note compact">{t(task?.stale?'stale':task?.thickness_error?'uncertain':'notMeasured')}</p>}
        </section>;
      })}
      </div>
    </section>
    <section id="checklist-panel" className="result-panel" role="tabpanel" aria-labelledby="checklist-tab" hidden={tab !== 'checklist'}><PartChecklist parts={parts} tasks={tasks} busy={busy} onReview={onReview} name={name} exporting={exporting} onExport={onExport} /></section>
  </aside>;
}
