import { useEffect, useState } from 'react';
import { CircleCheck, Copy, Download, LoaderCircle, MessageSquare, Ruler, ScanLine, TriangleAlert } from 'lucide-react';
import type { CheckTask, Part } from './types';
import { useI18n } from './i18n';

type Props = { parts: Part[]; tasks: CheckTask[]; busy: boolean; name: (part: Part) => string; exporting: boolean; onExport: () => Promise<void>; onReview: (task: CheckTask, done: boolean, note: string) => void };

function Notes({ task, name, disabled, onReview }: { task: CheckTask; name: string; disabled: boolean; onReview: Props['onReview'] }) {
  const { t } = useI18n();
  const [note, setNote] = useState(task.note);
  useEffect(() => setNote(task.note), [task.id, task.note]);
  return <section className="notes-editor" aria-label={t('noteFor', { name })}>
    <label htmlFor={`note-${task.id}`}>{t('note')}</label>
    <textarea id={`note-${task.id}`} aria-label={t('noteFor', { name })} placeholder={t('notePlaceholder')} maxLength={5000} disabled={disabled || task.stale} value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== task.note) onReview(task, task.done, note); }} />
  </section>;
}

export function PartChecklist({ parts, tasks, busy, onReview, name, exporting, onExport }: Props) {
  const { t } = useI18n();
  const [noteId, setNoteId] = useState<string | null>(null);
  const done = tasks.filter(task => task.done && !task.stale).length;
  return (
        <section className="part-checklist" aria-label={t('checklist')}>
          <div className="result-section-heading"><h2>{t('reviewScope')}</h2><span className="review-count">{t('reviewedCount', { done, total: parts.length })}</span></div>
          {tasks.length > 0 && <progress className="review-progress" aria-label={t('reviewed')} value={done} max={tasks.length} />}
          <div className="part-review-scroll">
          {!parts.length && <p className="empty-note compact">{t('noObjects')}</p>}
          {parts.map(part => {
            const task = tasks.find(row => row.part_id === part.id);
            const key = !task ? 'notChecked' : task.stale ? 'stale' : task.result === 'UNCERTAIN' ? 'uncertain' : task.intersections === 1 ? 'intersectionCountOne' : task.intersections ? 'intersectionCount' : task.fit_pairs ? 'withinTolerance' : 'clear';
            return <section className="review-item" key={part.id}><div className={`review-row ${task?.done && !task.stale ? 'reviewed' : ''}`} data-part-id={part.id}>
              {task ? <input type="checkbox" aria-label={t('reviewPart', { name: name(part) })} checked={task.done && !task.stale} disabled={busy || task.stale} onChange={event => onReview(task, event.target.checked, task.note)} /> : <span className="pending-check" aria-hidden="true">—</span>}
              <div className="review-object"><strong title={name(part)}>{name(part)}</strong><span className={`review-status ${key} ${task?.coincident_pairs ? 'has-coincident' : ''}`} title={task?.stale ? t('staleTip') : task?.result === 'UNCERTAIN' ? t('unclearCount', { count: task.uncertain_pairs }) : undefined}>{key === 'uncertain' || key === 'stale' ? <TriangleAlert size={12} /> : key === 'clear' ? <CircleCheck size={12} /> : key === 'withinTolerance' ? <Ruler size={12} /> : task?.coincident_pairs ? <Copy size={12} /> : task?.intersections ? <ScanLine size={12} /> : null}{task && !task.stale && task.result !== 'UNCERTAIN' && task.coincident_pairs === task.intersections && task.coincident_pairs ? t('coincident') : t(key, { count: task?.intersections ?? 0 })}{task && !task.stale && task.coincident_pairs > 0 && task.coincident_pairs < task.intersections && ` · ${t('coincidentCount', { count: task.coincident_pairs })}`}{task && !task.stale && task.fit_pairs > 0 && task.intersections > 0 && ` · ${t('withinToleranceCount', { count: task.fit_pairs })}`}</span></div>
              {task && <button className={`icon-button note-button ${task.note ? 'has-note' : ''}`} aria-pressed={noteId === task.id} title={t('noteFor', { name: name(part) })} aria-expanded={noteId === task.id} onClick={() => setNoteId(noteId === task.id ? null : task.id)}><MessageSquare size={15} /></button>}
            </div>{task && noteId === task.id && <Notes task={task} name={name(part)} disabled={busy} onReview={onReview} />}</section>;
          })}
          </div>
      <footer className="checklist-footer">
        <div className={`completion-state ${parts.length > 0 && done === parts.length ? 'complete' : ''}`}><CircleCheck size={16} /><span>{parts.length > 0 && done === parts.length ? t('reviewComplete') : t('partsRemaining', { count: parts.length - done })}</span></div>
        <button className="button export-pdf" disabled={busy || !parts.length} onClick={() => void onExport()}>{exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{t(exporting ? 'exportingPdf' : 'exportPdf')}</button>
      </footer>
        </section>
  );
}
