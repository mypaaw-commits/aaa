# ModelCheck 3D — prototyp 0.1

Lokalne narzędzie do ręcznej kontroli połączeń części STL. Importuje model w położeniu montażowym, analizuje rzeczywistą geometrię i tworzy checklistę **wszystkich części**. Intersekcje i szczeliny włączasz na żądanie. Dane pozostają w pamięci bieżącej sesji — bez kont, chmury i zapisu projektu.

## Windows — pierwsze uruchomienie

Wymagane **Python 3.12, 64-bit** (z launcherem `py`) oraz **Node.js 22 lub 24** z npm.

1. Pobierz repozytorium i otwórz jego katalog.
2. Uruchom `setup.cmd`. Instaluje przypięte zależności i buduje interfejs; pierwsza instalacja wymaga Internetu.
3. Uruchom `start.cmd`. Otworzy przeglądarkę i lokalny serwer na porcie 8000.
4. Zostaw okno serwera otwarte. Aby zakończyć, naciśnij w nim Ctrl+C.

Po instalacji aplikacja nie potrzebuje Internetu. Czcionki również są dostarczane lokalnie. Serwer nasłuchuje wyłącznie na tym komputerze. Nie jest przygotowany do publicznego wdrożenia.

Alternatywne polecenia w PowerShell, **z katalogu głównego repozytorium**:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv\Scripts\python.exe run.py
```

Dostępność pakietów `python-fcl` i `manifold3d` dla Windows / Python 3.12 x64 została sprawdzona. Bieżącą wersję aplikacji uruchomiono i testowano na Linuksie; uruchomienie na Windows wymaga jeszcze sprawdzenia na Twoim komputerze. Gdy port 8000 jest zajęty: `python run.py --port 8001` (użyj interpretera z `.venv`).

## Pierwsza kontrola

1. Wybierz **Importuj STL** lub przeciągnij kilka plików do okna. Jeden plik to jedna część. Zakładamy **1 jednostka STL = 1 mm**. Oryginalne położenie i rozmiar pozostają zachowane; dopasowujemy wyłącznie kamerę.
2. W liście obiektów wybieraj, ukrywaj i przywracaj części. Shift + klik lub Ctrl + klik pozwala wybrać wiele części. Części są nieruchome.
3. Wybierz **Cały model** albo **Zaznaczone** i kliknij **Analizuj połączenia**. Cały model obejmuje też ukryte części. Zaznaczone analizuje tylko wybrane części **między sobą**, pomijając resztę.
4. Checklista zawiera wszystkie elementy, również bez połączeń. Po analizie przy każdym są jego styki, intersekcje, szczeliny do zadanego progu i wyniki niepewne. Opcja na dole odsłania też pary bez kontaktu. Domyślny próg szczelin to **0,1 mm**; zmiana progu wymaga ponownego uruchomienia analizy.
5. Kliknij parę, żeby wyizolować oba elementy i dopasować kamerę. **Pokaż wszystkie** przywraca model.
6. Przełączniki **Intersekcje**, **Szczeliny**, **Styki** są początkowo wyłączone. Intersekcja jest czerwoną siatką wspólnej objętości; części stają się przezroczyste, by pokazać obszary wewnętrzne. Szczelina to pomarańczowy odcinek między najbliższymi punktami i znaczniki jego końców — nie pełna mapa szczeliny. Styk ma zielony znacznik punktu kontaktu, jeśli silnik udostępnił wiarygodny punkt. W trybie „Zaznaczone” podświetlenia dotyczą tylko par zaznaczonych części. Ukryte części nie mają podświetlenia.
7. Oznacz **Do sprawdzenia / OK / Wymaga poprawki**, dodaj notatkę. Zmiana notatki jest stosowana po wyjściu z pola. Para ma jeden wspólny status, widoczny przy obu elementach. Wynik geometrii nigdy sam nie ustawia „OK”.

Analiza wybranego podzbioru aktualizuje tylko jego pary; dotychczasowe wyniki pozostałych par pozostają na checkliście. Przy niezmienionej geometrii ponowna analiza zachowuje ręczne oceny i notatki. Po dodaniu nowych części uruchom analizę, aby znaleźć ich połączenia.

Przycisk modelu demonstracyjnego w pustym widoku wczytuje trzy bryły: A–B styk, B–C intersekcja, A–C brak kontaktu. To wyłącznie przykład; możesz od razu wczytać własne STL.

## Kamera jak w Blenderze

| Sterowanie | Działanie |
| --- | --- |
| Środkowy przycisk myszy | Obrót |
| Shift + środkowy przycisk | Przesuwanie |
| Kółko | Zoom |
| Lewy przycisk | Wybór części |
| Shift / Ctrl + klik | Wiele części |
| Dwuklik w widoku | Dopasowanie kamery |
| Przyciski X / Y / Z | Widoki osiowe w kamerze perspektywicznej |

## Geometria i ograniczenia prototypu

- AABB odrzuca pary bezspornie poza progiem sąsiedztwa. To filtr, nie dowód kontaktu.
- **Manifold3D / Mesh64** wyznacza wspólną objętość zamkniętych brył z podwójną precyzją, również przy pełnym zawieraniu i wielu rozłącznych regionach. **FCL** oblicza odległość rzeczywistych powierzchni trójkątów.
- Otwarta siatka, niespójna orientacja, błąd operacji lub graniczna objętość dają **Wymaga weryfikacji**. Nie naprawiamy automatycznie STL. Scalanie powtarzających się wierzchołków odbywa się na kopii roboczej, bez przesuwania współrzędnych.
- Tolerancja numeryczna klasyfikacji styku to **0,00001 mm**. Nie jest tolerancją produkcyjną. STL ma własną ograniczoną precyzję; „~0 mm” oznacza styk w granicach tolerancji. Punktowy i krawędziowy kontakt też trafia do ręcznej oceny.
- Dodatnia wspólna objętość jest intersekcją; skrajnie małe wyniki (≤ max(10⁻¹² mm³, 10⁻¹⁰ objętości mniejszej części)) są niepewne. Nie gwarantujemy wykrycia wszystkich samoprzecięć i wad topologii.
- Automatyczne wykrywanie prześwitu na wylot, ocena technologiczna, grubość, edycja geometrii, zapis projektu i ręczne dodawanie pominiętych par pozostają poza tą iteracją.
- Limit importu: **100 MiB na plik i 100 części na sesję**. To limit wejścia, a nie potwierdzenie płynności przy stu dużych siatkach. Siatki, struktury obliczeniowe i GPU wymagają znacznie więcej pamięci niż sam plik STL. Wydajność na rzeczywistych plikach 100 MB i złożonych figurkach nie została jeszcze zmierzona.
- Analiza działa w wątku roboczym z licznikiem par; pojedyncza trudna operacja Boolean nie ma jeszcze przycisku anulowania ani limitu czasu. Bieżąca para może przez dłuższy czas nie zwiększać licznika.
- **Odświeżenie strony zaczyna nową sesję; restart serwera usuwa wszystkie dane.** Nic nie jest zapisywane do bazy ani projektu. Do odzyskania pamięci po dużych testach można zrestartować serwer.

## Linux / macOS

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv/bin/python run.py
```

## Praca nad kodem i testy

Backend: Python + FastAPI + Trimesh + Manifold3D + FCL. Frontend: React + TypeScript + Three.js. Frontend deweloperski proxy'uje `/api` do backendu.

```bash
# Terminal 1, z katalogu głównego
.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
# Terminal 2
npm run dev --prefix frontend
# Testy geometrii i API
.venv/bin/python -m pytest backend/tests -q
# Kompilacja TypeScript i wydanie produkcyjne
npm run build --prefix frontend
```

Na Windows zastąp `.venv/bin/python` przez `.venv\Scripts\python.exe`.

Testy przeglądarkowe (wymagają uruchomionego backendu z wcześniej zbudowanym frontendem):

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

Możesz wskazać istniejący Chromium zmienną `CHROMIUM_PATH`. Testy obejmują import, model ABC, checklistę, izolację, statusy i notatki, zakres analizy oraz przełączniki widoku. Testy geometrii obejmują szczeliny, kontakty, przenikanie, zawieranie, wiele regionów i uszkodzoną siatkę. Dane użytkownika nie są częścią zestawu testowego.
