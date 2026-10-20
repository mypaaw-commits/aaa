import { useState } from 'react';
import { BoxSelect, ChevronDown, ChevronRight, ClipboardCheck, Copy, Link2, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import type { CheckTask, Part, Relation } from './types';
import { partColors } from './types';
import { useI18n } from './i18n';
import { PartChecklist } from './PartChecklist';

export type ResultsTab = 'relations' | 'checks' | 'checklist';
type Props = {
  parts: Part[]; relations: Relation[]; tasks: CheckTask[]; busy: boolean;
  tab: ResultsTab; onTab: (tab: ResultsTab) => void;
  inspected: string | null;
  onChoose: (pair: Relation) => void; onInspect: (pair: Relation) => void; onIsolate: (pair: Relation) => void;
  exporting: boolean; onExport: () => Promise<void>;
  onReview: (task: CheckTask, done: boolean, note: string) => void; name: (part: Part) => string;
};

export function ResultsPanel({ parts, relations, tasks, busy, tab, onTab, inspected, onChoose, onIsolate, onInspect, onReview, name, exporting, onExport }: Props) {
  const { t, language } = useI18n();
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [expandedChecks, setExpandedChecks] = useState<Record<string, string | null>>({});
  const [openCategories, setOpenCategories] = useState(['intersections', 'uncertain']);
  const fresh = tasks.length > 0 && tasks.every(task => !task.stale);
  const pairs = relations.filter(row => row.kind !== 'DISCONNECTED').flatMap(relation => {
    const pair = relation.part_ids.map(id => parts.find(part => part.id === id)).filter((part): part is Part => !!part).sort((a, b) => name(a).localeCompare(name(b), language, { numeric: true }));
    return pair.length === 2 ? [{ relation, pair }] : [];
  }).sort((a, b) => a.pair.map(name).join(' / ').localeCompare(b.pair.map(name).join(' / '), language, { numeric: true }));
  const categories = [
    { id: 'intersections', title: 'intersections' as const, icon: ScanLine, rows: pairs.filter(row => row.relation.kind === 'INTERSECTION') },
    { id: 'uncertain', title: 'uncertain' as const, icon: TriangleAlert, rows: pairs.filter(row => row.relation.kind === 'UNCERTAIN') },
    { id: 'fits', title: 'withinTolerance' as const, icon: Ruler, rows: pairs.filter(row => row.relation.kind === 'WITHIN_TOLERANCE') },
  ];
  function pairRow({ relation, pair }: typeof pairs[number], inspect: boolean, owner: string) {
    const kind = relation.coincident ? 'coincident' : relation.kind === 'UNCERTAIN' ? 'uncertain' : relation.kind === 'WITHIN_TOLERANCE' ? 'withinTolerance' : relation.kind === 'INTERSECTION' ? 'intersection' : 'connection';
    const Symbol = relation.coincident ? Copy : relation.kind === 'UNCERTAIN' ? TriangleAlert : relation.kind === 'WITHIN_TOLERANCE' ? Ruler : relation.kind === 'INTERSECTION' ? ScanLine : Link2;
    const values = { a: name(pair[0]), b: name(pair[1]) };
    const other = pair.find(part => part.id !== owner)!;
    return <div className={`result-pair ${inspected === relation.id ? 'inspected' : ''}`} key={relation.id} onClick={event => { if (!(event.target as HTMLElement).closest('button')) onChoose(relation); }}>
      <span className={`pair-symbol ${kind}`} title={t(kind)}><Symbol size={16} /></span>
      <button className="pair-files pair-select" aria-label={t('selectPair', values)} aria-pressed={inspected === relation.id} onClick={() => onChoose(relation)}>
        <span title={name(other)}>{inspected === relation.id && <i aria-hidden="true" style={{ background: partColors.selected }} />}{name(other)}</span>
        <span className={`pair-status ${kind} ${relation.coincident ? 'coincident-label' : ''}`} title={relation.coincident ? t('coincidentTip') : relation.kind === 'WITHIN_TOLERANCE' ? t('fitMargin', { value: relation.fit_tolerance.toLocaleString(language, { maximumFractionDigits: 6 }) }) : undefined}>{t(kind)}</span>
      </button>
      <div className="pair-actions">
        <button className="inspect-button" aria-label={t('inspectPair', values)} onClick={() => inspect ? onInspect(relation) : onIsolate(relation)}><BoxSelect size={15} /><span>{t('inspect')}</span></button>
      </div>
    </div>;
  }
  function objectGroups(rows: typeof pairs, category?: string) {
    const inspect = !!category;
    const expanded = category ? expandedChecks[category] : expandedConnection;
    const setExpanded = (id: string | null) => category ? setExpandedChecks(current => ({ ...current, [category]: id })) : setExpandedConnection(id);
    return parts.map(part => {
      const linked = rows.filter(row => row.relation.part_ids.includes(part.id));
      if (inspect && !linked.length) return null;
      const open = expanded === part.id;
      const pending = linked.some(row => row.relation.kind === 'UNCERTAIN');
      const id = `${category || 'connections'}-${part.id}`;
      const analyzed = parts.length > 1 && relations.filter(row => row.part_ids.includes(part.id)).length === parts.length - 1;
      return <section className={`connection-group ${inspect ? 'intersection-group' : ''} ${open ? 'expanded' : ''}`} key={part.id}>
        <button className="connection-group-toggle" aria-expanded={open} aria-controls={id} aria-label={t(inspect ? 'objectIntersections' : 'objectConnections', { name: name(part) })} onClick={() => setExpanded(open ? null : part.id)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<strong title={name(part)}>{name(part)}</strong>
          {pending && <TriangleAlert size={14} className="connection-warning" aria-label={t('uncertain')} />}
          <span className="count" title={t(inspect ? 'intersections' : 'connections')}>{analyzed ? linked.length : '—'}</span>
        </button>
        <div id={id} className="connection-children" hidden={!open}>{open && <>{linked.map(row => pairRow(row, inspect, part.id))}{!linked.length && <p className="empty-note compact">{analyzed ? t('noConnections') : t('noResults')}</p>}</>}</div>
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
      <div className="result-section-heading"><h2>{t('directConnections')}</h2><span className="count">{relations.length ? t(pairs.length === 1 ? 'pairCountOne' : 'pairCount', { count: pairs.length }) : '—'}</span></div>
      <div className="results-scroll">{!parts.length && <p className="empty-note">{t('noObjects')}</p>}{objectGroups(pairs)}</div>
    </section>
    <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={tab !== 'checks'}>
      <div className="checks-scroll">
        {!fresh && <div className="results-empty"><ScanLine size={24} /><strong>{tasks.some(task => task.stale) ? t('stale') : t('noResults')}</strong><p>{tasks.some(task => task.stale) ? t('staleTip') : t('runCheckHint')}</p></div>}
        {fresh && categories.filter(category => category.id === 'intersections' || category.rows.length > 0).map(category => {
          const open = openCategories.includes(category.id);
          const Icon = category.icon;
          return <section className={`checks-pairs-section category-${category.id}`} key={category.id}>
            <button className="check-section-toggle" aria-label={t(category.title)} aria-expanded={open} aria-controls={`${category.id}-groups`} onClick={() => setOpenCategories(current => open ? current.filter(id => id !== category.id) : [...current, category.id])}>
              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Icon size={15} /><strong>{t(category.title)}</strong><span className="count">{category.rows.length}</span>
            </button>
            <div id={`${category.id}-groups`} className="intersection-results-scroll" hidden={!open}>
              {open && objectGroups(category.rows, category.id)}
              {!category.rows.length && <p className="empty-note compact">{t('noIntersections')}</p>}
            </div>
          </section>;
        })}
      </div>
    </section>
    <section id="checklist-panel" className="result-panel" role="tabpanel" aria-labelledby="checklist-tab" hidden={tab !== 'checklist'}>
      <PartChecklist parts={parts} tasks={tasks} busy={busy} onReview={onReview} name={name} exporting={exporting} onExport={onExport} />
    </section>
  </aside>;
}
