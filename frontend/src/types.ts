export type Part = { id: string; name: string; size: number; faces: number; solid: boolean; bounds: number[][]; visible: boolean };
export type Kind = 'INTERSECTION' | 'CONNECTED' | 'DISCONNECTED' | 'UNCERTAIN';
export type Relation = { id: string; part_ids: [string, string]; kind: Kind; volume: number | null; message: string; coincident: boolean };
export type CheckKind = 'RELATIONS' | 'INTERSECTIONS';
export type CheckTask = { id: string; part_id: string; check: 'INTERSECTIONS'; done: boolean; note: string; stale: boolean; result: 'CLEAR' | 'INTERSECTION' | 'UNCERTAIN'; intersections: number; uncertain_pairs: number; coincident_pairs: number };
export type AnalysisResult = { job: Job | null; relations: Relation[]; tasks: CheckTask[] };
export type Job = { id: string; check: CheckKind; state: 'running' | 'done' | 'error'; completed: number; total: number; seconds: number; error: string | null };
export const partColors = { idle: '#949494', selected: '#628ca8', intersection: '#cf4545', coincident: '#956bb6' };
export function partColor(id: string, selected: string[]) {
  return selected.includes(id) ? partColors.selected : partColors.idle;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
