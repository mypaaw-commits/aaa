import { useState } from 'react';
import { Box, BoxSelect, ChevronDown, ChevronRight, ClipboardCheck, Copy, Link2, ScanLine, TriangleAlert, ZoomIn } from 'lucide-react';
import type { CheckTask, Part, Relation } from './types';
import { partColors } from './types';
import { useI18n } from './i18n';
import { PartChecklist } from './PartChecklist';

export type ResultsTab = 'relations' | 'checks' | 'checklist';
type Props = {
  parts: Part[]; relations: Relation[]; tasks: CheckTask[]; busy: boolean;
  tab: ResultsTab; onTab: (tab: ResultsTab) => void;
  inspected: string | null;
  onChoose: (pair: Relation) => void; onFrame: (pair: Relation) => void; onInspect: (pair: Relation) => void; onIsolate: (pair: Relation) => void;
  onReview: (task: CheckTask, done: boolean, note: string) => void; name: (part: Part) => string;
};

export function ResultsPanel({ parts, relations, tasks, busy, tab, onTab, inspected, onChoose, onFrame, onIsolate, onInspect, onReview, name }: Props) {
  const { t, language } = useI18n();
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [intersectionsOpen, setIntersectionsOpen] = useState(true);
  const fresh = tasks.length > 0 && tasks.every(task => !task.stale);
  const pairs = relations.filter(row => row.kind !== 'DISCONNECTED').flatMap(relation => {
    const pair = relation.part_ids.map(id => parts.find(part => part.id === id)).filter((part): part is Part => !!part).sort((a, b) => name(a).localeCompare(name(b), language, { numeric: true }));
    return pair.length === 2 ? [{ relation, pair }] : [];
  }).sort((a, b) => a.pair.map(name).join(' / ').localeCompare(b.pair.map(name).join(' / '), language, { numeric: true }));
  const intersections = fresh ? pairs.filter(row => row.relation.kind === 'INTERSECTION') : [];
  function pairRow({ relation, pair }: typeof pairs[number], inspect: boolean, owner: string) {
    const kind = relation.coincident ? 'coincident' : relation.kind === 'UNCERTAIN' ? 'uncertain' : relation.kind === 'INTERSECTION' ? 'intersection' : 'connection';
    const Symbol = relation.coincident ? Copy : relation.kind === 'UNCERTAIN' ? TriangleAlert : relation.kind === 'INTERSECTION' ? ScanLine : Link2;
    const values = { a: name(pair[0]), b: name(pair[1]) };
    const other = pair.find(part => part.id !== owner)!;
    return <div className={`result-pair ${inspected === relation.id ? 'inspected' : ''}`} key={relation.id} onClick={event => { if (!(event.target as HTMLElement).closest('button')) onChoose(relation); }}>
      <span className={`pair-symbol ${kind}`} title={t(kind)}><Symbol size={16} /></span>
      <button className="pair-files pair-select" aria-label={t('selectPair', values)} aria-pressed={inspected === relation.id} onClick={() => onChoose(relation)}>
        <span title={name(other)}>{inspected === relation.id && <i aria-hidden="true" style={{ background: partColors.selected }} />}{name(other)}</span>
        <span className={`pair-status ${kind} ${relation.coincident ? 'coincident-label' : ''}`} title={relation.coincident ? t('coincidentTip') : undefined}>{t(kind)}</span>
      </button>
      <div className="pair-actions">
        {!inspect && <button className="icon-button pair-zoom" title={t('zoomPair', values)} onClick={() => onFrame(relation)}><ZoomIn size={16} /></button>}
        <button className="inspect-button" aria-label={t(inspect ? 'inspectPair' : 'isolatePair', values)} onClick={() => inspect ? onInspect(relation) : onIsolate(relation)}><BoxSelect size={15} /><span>{t(inspect ? 'inspect' : 'isolatePairAction')}</span></button>
      </div>
    </div>;
  }
  function objectGroups(rows: typeof pairs, inspect: boolean) {
    const expanded = inspect ? expandedCheck : expandedConnection;
    const setExpanded = inspect ? setExpandedCheck : setExpandedConnection;
    return parts.map(part => {
      const linked = rows.filter(row => row.relation.part_ids.includes(part.id));
      if (inspect && !linked.length) return null;
      const open = expanded === part.id;
      const pending = linked.some(row => row.relation.kind === 'UNCERTAIN');
      const id = `${inspect ? 'intersections' : 'connections'}-${part.id}`;
      return <section className={`connection-group ${inspect ? 'intersection-group' : ''} ${open ? 'expanded' : ''}`} key={part.id}>
        <button className="connection-group-toggle" aria-expanded={open} aria-controls={id} aria-label={t(inspect ? 'objectIntersections' : 'objectConnections', { name: name(part) })} onClick={() => setExpanded(open ? null : part.id)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Box size={15} /><strong title={name(part)}>{name(part)}</strong>
          {pending && <TriangleAlert size={14} className="connection-warning" aria-label={t('uncertain')} />}
          <span className="count" title={t(inspect ? 'intersections' : 'connections')}>{relations.length ? linked.length : '—'}</span>
        </button>
        <div id={id} className="connection-children" hidden={!open}>{open && <>{linked.map(row => pairRow(row, inspect, part.id))}{!linked.length && <p className="empty-note compact">{relations.length ? t('noConnections') : t('noResults')}</p>}</>}</div>
      </section>;
    });
  }
  return <aside className="checklist panel" aria-label={t('results')}>
    <div className="result-tabs" role="tablist" aria-label={t('results')} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowRight' ? (current + 1) % buttons.length : event.key === 'ArrowLeft' ? (current + buttons.length - 1) % buttons.length : -1;
      if (next >= 0) { event.preventDefault(); buttons[next].focus(); buttons[next].click(); }
    }}>
      <button id="relations-tab" role="tab" aria-selected={tab === 'relations'} aria-controls="relations-panel" tabIndex={tab === 'relations' ? 0 : -1} onClick={() => onTab('relations')}>{t('connections')}</button>
      <button id="checks-tab" role="tab" aria-selected={tab === 'checks'} aria-controls="checks-panel" tabIndex={tab === 'checks' ? 0 : -1} onClick={() => onTab('checks')}>{t('checks')}</button>
      <button id="checklist-tab" role="tab" aria-selected={tab === 'checklist'} aria-controls="checklist-panel" tabIndex={tab === 'checklist' ? 0 : -1} onClick={() => onTab('checklist')}><ClipboardCheck size={14} />{t('checklist')}</button>
    </div>
    <section id="relations-panel" className="result-panel" role="tabpanel" aria-labelledby="relations-tab" hidden={tab !== 'relations'}>
      <div className="result-section-heading"><h2><Box size={14} />{t('objects')}</h2><span className="count">{parts.length}</span></div>
      <div className="results-scroll">{!parts.length && <p className="empty-note">{t('noObjects')}</p>}{objectGroups(pairs, false)}</div>
    </section>
    <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={tab !== 'checks'}>
      <section className="checks-pairs-section" aria-label={t('intersections')}>
        <button className="check-section-toggle" aria-label={t('intersections')} aria-expanded={intersectionsOpen} aria-controls="intersection-groups" onClick={() => setIntersectionsOpen(open => !open)}>
          {intersectionsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<ScanLine size={15} /><strong>{t('intersections')}</strong><span className="count" title={t('pairs')}>{fresh ? t(intersections.length === 1 ? 'pairCountOne' : 'pairCount', { count: intersections.length }) : '—'}</span>
        </button>
        <div id="intersection-groups" className="intersection-results-scroll" hidden={!intersectionsOpen}>
          {intersectionsOpen && objectGroups(intersections, true)}
          {!intersections.length && <p className="empty-note compact">{tasks.some(task => task.stale) ? t('staleTip') : fresh ? t('noIntersections') : t('noResults')}</p>}
        </div>
      </section>
    </section>
    <section id="checklist-panel" className="result-panel" role="tabpanel" aria-labelledby="checklist-tab" hidden={tab !== 'checklist'}>
      <PartChecklist parts={parts} tasks={tasks} busy={busy} onReview={onReview} name={name} />
    </section>
  </aside>;
}
