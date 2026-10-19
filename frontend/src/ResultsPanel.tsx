import { useEffect, useState } from 'react';
import { BoxSelect, Copy, Link2, MessageSquare, MousePointer2, X, ZoomIn } from 'lucide-react';
import type { CheckTask, Job, Part, Relation } from './types';
import { partColors } from './types';
import { useI18n } from './i18n';

type Props = {
  parts: Part[]; relations: Relation[]; tasks: CheckTask[]; job: Job | null; busy: boolean;
  tab: 'relations' | 'checks'; onTab: (tab: 'relations' | 'checks') => void;
  isolated: string[] | null; inspected: string | null;
  onChoose: (pair: Relation) => void; onFrame: (pair: Relation) => void; onInspect: (pair: Relation) => void; onIsolate: (pair: Relation) => void;
  onReview: (task: CheckTask, done: boolean, note: string) => void; name: (part: Part) => string;
};

function Notes({ task, name, disabled, onReview, onClose }: { task: CheckTask; name: string; disabled: boolean; onReview: Props['onReview']; onClose: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState(task.note);
  useEffect(() => setNote(task.note), [task.id, task.note]);
  return <section className="notes-editor" aria-label={t('noteFor', { name })}>
    <header><div><span>{t('note')}</span><strong title={name}>{name}</strong></div><button className="icon-button" title={t('close')} onClick={onClose}><X size={17} /></button></header>
    <textarea aria-label={t('noteFor', { name })} placeholder={t('notePlaceholder')} maxLength={5000} disabled={disabled || task.stale} value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== task.note) onReview(task, task.done, note); }} />
  </section>;
}

export function ResultsPanel({ parts, relations, tasks, busy, tab, onTab, inspected, onChoose, onFrame, onIsolate, onInspect, onReview, name }: Props) {
  const { t, language } = useI18n();
  const [noteId, setNoteId] = useState<string | null>(null);
  const noteTask = tasks.find(task => task.id === noteId);
  const notePart = parts.find(part => part.id === noteTask?.part_id);
  const fresh = tasks.length > 0 && tasks.every(task => !task.stale);
  const done = tasks.filter(task => task.done && !task.stale).length;
  const pairs = relations.filter(row => row.kind !== 'DISCONNECTED').flatMap(relation => {
    const pair = relation.part_ids.map(id => parts.find(part => part.id === id)).filter((part): part is Part => !!part).sort((a, b) => name(a).localeCompare(name(b), language, { numeric: true }));
    return pair.length === 2 ? [{ relation, pair }] : [];
  }).sort((a, b) => a.pair.map(name).join(' / ').localeCompare(b.pair.map(name).join(' / '), language, { numeric: true }));
  const intersections = fresh ? pairs.filter(row => row.relation.kind === 'INTERSECTION') : [];
  function pairRow({ relation, pair }: typeof pairs[number], inspect: boolean) {
    const kind = relation.coincident ? 'coincident' : relation.kind === 'UNCERTAIN' ? 'uncertain' : fresh && relation.kind === 'INTERSECTION' ? 'intersection' : 'connection';
    const values = { a: name(pair[0]), b: name(pair[1]) };
    return <div className={`result-pair ${inspected === relation.id ? 'inspected' : ''}`} key={relation.id} onClick={event => { if (!(event.target as HTMLElement).closest('button')) onChoose(relation); }}>
      <span className={`pair-symbol ${kind}`} title={t(kind)}>{relation.coincident ? <Copy size={16} /> : <Link2 size={16} />}</span>
      <button className="pair-files pair-select" aria-label={t('selectPair', values)} aria-pressed={inspected === relation.id} onClick={() => onChoose(relation)}>{pair.map((part, index) => <span key={part.id} title={name(part)}>{inspected === relation.id && <i aria-hidden="true" style={{ background: relation.coincident ? partColors.coincident : index === 0 ? partColors.pairFirst : partColors.pairSecond }} />}{name(part)}</span>)}{relation.coincident && <span className="coincident-label" title={t('coincidentTip')}>{t('coincident')}</span>}</button>
      <div className="pair-actions">
        {!inspect && <button className="icon-button pair-zoom" title={t('zoomPair', values)} onClick={() => onFrame(relation)}><ZoomIn size={16} /></button>}
        <button className="inspect-button" aria-label={t(inspect ? 'inspectPair' : 'isolatePair', values)} onClick={() => inspect ? onInspect(relation) : onIsolate(relation)}><BoxSelect size={15} /><span>{t(inspect ? 'inspect' : 'isolatePairAction')}</span></button>
      </div>
    </div>;
  }
  return <aside className="checklist panel" aria-label={t('results')}>
    <div className="result-tabs" role="tablist" aria-label={t('results')} onKeyDown={event => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (current + 1) % 2 : -1;
      if (next >= 0) { event.preventDefault(); buttons[next].focus(); buttons[next].click(); }
    }}>
      <button id="relations-tab" role="tab" aria-selected={tab === 'relations'} aria-controls="relations-panel" tabIndex={tab === 'relations' ? 0 : -1} onClick={() => onTab('relations')}>{t('connections')}</button>
      <button id="checks-tab" role="tab" aria-selected={tab === 'checks'} aria-controls="checks-panel" tabIndex={tab === 'checks' ? 0 : -1} onClick={() => onTab('checks')}>{t('checks')}</button>
    </div>
    <section id="relations-panel" className="result-panel" role="tabpanel" aria-labelledby="relations-tab" hidden={tab !== 'relations'}>
          <div className="result-section-heading"><h2><MousePointer2 size={13} />{t('pairs')}</h2><span className="count">{pairs.length}</span></div>
      <div className="results-scroll">{pairs.map(row => pairRow(row, false))}{!pairs.length && <p className="empty-note">{relations.length ? t('noConnections') : t('noResults')}</p>}</div>
    </section>
    <section id="checks-panel" className="result-panel" role="tabpanel" aria-labelledby="checks-tab" hidden={tab !== 'checks'}>
        <section className="checks-pairs-section" aria-label={t('intersections')}>
          <div className="result-section-heading"><h2><span className="result-dot" />{t('intersections')}</h2><span className="count">{fresh ? intersections.length : '—'}</span></div>
          <div className="intersection-results-scroll">
          {intersections.map(row => pairRow(row, true))}
          {!intersections.length && <p className="empty-note compact">{tasks.some(task => task.stale) ? t('staleTip') : fresh ? t('noIntersections') : t('noResults')}</p>}
          </div>
        </section>
        <section className="part-checklist" aria-label={t('checklist')}>
          <div className="result-section-heading"><h2>{t('checklist')}</h2><span className="review-count">{tasks.length ? t('reviewedCount', { done, total: tasks.length }) : parts.length}</span></div>
          {tasks.length > 0 && <progress className="review-progress" aria-label={t('reviewed')} value={done} max={tasks.length} />}
          <div className="part-review-scroll">
          {!parts.length && <p className="empty-note compact">{t('noObjects')}</p>}
          {parts.map(part => {
            const task = tasks.find(row => row.part_id === part.id);
            const key = !task ? 'notChecked' : task.stale ? 'stale' : task.result === 'UNCERTAIN' ? 'uncertain' : task.intersections === 1 ? 'intersectionCountOne' : task.intersections ? 'intersectionCount' : 'clear';
            return <div className={`review-row ${task?.done && !task.stale ? 'reviewed' : ''}`} key={part.id} data-part-id={part.id}>
              {task ? <input type="checkbox" aria-label={t('reviewPart', { name: name(part) })} checked={task.done && !task.stale} disabled={busy || task.stale} onChange={event => onReview(task, event.target.checked, task.note)} /> : <span className="pending-check" aria-hidden="true">—</span>}
              <div className="review-object"><strong title={name(part)}>{name(part)}</strong><span className={`review-status ${key} ${task?.coincident_pairs ? 'has-coincident' : ''}`} title={task?.stale ? t('staleTip') : task?.result === 'UNCERTAIN' ? t('unclearCount', { count: task.uncertain_pairs }) : undefined}>{task && !task.stale && task.result !== 'UNCERTAIN' && task.coincident_pairs === task.intersections && task.coincident_pairs ? t('coincident') : t(key, { count: task?.intersections ?? 0 })}{task && !task.stale && task.coincident_pairs > 0 && task.coincident_pairs < task.intersections && ` · ${t('coincidentCount', { count: task.coincident_pairs })}`}</span></div>
              {task && <button className={`icon-button note-button ${task.note ? 'has-note' : ''}`} aria-pressed={noteId === task.id} title={t('noteFor', { name: name(part) })} onClick={() => setNoteId(noteId === task.id ? null : task.id)}><MessageSquare size={15} /></button>}
            </div>;
          })}
          </div>
        </section>
      {noteTask && notePart && <Notes task={noteTask} name={name(notePart)} disabled={busy} onReview={onReview} onClose={() => setNoteId(null)} />}
    </section>
  </aside>;
}
