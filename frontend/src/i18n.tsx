import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const en = {
  language: 'Language', import: 'Import STL', objects: 'Objects', objectList: 'Model objects',
  search: 'Search objects', searchPlaceholder: 'Search objects…', isolate: 'Isolate selection',
  showAll: 'Show all objects', selectAll: 'Select all', deselect: 'Clear selection', selected: '{count} selected',
  noObjects: 'No objects', noMatches: 'No matching objects', hide: 'Hide {name}', show: 'Show {name}',
  reorder: 'Drag to reorder · Alt + Up / Down', meshWarning: 'Mesh needs verification',
  objectOptions: 'Object options: {name}', remove: 'Delete',
  workspace: 'Analysis and 3D view', connections: 'Connections', checks: 'Checks', results: 'Results',
  checkConnections: 'Find connections', checkIntersections: 'Check intersections', checking: 'Checking…',
  entireModel: 'All objects, including hidden ones', showIntersections: 'Show intersections',
  pairsProgress: '{done} / {total} pairs', intersectionsFound: '{count} intersection pairs',
  connectionsFound: 'Connections updated', ready: 'Ready', analysisProgress: 'Analysis progress',
  fullModel: 'Full model', isolated: 'Isolated view', visible: '{count} / {total} visible',
  floor: 'Floor', floorTip: 'Show floor grid and axes', fit: 'Frame all visible',
  front: 'Front', top: 'Top', perspective: 'Perspective', view3d: 'Interactive 3D view',
  noModel: 'No model loaded', importHint: 'Import STL files or drop them here.', chooseFiles: 'Choose STL files',
  loadingGeometry: 'Loading 3D view: {count} / {total}', back: 'Back to full model',
  intersectionLegend: 'Intersection', processing: 'Processing…', sessionOnly: 'Session only · mm',
  modelSummary: '{parts} objects · {pairs} connections', dropFiles: 'Drop STL files', close: 'Close',
  connection: 'Connected', intersection: 'Intersection', uncertain: 'Needs review', disconnected: 'Not connected',
  inspect: 'Inspect', inspectPair: 'Inspect pair: {a} / {b}', framePair: 'Frame pair: {a} / {b}',
  hiddenPair: 'Show both objects in the object list first', pairs: 'Pairs',
  noConnections: 'No connections found', noResults: 'No results yet', noIntersections: 'No intersections found',
  intersections: 'Intersections', checklist: 'Part checklist', reviewedCount: '{done} / {total} reviewed',
  reviewed: 'Reviewed', reviewPart: 'Reviewed: {name}', note: 'Notes', noteFor: 'Notes: {name}',
  notePlaceholder: 'Add a note…', clear: 'Clear', notChecked: 'Not checked',
  intersectionCount: '{count} intersections', stale: 'Out of date', staleTip: 'Model changed. Run the check again.',
  intersectionCountOne: '1 intersection', intersectionsFoundOne: '1 intersection pair',
  unclearCount: '{count} uncertain pairs',
  analysisFinished: 'Checked {count} pairs in {seconds} s', imported: 'Imported {count} objects',
  importing: 'Importing STL files…', removed: 'Object deleted', duplicates: 'Imported objects. Duplicate names have separate identifiers.',
  unknownError: 'The operation failed. Please try again.',
  selectPair: 'Select pair: {a} / {b}', zoomPair: 'Zoom to pair: {a} / {b}', isolatePair: 'Isolate pair: {a} / {b}',
  transparency: 'Transparency', transparencyTip: 'Toggle object transparency', coincident: 'Coincident',
  coincidentCount: '{count} coincident', coincidentTip: 'Both objects occupy the same volume.',
  isolatePairAction: 'Isolate',
  objectConnections: 'Connections of {name}', projection: 'Projection', orthographic: 'Orthographic',
  objectIntersections: 'Intersections of {name}', pairCount: '{count} pairs', pairCountOne: '1 pair',
  unselected: 'Not selected', selectionLegend: 'Selected', colorLegend: 'View colors',
  withinTolerance: 'Within tolerance', withinToleranceCount: '{count} within tolerance',
  fitMargin: 'Fit margin: {value} mm', fitMarginTip: 'Teal regions are within the fit margin and are counted separately from intersections.',
  directConnections: 'Direct connections', runCheckHint: 'Run Check intersections to see the results.',
  reviewScope: 'Intersection review', reviewComplete: 'All parts reviewed', partsRemaining: '{count} parts left to review',
  exportPdf: 'Export PDF', exportingPdf: 'Preparing PDF…', exportFailed: 'Unable to export the checklist.',
  reviewSaveFailed: 'Review changes could not be saved. Retry your edit before exporting.',
};
const pl: Record<keyof typeof en, string> = {
  language: 'Język', import: 'Wczytaj STL', objects: 'Obiekty', objectList: 'Obiekty modelu',
  search: 'Szukaj obiektów', searchPlaceholder: 'Szukaj obiektów…', isolate: 'Izoluj zaznaczone',
  showAll: 'Pokaż wszystkie obiekty', selectAll: 'Zaznacz wszystkie', deselect: 'Odznacz wszystkie', selected: 'Zaznaczone: {count}',
  noObjects: 'Brak obiektów', noMatches: 'Brak pasujących obiektów', hide: 'Ukryj {name}', show: 'Pokaż {name}',
  reorder: 'Przeciągnij, aby zmienić kolejność · Alt + góra / dół', meshWarning: 'Siatka wymaga weryfikacji',
  objectOptions: 'Opcje obiektu: {name}', remove: 'Usuń',
  workspace: 'Analiza i widok 3D', connections: 'Powiązania', checks: 'Kontrole', results: 'Wyniki',
  checkConnections: 'Znajdź powiązania', checkIntersections: 'Sprawdź intersekcje', checking: 'Sprawdzanie…',
  entireModel: 'Wszystkie obiekty, również ukryte', showIntersections: 'Pokaż intersekcje',
  pairsProgress: 'Pary: {done} / {total}', intersectionsFound: 'Pary z intersekcją: {count}',
  connectionsFound: 'Powiązania zaktualizowane', ready: 'Gotowy', analysisProgress: 'Postęp analizy',
  fullModel: 'Cały model', isolated: 'Widok izolowany', visible: 'Widoczne: {count} / {total}',
  floor: 'Podłoga', floorTip: 'Pokaż siatkę podłogi i osie', fit: 'Dopasuj widoczne',
  front: 'Przód', top: 'Góra', perspective: 'Perspektywa', view3d: 'Interaktywny widok 3D',
  noModel: 'Brak modelu', importHint: 'Wczytaj pliki STL lub przeciągnij je tutaj.', chooseFiles: 'Wybierz pliki STL',
  loadingGeometry: 'Wczytywanie 3D: {count} / {total}', back: 'Wróć do całego modelu',
  intersectionLegend: 'Intersekcja', processing: 'Przetwarzanie…', sessionOnly: 'Bieżąca sesja · mm',
  modelSummary: 'Obiekty: {parts} · Powiązania: {pairs}', dropFiles: 'Upuść pliki STL', close: 'Zamknij',
  connection: 'Powiązanie', intersection: 'Intersekcja', uncertain: 'Do weryfikacji', disconnected: 'Brak powiązania',
  inspect: 'Zbliż', inspectPair: 'Zbliż parę: {a} / {b}', framePair: 'Dopasuj parę: {a} / {b}',
  hiddenPair: 'Najpierw pokaż oba obiekty na liście', pairs: 'Pary',
  noConnections: 'Nie znaleziono powiązań', noResults: 'Brak wyników', noIntersections: 'Nie wykryto intersekcji',
  intersections: 'Intersekcje', checklist: 'Checklista części', reviewedCount: 'Sprawdzone: {done} / {total}',
  reviewed: 'Sprawdzone', reviewPart: 'Sprawdzone: {name}', note: 'Notatki', noteFor: 'Notatki: {name}',
  notePlaceholder: 'Dodaj notatkę…', clear: 'Brak intersekcji', notChecked: 'Niesprawdzone',
  intersectionCount: 'Intersekcje: {count}', stale: 'Nieaktualne', staleTip: 'Model zmieniony. Uruchom kontrolę ponownie.',
  intersectionCountOne: 'Intersekcje: 1', intersectionsFoundOne: 'Pary z intersekcją: 1',
  unclearCount: 'Niepewne pary: {count}',
  analysisFinished: 'Sprawdzono {count} par w {seconds} s', imported: 'Wczytano obiekty: {count}',
  importing: 'Wczytywanie plików STL…', removed: 'Usunięto obiekt', duplicates: 'Wczytano obiekty. Powtarzające się nazwy mają osobne identyfikatory.',
  unknownError: 'Operacja nie powiodła się. Spróbuj ponownie.',
  selectPair: 'Zaznacz parę: {a} / {b}', zoomPair: 'Zbliż parę: {a} / {b}', isolatePair: 'Izoluj parę: {a} / {b}',
  transparency: 'Przezroczystość', transparencyTip: 'Przełącz przezroczystość obiektów', coincident: 'Pełne pokrycie',
  coincidentCount: 'Pełne pokrycie: {count}', coincidentTip: 'Oba obiekty zajmują tę samą objętość.',
  isolatePairAction: 'Izoluj',
  objectConnections: 'Powiązania obiektu {name}', projection: 'Projekcja', orthographic: 'Ortograficzna',
  objectIntersections: 'Intersekcje obiektu {name}', pairCount: 'Pary: {count}', pairCountOne: 'Pary: 1',
  unselected: 'Niezaznaczone', selectionLegend: 'Zaznaczone', colorLegend: 'Kolory widoku',
  withinTolerance: 'W marginesie dopasowania', withinToleranceCount: 'W marginesie: {count}',
  fitMargin: 'Margines dopasowania: {value} mm', fitMarginTip: 'Turkusowe obszary mieszczą się w marginesie i są liczone osobno od intersekcji.',
  directConnections: 'Bezpośrednie powiązania', runCheckHint: 'Uruchom Sprawdź intersekcje, aby zobaczyć wyniki.',
  reviewScope: 'Przegląd intersekcji', reviewComplete: 'Wszystkie części sprawdzone', partsRemaining: 'Pozostało do sprawdzenia: {count}',
  exportPdf: 'Eksportuj PDF', exportingPdf: 'Przygotowywanie PDF…', exportFailed: 'Nie można wyeksportować checklisty.',
  reviewSaveFailed: 'Nie zapisano zmian przeglądu. Ponów edycję przed eksportem.',
};
export type Language = 'en' | 'pl';
export type TextKey = keyof typeof en;
export type Values = Record<string, string | number>;
export function translate(language: Language, key: TextKey, values: Values = {}) {
  return (language === 'pl' ? pl[key] : en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
const Context = createContext({ language: 'en' as Language, setLanguage: (_: Language) => {}, t: (key: TextKey, values?: Values) => translate('en', key, values) });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => { try { return localStorage.getItem('modelcheck-language') === 'pl' ? 'pl' : 'en'; } catch { return 'en'; } });
  useEffect(() => { document.documentElement.lang = language; try { localStorage.setItem('modelcheck-language', language); } catch { /* Storage is optional. */ } }, [language]);
  return <Context.Provider value={{ language, setLanguage, t: (key, values) => translate(language, key, values) }}>{children}</Context.Provider>;
}
export const useI18n = () => useContext(Context);

const serverErrors = [
  ['Wczytaj model przed eksportem checklisty.', 'Import a model before exporting the checklist.'],
  ['Model zmieniony. Ponów eksport checklisty.', 'The model changed. Export the checklist again.'],
  ['Nie zapisano zmian przeglądu. Ponów edycję przed eksportem.', 'Review changes could not be saved. Retry your edit before exporting.'],
  ['Sesja wygasła. Odśwież stronę i wczytaj pliki ponownie.', 'Session expired. Refresh the page and import your files again.'],
  ['Poczekaj na zakończenie bieżącej operacji.', 'Wait for the current operation to finish.'],
  ['Prototyp obsługuje do 100 części w sesji.', 'A session supports up to 100 objects.'],
  ['Obsługiwane są wyłącznie pliki STL.', 'Only STL files are supported.'],
  ['Przekroczono limit 100 MB na plik.', 'The 100 MB limit per file was exceeded.'],
  ['Nie można odczytać siatki STL.', 'Unable to read the STL mesh.'],
  ['Pusta siatka lub nieprawidłowe współrzędne.', 'Empty mesh or invalid coordinates.'],
  ['Brak części.', 'Object not found.'],
  ['Nie udało się zakończyć analizy. Spróbuj mniejszego zestawu części.', 'Analysis failed. Try a smaller set of objects.'],
  ['Wczytaj co najmniej dwie części.', 'Import at least two objects.'],
  ['Brak zadania. Najpierw uruchom kontrolę.', 'Run the check before reviewing this object.'],
  ['Model zmieniony. Najpierw ponownie uruchom kontrolę intersekcji.', 'The model changed. Run the intersection check again.'],
  ['Brak geometrii intersekcji.', 'Intersection geometry not found.'],
  ['Nie można uruchomić WebGL. Włącz akcelerację sprzętową w przeglądarce.', 'Unable to start WebGL. Enable hardware acceleration in your browser.'],
  ['Nie można pobrać geometrii.', 'Unable to load geometry.'],
  ['Nie można pobrać obszaru przecięcia.', 'Unable to load the intersection geometry.'],
  ['Wybierz pliki w formacie STL.', 'Choose STL files.'],
  ['Maksymalny rozmiar jednego STL to 100 MB.', 'The maximum STL file size is 100 MB.'],
  ['Brak wyniku analizy.', 'Analysis results are unavailable.'],
  ['Nie udało się połączyć z serwerem. Sprawdź, czy serwer lokalny działa.', 'Network request failed. Check that the local server is running.'],
];
export function localizeError(message: string, language: Language) {
  let result = message.replace('Failed to fetch', language === 'en' ? 'Network request failed. Check that the local server is running.' : 'Nie udało się połączyć z serwerem. Sprawdź, czy serwer lokalny działa.');
  for (const [polish, english] of serverErrors) result = result.replaceAll(polish, language === 'pl' ? polish : english).replaceAll(english, language === 'pl' ? polish : english);
  result = result.replace(/Request failed \((\d+)\)\./g, (_, code) => language === 'pl' ? `Błąd żądania (${code}).` : `Request failed (${code}).`);
  // Unknown server details may contain Polish text or library internals; retain known, useful messages only.
  return result.split('\n').map(line => {
    const separator = line.lastIndexOf(': ');
    const detail = separator >= 0 ? line.slice(separator + 2) : line;
    return language === 'en' && /[ąćęłńóśźż]/i.test(detail) ? (separator >= 0 ? line.slice(0, separator + 2) : '') + translate(language, 'unknownError') : line;
  }).join('\n');
}
