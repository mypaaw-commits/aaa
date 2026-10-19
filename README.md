# ModelCheck 3D — prototype 0.16

A local STL assembly viewer for finding directly connected parts and inspecting intersections. The interface defaults to **English**, with a **Polski** option in the top bar. Changing language keeps the current model, selection, results and notes. The language preference is stored in the browser.

[Polish interface preview](docs/polish.png)

![Expandable intersection results and a dedicated checklist tab](docs/modelcheck3d.png)

## Run on Windows

Requirements: **Python 3.12, 64-bit**, the `py` launcher, and **Node.js 22 or 24** with npm.

1. Download the source ZIP and extract it into a new folder.
2. Run `setup.cmd`. The first installation needs an Internet connection.
3. Run `start.cmd` and use the new browser tab it opens.
4. Leave the server window open. Ctrl+C stops it.

The application header should show **0.16**. Stop the previous server before updating. If its port is still occupied, the launcher chooses an available port and prints the new address. An existing browser tab continues to show its original server.

After installation, the application works offline, including fonts. It listens only on the local computer.

Manual PowerShell commands, from the repository root:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv\Scripts\python.exe run.py
```

The prototype is tested on Linux. The Windows launch scripts and dependency installation still need verification on a Windows computer.

## Workspace

- **Objects, left:** filenames and visibility controls. The bottom toolbar contains Search, Select all, Clear selection, Isolate selection and Show all. Search opens a small field above the toolbar. Hover an icon for its name.
- **3D view, center:** import STL files, orbit the camera and show intersection geometry. Import preserves coordinates and scale: 1 STL unit = 1 mm.
- **Results, right:** Connections, Checks and Part checklist tabs. Selecting a pair highlights both objects; expanding groups or switching tabs leaves selection and camera unchanged.

Colors have one meaning throughout the workspace:

| Color | Meaning |
| --- | --- |
| Matte gray | An unselected object |
| Muted blue | A selected object, from the list, viewport or a pair action |
| Red | The computed intersection region |
| Purple | Full volume coincidence, in result labels and the analysis overlay |

Selection never changes to a second color for a pair or a coincident object. The viewport legend and object swatches use the same palette. Marking an object reviewed leaves its result color unchanged. Object activation and the tutorial overlay have been removed.

![Empty workspace](docs/empty-view.png)

## Connections and intersections

**Find connections** computes informational links between directly connected parts. Connections lists every imported object as a collapsed group, including objects with no links. Expand an object to see only the parts linked to it; opening another group closes the previous one. Expanding or closing a group leaves the 3D selection unchanged. Connected, Intersection, Needs review and Coincident have different icons and visible labels. Click a linked part to select and highlight both objects without moving the camera. The magnifier button selects and frames it. **Isolate**, with a separate box icon, selects, isolates and frames the pair. Objects in the chosen pair are made visible; other objects remain visible until isolation is requested.

![Selected pair with matching object colors and separate connection actions](docs/selected-pair.png)

**Check intersections** creates a review task for every imported object and opens the Checks tab. Results and reviews now have separate tabs:

- **Checks → Intersections:** a collapsible check category containing expandable objects. Expand an object to see the parts it intersects; only one object group is open at a time. The category total counts each pair once. Inspect isolates and frames a pair, highlights both objects in blue, and enables its red or purple analysis overlay. Expanding/collapsing a group does not select anything or complete a task.
- **Part checklist, its own tab:** one compact row per imported object, with its result, manual review checkbox and optional notes. Results can be Clear, an intersection count, Needs review, or Out of date. Clear results are never checked automatically.

**Coincident** identifies two valid solids that occupy the same volume. It is shown in purple in the pair list, part results and intersection overlay. Bounds only identify candidates: both Boolean differences must be empty. Different triangulations of the same solid are accepted; close copies, containment and matching bounds alone are insufficient. This remains an intersection requiring manual review.

![Coincident solids shown in purple](docs/coincident.png)


![Grouped informational connections](docs/connections-grouped.png)

White contact-area overlays and their switch have been removed. Finding connections updates the results list without changing the 3D view. Red regions remain available only after explicitly checking intersections and enabling their overlay.

**Transparency** above the 3D view independently toggles object opacity. It works before analysis and remains separate from the intersection overlay; running a check does not turn transparency on.

The Checks and Part checklist tabs each use the full height of the results panel. The checklist currently contains intersection reviews; other check types will be added later. Notes open only when requested using the speech-bubble icon.

![Part checklist in a separate tab](docs/part-checklist.png)


![Inspect a single intersecting pair](docs/intersection-closeup.png)

Both analysis commands always check **all imported objects, including hidden ones**. Selection and isolation change the view only. You can run the intersection check directly; it also calculates connections.

Rerunning a check on the same model preserves manual reviews and notes. Adding or deleting an object marks existing tasks as Out of date, clears their review checkmarks and disables review until the check is rerun. Notes remain. New objects get tasks after the next check.

## Selection and object order

The object list follows Windows Explorer conventions:

| Action | Result |
| --- | --- |
| Click | Select one object |
| Ctrl + click | Add or remove an object |
| Shift + click | Select a range |
| Ctrl + Shift + click | Add a range |
| Drag from empty list space or its left margin | Draw a selection rectangle |
| Ctrl / Shift while drawing a rectangle | Toggle / add objects |
| Click empty space | Clear selection |
| Ctrl+A while the list has focus | Select all objects matching the search filter |
| Arrows / Home / End | Move selection; Shift extends a range, Ctrl moves focus only |
| Space / Escape | Toggle the focused object / clear selection |
| Drag a filename | Reorder objects; a line marks the insertion point |
| Alt + Up / Down | Reorder the focused object using the keyboard |
| Right click / Shift+F10 | Open the Delete context menu |

The rectangle scrolls the list automatically near its top and bottom edges. Escape during a drag restores the previous selection. Reordering preserves selection, reviews, notes and geometry; it does not rerun analysis. Ranges follow the current manual order and search filter.

![Rectangle selection and bottom object tools](docs/selection-marquee.png)

## Camera and visibility

| Action | Result |
| --- | --- |
| Projection: Perspective / Orthographic | Switch projection while keeping orientation, view center and apparent scale at that center |
| Middle mouse | Orbit around the center of the current view |
| Shift + middle mouse | Pan |
| Wheel | Zoom |
| Click a mesh | Select one object |
| Shift / Ctrl + click a mesh | Add or remove an object |
| Eye icon | Hide or show an object |
| Isolate selection | Show and frame selected objects |
| Show all / Back to full model | Restore and frame all objects |
| Frame all visible / double click in 3D | Frame visible objects |
| Floor | Toggle the grid and axes |
| Transparency | Toggle object transparency independently of results |

Both projections support framing, picking, orbit, pan, wheel zoom and resizing. Front, Top and 3D change camera direction within the chosen projection.

Ordinary selection and clicking a pair name do not move the camera. Pair framing and isolation explicitly change the view. Parts are stationary; prepare geometric variants in Blender. Inspection and camera framing do not transform STL meshes.

## Analysis and limits

- FCL checks surfaces; Manifold3D / Mesh64 computes intersection volumes. Bounding boxes are used only to reject distant pairs.
- Partial overlap, complete containment and disconnected intersection regions are supported. Invalid/open meshes, inconsistent calculations and borderline volumes are marked uncertain.
- Internal connection epsilon: **0.00001 mm**. This is a numerical tolerance, not a manufacturing tolerance. Point and edge contact count as informational connections.
- Tiny computed intersections, at or below max(10⁻¹² mm³, 10⁻¹⁰ of the smaller part's volume), are uncertain. Automatic repair and reliable detection of all self-intersections are outside this prototype.
- Import limit: **100 MiB per STL**, up to **100 objects** per session. Real-world 100 MB model performance has not yet been measured. Working memory and GPU requirements exceed file sizes.
- Geometry operations run in the background. There is no cancellation for a single long Boolean operation yet.
- **No project saving yet.** Refreshing starts a new session; restarting the server removes session data. Browser language preference is separate and persists locally. Session cleanup on tab closure is best effort.
- Future work: through-gaps, wall thickness, additional checks and project persistence.

## Development and verification

Python + FastAPI + Trimesh + Manifold3D + FCL; React + TypeScript + Three.js.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
.venv/bin/python run.py --no-browser

# Geometry, API and launcher tests
.venv/bin/python -m pytest backend/tests -q

# Browser tests, with the built frontend and backend running
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e --prefix frontend
```

For frontend development, run `npm run dev --prefix frontend`; Vite proxies `/api` to port 8000. If Chromium is not installed, run `npx playwright install chromium` from `frontend`, and omit `CHROMIUM_PATH` when using Playwright's managed browser.

Tests cover the separate checklist tab, expandable check categories and objects, consistent selection colors, informational connections that leave the 3D image unchanged, fitted socket intersections, geometry, imports, selection/ranges, rectangle scrolling, manual reordering, camera controls, visibility, independent reviews and notes, stale results, context-menu deletion and EN/PL switching and persistence.
