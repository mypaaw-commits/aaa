export type Part = { id: string; name: string; size: number; faces: number; solid: boolean; bounds: number[][]; visible: boolean };
export type Kind = 'INTERSECTION' | 'CONNECTED' | 'DISCONNECTED' | 'UNCERTAIN';
export type Relation = { id: string; part_ids: [string, string]; kind: Kind; volume: number | null; message: string; status: 'TODO' | 'OK' | 'FIX'; note: string };
export type Job = { id: string; state: 'running' | 'done' | 'error'; completed: number; total: number; seconds: number; error: string | null };
export const labels: Record<Kind, string> = { INTERSECTION: 'Intersekcja', CONNECTED: 'Powiązanie', DISCONNECTED: 'Brak powiązania', UNCERTAIN: 'Wymaga weryfikacji' };
export const partColors = { idle: '#9b9b9b', selected: '#74ac64', active: '#cfb991' };
export function partColor(id: string, selected: string[], activeId: string | null) {
  return id === activeId ? partColors.active : selected.includes(id) ? partColors.selected : partColors.idle;
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
