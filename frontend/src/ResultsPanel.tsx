import { useState } from 'react';
import { BoxSelect, ChevronDown, ChevronRight, ClipboardCheck, Copy, Link2, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import type { CheckTask, Part, Relation } from './types';
import { useI18n } from './i18n';
import { PartChecklist } from './PartChecklist';

export type ResultsTab = 'checks' | 'checklist';
type Props = {
  parts: Part[]; relations: Relation[]; tasks: CheckTask[]; busy: boolean;
  tab: ResultsTab; onTab: (tab: ResultsTab) => void; inspected: string | null;
  onThickness: (id: string) => void; onChoose: (pair: Relation) => void;
  onInspect: (pair: Relation) => void; onIsolate: (pair: Relation) => void;
  exporting: boolean; onExport: () => Promise<void>;
  onReview: (task: CheckTask, done: boolean, note: string) => void; name: (part: Part) => string;
};

export function ResultsPanel({ parts, relations, tasks, busy, tab, onTab, inspected, onThickness, onChoose, onInspect, onIsolate, onReview, name, exporting, onExport }: Props) {
  const { t, language } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const pairs = relations.filter(row => row.kind !== 'DISCONNECTED' && row.part_ids.every(id => tasks.some(task => task.part_id === id && !task.stale)));
  const filters = [
    { id: 'all', label: 'allRelationships' as const, count: pairs.length },
    { id: 'INTERSECTION', label: 'intersections' as const, count: pairs.filter(row => row.kind === 'INTERSECTION').length },
    { id: 'CONNECTED', label: 'connections' as const, count: pairs.filter(row => row.kind === 'CONNECTED').length },
    { id: 'WITHIN_TOLERANCE', label: 'withinTolerance' as const, count: pairs.filter(row => row.kind === 'WITHIN_TOLERANCE').length },
    { id: 'UNCERTAIN', label: 'uncertain' as const, count: pairs.filter(row => row.kind === 'UNCERTAIN').length },
  ];
  const rows = pairs.filter(row => filter === 'all' || row.kind === filter);
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
      <button id="checks-tab" role="tab" aria-selected={tab === 'checks'} aria-controls="checks-panel" tabIndex={tab === 'checks' ? 0 : -1} onClick={() => onTab('checks')}>{t('analysisResults')}</button>
      <button id="checklist-tab" role="tab" aria-selected={tab === 'checklist'} aria-controls="checklist-panel" tabIndex={tab === 'checklist' ? 0 : -1} onClick={() => onTab('checklist')}><ClipboardCheck size={14} />{t('checklist')}</button>
    </div>
    <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={tab !== 'checks'}>
      <div className="result-filters" role="group" aria-label={t('resultFilter')}>{filters.filter(item => item.id === 'all' || item.id === 'INTERSECTION' || item.count > 0).map(item => <button key={item.id} aria-label={t(item.label)} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.label)}<span>{item.count}</span></button>)}</div>
      <div className="checks-scroll">
        {!tasks.some(task => !task.stale) && <div className="results-empty"><ScanLine size={24} /><strong>{tasks.length ? t('stale') : t('noResults')}</strong><p>{t('runCheckHint')}</p></div>}
        {parts.map(part => {
          const priority: Record<string, number> = { UNCERTAIN: 0, INTERSECTION: 1, WITHIN_TOLERANCE: 2, CONNECTED: 3 };
          const otherName = (row: Relation) => { const other = parts.find(other => other.id !== part.id && row.part_ids.includes(other.id)); return other ? name(other) : ''; };
          const linked = rows.filter(row => row.part_ids.includes(part.id)).sort((a, b) => priority[a.kind] - priority[b.kind] || otherName(a).localeCompare(otherName(b), language, { numeric: true }));
          const task = tasks.find(task => task.part_id === part.id);
          const open = expanded === part.id;
          if (filter !== 'all' && !linked.length) return null;
          return <section className={`connection-group ${linked.some(row => row.kind === 'INTERSECTION') ? 'intersection-group' : ''} ${open ? 'expanded' : ''}`} key={part.id}>
            <button className="connection-group-toggle" aria-label={t('partResults', { name: name(part) })} aria-expanded={open} aria-controls={`part-results-${part.id}`} onClick={() => setExpanded(open ? null : part.id)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<strong title={name(part)}>{name(part)}</strong><span className="count">{task && !task.stale ? linked.length : '—'}</span></button>
            <div id={`part-results-${part.id}`} className="connection-children" hidden={!open}>{open && <>{linked.map(row => pairRow(row, part))}{!linked.length && <p className="empty-note compact">{task && !task.stale ? t('noConnections') : t('noResults')}</p>}</>}</div>
          </section>;
        })}
        {tasks.some(task => task.thickness || task.thickness_error) && <section className="thickness-results"><h2>{t('thicknessMap')}</h2>{tasks.filter(task => task.thickness || task.thickness_error).map(task => {
          const part = parts.find(part => part.id === task.part_id); if (!part) return null;
          const wall = task.thickness;
          return <button className={`thickness-result ${wall?.thin_faces ? 'thin' : ''}`} key={task.id} disabled={!wall || task.stale} onClick={() => onThickness(part.id)}><strong>{name(part)}</strong><span>{wall?.minimum != null ? `${t('measuredMinimum')}: ${wall.minimum.toLocaleString(language, { maximumFractionDigits: 4 })} mm` : t('uncertain')}</span>{wall && <small>{t('thinFaces', { count: wall.thin_faces })} · {t('unknownFaces', { count: wall.unknown_faces })}</small>}</button>;
        })}</section>}
      </div>
    </section>
    <section id="checklist-panel" className="result-panel" role="tabpanel" aria-labelledby="checklist-tab" hidden={tab !== 'checklist'}><PartChecklist parts={parts} tasks={tasks} busy={busy} onReview={onReview} name={name} exporting={exporting} onExport={onExport} /></section>
  </aside>;
}
