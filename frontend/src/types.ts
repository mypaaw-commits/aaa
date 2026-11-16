export type Folder = { id: string; name: string; parent_id: string | null };
export type Part = { folder_id?: string | null; id: string; name: string; size: number; faces: number; solid: boolean; bounds: number[][]; visible: boolean };
export type Kind = 'INTERSECTION' | 'CONNECTED' | 'DISCONNECTED' | 'UNCERTAIN' | 'WITHIN_TOLERANCE';
export type Relation = { id: string; part_ids: [string, string]; kind: Kind; volume: number | null; message: string; reason?: 'COMPUTATION_LIMIT'; coincident: boolean; fit_tolerance: number; map_ready?: boolean; contact_ready?: boolean; depth_max?: number };
export type ThicknessResult = { minimum: number | null; maximum: number | null; thin_faces: number; unknown_faces: number; faces: number; threshold: number; preview_error: number; deficit: number | null; minimum_location: number[] | null; maximum_location: number[] | null };
export type CheckKind = 'ANALYSIS' | 'INTERSECTIONS' | 'THICKNESS';
export type CheckTask = { id: string; part_id: string; check: 'INTERSECTIONS' | 'THICKNESS'; done: boolean; note: string; stale: boolean; result: 'CLEAR' | 'INTERSECTION' | 'UNCERTAIN' | 'WITHIN_TOLERANCE'; intersections: number; uncertain_pairs: number; coincident_pairs: number; fit_pairs: number; thickness?: ThicknessResult; thickness_error?: boolean };
export type AnalysisResult = { job: Job | null; relations: Relation[]; tasks: CheckTask[] };
export type Job = { id: string; check: CheckKind; state: 'running' | 'done' | 'error' | 'cancelled'; stage?: 'bounds' | 'intersection' | 'coincidence' | 'fit' | 'distance' | 'results' | 'stopping' | 'fit_map' | 'thickness' | 'contact' | 'display'; surface_done?: number; surface_total?: number; measured_parts?: number; total_parts?: number; completed: number; total: number; seconds: number; error: string | null; fit_tolerance: number };
export const partColors = { idle: '#8c96a0', selected: '#4e83ba', intersection: '#ee3e32', fit: '#19b69a', coincident: '#9b70cf' };
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
