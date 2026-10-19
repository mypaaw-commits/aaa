export type Part = { id: string; name: string; size: number; faces: number; solid: boolean; bounds: number[][]; visible: boolean };
export type Kind = 'INTERSECTION' | 'CONNECTED' | 'DISCONNECTED' | 'UNCERTAIN';
export type Relation = { id: string; part_ids: [string, string]; kind: Kind; volume: number | null; message: string };
export type CheckKind = 'RELATIONS' | 'INTERSECTIONS';
export type CheckTask = { id: string; part_id: string; check: 'INTERSECTIONS'; done: boolean; note: string; stale: boolean; result: 'CLEAR' | 'INTERSECTION' | 'UNCERTAIN'; intersections: number; uncertain_pairs: number };
export type AnalysisResult = { job: Job | null; relations: Relation[]; tasks: CheckTask[] };
export type Job = { id: string; check: CheckKind; state: 'running' | 'done' | 'error'; completed: number; total: number; seconds: number; error: string | null };
export const labels: Record<Kind, string> = { INTERSECTION: 'Intersekcja', CONNECTED: 'Powiązanie', DISCONNECTED: 'Brak powiązania', UNCERTAIN: 'Wymaga weryfikacji' };
export const partColors = { idle: '#949494', selected: '#67845b', active: '#aa9674' };
export function partColor(id: string, selected: string[], activeId: string | null) {
  return id === activeId ? partColors.active : selected.includes(id) ? partColors.selected : partColors.idle;
}
export function taskResult(task: CheckTask) {
  if (task.stale) return 'Model zmieniony — uruchom kontrolę ponownie.';
  if (task.result === 'UNCERTAIN') return `Wymaga weryfikacji (${task.uncertain_pairs} niepewnych par).`;
  return task.intersections ? `Pary z intersekcją: ${task.intersections}` : 'Nie wykryto intersekcji.';
}
export const number = (value: number, digits = 4) => value.toLocaleString('pl-PL', { maximumFractionDigits: digits });
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Błąd żądania (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
