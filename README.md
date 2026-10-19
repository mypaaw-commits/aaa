# ModelCheck 3D — prototyp 0.5

Lokalna aplikacja do sprawdzania **powiązań części STL i intersekcji**. Widok 3D działa podobnie do Blendera, a checklista zawiera wszystkie wczytane elementy. Interfejs jest prostym edytorem z systemową czcionką, szarymi panelami i płaskimi przyciskami. Numer wersji 0.5 jest widoczny w nagłówku. Usunięto osobne kategorie styków i szczelin, ich znaczniki oraz próg odległości.

![Uproszczony interfejs: lista elementów, model 3D i powiązania części](docs/modelcheck3d.png)

## Windows — uruchomienie

Wymagane: **Python 3.12, 64-bit** z launcherem `py` oraz **Node.js 22 lub 24** z npm.

1. Pobierz ZIP z GitHub: **Code → Download ZIP**. Rozpakuj go do osobnego katalogu.
2. Uruchom `setup.cmd`. Pierwsza instalacja wymaga Internetu.
3. Uruchom `start.cmd`. Aplikacja otworzy się w przeglądarce.
4. Pozostaw okno serwera otwarte. Ctrl+C kończy jego pracę.

**Aktualizacja ze starszej wersji:** zakończ poprzedni serwer klawiszami Ctrl+C w jego oknie, rozpakuj nowy ZIP do osobnego folderu i uruchom w nim `setup.cmd`, a potem `start.cmd`. W nagłówku otwartej aplikacji powinno być **0.5**. Stary działający proces nie wczyta automatycznie nowego silnika analizy.

Aplikacja po instalacji działa bez Internetu; czcionki też są lokalne. Serwer nasłuchuje tylko na tym komputerze, domyślnie na porcie 8000. Gdy port jest zajęty, uruchom `.venv\Scripts\python.exe run.py --port 8001`.

Polecenia ręczne w PowerShell, z katalogu głównego projektu:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv\Scripts\python.exe run.py
```

Pakiety silnika są dostępne dla Windows / Python 3.12 x64. Bieżący prototyp testowano na Linuksie; uruchomienie na Windows pozostaje do sprawdzenia na Twoim komputerze.

## Jak sprawdzić model

1. **Wczytaj STL** — wybierz osobne pliki części lub przeciągnij je do okna. Po lewej zobaczysz wszystkie elementy, pośrodku złożony model. Pliki zachowują swoje współrzędne i skalę. Przyjmujemy 1 jednostkę STL = 1 mm.
2. **Sprawdź powiązania** — analiza zawsze sprawdza wszystkie wczytane części, również ukryte. Nie ma wyboru zakresu ani analizy samych zaznaczonych elementów.
3. **Powiązania i checklista** — przy każdym elemencie znajdziesz listę „Powiązany z”. Powiązanie oznacza bezpośrednie dotykanie się części lub ich przenikanie. Element bez powiązań też pozostaje na checkliście. Samo bliskie położenie oddzielonych części nie tworzy powiązania.
4. **Pokaż intersekcje** — włącz, gdy chcesz obejrzeć czerwone regiony przenikania. Domyślnie są wyłączone. Podświetlamy wspólną objętość, a nie całe części. Otaczające elementy stają się przezroczyste, aby odsłonić wewnętrzne obszary. Zaznaczenie nie ogranicza wyników intersekcji; podświetlane są wyniki dla wszystkich widocznych części.
5. **Wybierz parę na checkliście** — pozostałe części zostaną ukryte, a kamera dopasowana do tej pary. Wybierz ręcznie **Do sprawdzenia / OK / Wymaga poprawki** i dodaj notatkę. Zmiana notatki jest stosowana po wyjściu z pola. Status i notatka są wspólne dla obu elementów; wynik analizy nie ustawia automatycznie „OK”.
6. **Usuń element** — kliknij jego wiersz na liście obiektów prawym przyciskiem i wybierz **Usuń**. Przy nazwie pozostaje tylko oczko widoczności. Menu można też otworzyć klawiszami Shift+F10; Escape lub kliknięcie poza menu zamyka je bez usuwania. Usunięcie dotyczy wskazanego elementu, także gdy zaznaczonych jest kilka części. W czasie przetwarzania polecenie jest niedostępne.
7. **Pokaż cały model** — przywróć wszystkie części. Wybór elementu na liście lub w 3D odsłania jego pozycję na checkliście. Nazwy powiązanych części są sortowane alfabetycznie z uwzględnieniem numerów.

Każda analiza sprawdza wszystkie unikalne pary. Przy niezmienionych plikach zachowuje ręczne oceny i notatki. Zaznaczanie, aktywacja i izolacja zmieniają wyłącznie obsługę widoku, a nie zakres analizy. Po dodaniu części ponownie uruchom sprawdzanie, aby znaleźć ich powiązania.

W pustym widoku dostępny jest przykład A/B/C: A łączy się z B, B z C, a B i C mają też intersekcję. A i C są rozdzielone. Możesz od razu użyć własnych STL.

## Zaznaczanie i aktywacja

**Viewport 3D i checklista:** nieaktywne i niezaznaczone części są szare, nieaktywne zaznaczone są zielone, aktywna część jest beżowa. Lewy przycisk zaznacza; Shift + klik dodaje lub odejmuje części. Kliknięcie modelu w 3D nie aktywuje obiektu na liście.

**Lista obiektów po lewej:** prawy przycisk ustawia aktywny obiekt i otwiera menu „Usuń”. Aktywny wiersz i model 3D tego obiektu są beżowe. Samo aktywowanie nie dodaje ani nie usuwa części z zaznaczenia. Lewy przycisk na liście zaznacza na zielono, ale nie zmienia aktywnego obiektu. Shift+F10 jest klawiaturowym odpowiednikiem prawego przycisku.

Aktywny obiekt pozostaje aktywny do wskazania innego prawym przyciskiem lub usunięcia. Odznaczenie wszystkich nie zmienia aktywnego obiektu. Usunięcie aktywnego obiektu nie aktywuje automatycznie kolejnego. Kliknięcie aktywnego modelu lewym przyciskiem nie usuwa jego aktywacji — pozostaje beżowy.

Intersekcje nadal są czerwone i pojawiają się po włączeniu „Pokaż intersekcje”.

![Zielone zaznaczenie i beżowy obiekt aktywowany prawym przyciskiem](docs/selection.png)

## Sterowanie

| Sterowanie | Działanie |
| --- | --- |
| Środkowy przycisk myszy | Obrót kamery |
| Shift + środkowy przycisk | Przesuwanie widoku |
| Kółko | Zoom |
| Klik w model lub nazwę | Wybór elementu |
| Shift / Ctrl + klik | Wiele elementów |
| Ikona oka | Ukrywanie i pokazywanie części |
| Prawy przycisk na liście | Aktywacja obiektu i menu „Usuń” |
| Izoluj wybrane | Widok samych zaznaczonych części |
| Dopasuj widok / dwuklik | Dopasowanie kamery |

Części są nieruchome; warianty geometrii przygotuj w Blenderze.

## Zasady analizy i ograniczenia

- Lista powiązań wynika z rzeczywistej geometrii. AABB służy tylko do odrzucania dalekich par. FCL sprawdza powierzchnie, a Manifold3D / Mesh64 oblicza wspólną objętość brył.
- Obsługujemy częściowe przenikanie, całkowite zawieranie oraz wiele rozłącznych regionów intersekcji. Nieprawidłowa siatka, błąd obliczeń lub wynik graniczny otrzymują **Wymaga weryfikacji**. Takiej pary nie opisujemy jako pewnego powiązania.
- Wewnętrzna tolerancja obliczeniowa bezpośredniego połączenia to 0,00001 mm. Nie jest tolerancją produkcyjną. Punktowy i krawędziowy kontakt też stanowi powiązanie wymagające ręcznej oceny.
- Skrajnie małe objętości przecięcia (≤ max(10⁻¹² mm³, 10⁻¹⁰ objętości mniejszej części)) są niepewne. Nie gwarantujemy wykrycia wszystkich samoprzecięć i wad topologii. Nie naprawiamy automatycznie siatek; scalanie powtarzających się wierzchołków wykonujemy na kopii roboczej, bez przesuwania współrzędnych.
- Limit importu: 100 MiB na plik i 100 części na sesję. Wydajność rzeczywistych modeli 100 MB nie została jeszcze zmierzona. Pamięć potrzebna na obliczenia i GPU jest większa niż rozmiar samego STL.
- Analiza działa w tle z licznikiem par. Nie ma jeszcze anulowania pojedynczej długiej operacji Boolean.
- **Brak zapisu projektu.** Odświeżenie strony zaczyna nową sesję; restart serwera usuwa dane. Zwalnianie opuszczonej sesji po zamknięciu strony jest wykonywane w miarę możliwości przeglądarki; w razie potrzeby zrestartuj serwer, aby odzyskać pamięć po dużych testach.
- Poza tą iteracją: kontrola prześwitu na wylot, pomiary grubości, automatyczna ocena CNC, ręczne dodawanie powiązań, edycja geometrii i zapis projektów.

## Rozwój i testy

Python + FastAPI + Trimesh + Manifold3D + FCL; frontend React + TypeScript + Three.js.

```bash
# Linux / macOS, katalog główny repozytorium
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv/bin/python run.py

# Backend w trybie deweloperskim, osobny terminal
.venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
# Frontend w osobnym terminalu; proxy do backendu na porcie 8000
npm run dev --prefix frontend

# Geometria i API
.venv/bin/python -m pytest backend/tests -q
```

Na Windows zastąp `.venv/bin/python` przez `.venv\Scripts\python.exe`.

Testy przeglądarkowe wymagają uruchomionego backendu z wcześniej zbudowanym frontendem:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

Możesz wskazać istniejący Chromium zmienną `CHROMIUM_PATH`. Testy obejmują analizę powiązań i intersekcji, zawieranie, wiele regionów, odseparowane i nieprawidłowe siatki, zachowanie współrzędnych, import, kamerę, izolację, checklistę, wspólne oceny par, niezależną aktywację oraz analizę całego modelu.
