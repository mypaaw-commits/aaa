import { useEffect, useState } from 'react';
import { CircleCheck, Copy, MessageSquare, Ruler, ScanLine, TriangleAlert, X } from 'lucide-react';
import type { CheckTask, Part } from './types';
import { useI18n } from './i18n';

type Props = { parts: Part[]; tasks: CheckTask[]; busy: boolean; name: (part: Part) => string; onReview: (task: CheckTask, done: boolean, note: string) => void };

function Notes({ task, name, disabled, onReview, onClose }: { task: CheckTask; name: string; disabled: boolean; onReview: Props['onReview']; onClose: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState(task.note);
  useEffect(() => setNote(task.note), [task.id, task.note]);
  return <section className="notes-editor" aria-label={t('noteFor', { name })}>
    <header><div><span>{t('note')}</span><strong title={name}>{name}</strong></div><button className="icon-button" title={t('close')} onClick={onClose}><X size={17} /></button></header>
    <textarea aria-label={t('noteFor', { name })} placeholder={t('notePlaceholder')} maxLength={5000} disabled={disabled || task.stale} value={note} onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== task.note) onReview(task, task.done, note); }} />
  </section>;
}

export function PartChecklist({ parts, tasks, busy, onReview, name }: Props) {
  const { t } = useI18n();
  const [noteId, setNoteId] = useState<string | null>(null);
  const noteTask = tasks.find(task => task.id === noteId);
  const notePart = parts.find(part => part.id === noteTask?.part_id);
  const done = tasks.filter(task => task.done && !task.stale).length;
  return (
        <section className="part-checklist" aria-label={t('checklist')}>
          <div className="result-section-heading"><h2>{t('checklist')}</h2><span className="review-count">{tasks.length ? t('reviewedCount', { done, total: tasks.length }) : parts.length}</span></div>
          {tasks.length > 0 && <progress className="review-progress" aria-label={t('reviewed')} value={done} max={tasks.length} />}
          <div className="part-review-scroll">
          {!parts.length && <p className="empty-note compact">{t('noObjects')}</p>}
          {parts.map(part => {
            const task = tasks.find(row => row.part_id === part.id);
            const key = !task ? 'notChecked' : task.stale ? 'stale' : task.result === 'UNCERTAIN' ? 'uncertain' : task.intersections === 1 ? 'intersectionCountOne' : task.intersections ? 'intersectionCount' : task.fit_pairs ? 'withinTolerance' : 'clear';
            return <div className={`review-row ${task?.done && !task.stale ? 'reviewed' : ''}`} key={part.id} data-part-id={part.id}>
              {task ? <input type="checkbox" aria-label={t('reviewPart', { name: name(part) })} checked={task.done && !task.stale} disabled={busy || task.stale} onChange={event => onReview(task, event.target.checked, task.note)} /> : <span className="pending-check" aria-hidden="true">—</span>}
              <div className="review-object"><strong title={name(part)}>{name(part)}</strong><span className={`review-status ${key} ${task?.coincident_pairs ? 'has-coincident' : ''}`} title={task?.stale ? t('staleTip') : task?.result === 'UNCERTAIN' ? t('unclearCount', { count: task.uncertain_pairs }) : undefined}>{key === 'uncertain' || key === 'stale' ? <TriangleAlert size={12} /> : key === 'clear' ? <CircleCheck size={12} /> : key === 'withinTolerance' ? <Ruler size={12} /> : task?.coincident_pairs ? <Copy size={12} /> : task?.intersections ? <ScanLine size={12} /> : null}{task && !task.stale && task.result !== 'UNCERTAIN' && task.coincident_pairs === task.intersections && task.coincident_pairs ? t('coincident') : t(key, { count: task?.intersections ?? 0 })}{task && !task.stale && task.coincident_pairs > 0 && task.coincident_pairs < task.intersections && ` · ${t('coincidentCount', { count: task.coincident_pairs })}`}{task && !task.stale && task.fit_pairs > 0 && task.intersections > 0 && ` · ${t('withinToleranceCount', { count: task.fit_pairs })}`}</span></div>
              {task && <button className={`icon-button note-button ${task.note ? 'has-note' : ''}`} aria-pressed={noteId === task.id} title={t('noteFor', { name: name(part) })} onClick={() => setNoteId(noteId === task.id ? null : task.id)}><MessageSquare size={15} /></button>}
            </div>;
          })}
          </div>
      {noteTask && notePart && <Notes task={noteTask} name={name(notePart)} disabled={busy} onReview={onReview} onClose={() => setNoteId(null)} />}
        </section>
  );
}
