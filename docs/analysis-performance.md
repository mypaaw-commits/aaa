# Unified analysis and dense STL in 0.23

The source geometry, result mesh and 0.001 mm fit margin are preserved. No decimation, bounding-box approximation of a positive intersection, or volume-only fit acceptance is used.

## Faster fit certification

The previous fit test eroded each complete source by a small polyhedral sphere using a Minkowski difference, then intersected each eroded source with the other part. On dense, nonconvex sources this was the dominant cost. Profiling a generated sphere/socket pair with 13,648 triangles attributed more than 99% of the analysis time to this test.

For source solid A, tolerance kernel K and common intersection C:

```
A ⊖ K ⊆ A − v                    for every vertex v of K
C ∩ (A ⊖ K) ⊆ C ∩ ⋂(A − v)      for any subset of those vertices
```

The new fast test selects six extremal vertices from the **same** kernel used by the original erosion. It intersects the common region with the corresponding translated copies of the source, stopping if the result becomes empty. Opposite directions are tested consecutively. Empty is sufficient to prove that the original core intersection is empty. A nonempty result proves nothing; smaller sources can fall back to the original full erosion. The dense-source guard introduced in 0.23 is described below. Engine errors in the certificate also fall back to that test.

Both source directions must pass, as before. Containment and the existing volume/area rejection filters remain unchanged. This superset argument also applies to nonconvex sources and disconnected intersection regions. It does not rely on point sampling, a small overlap volume, or an estimated depth.

Meshes are stationary; these translations exist only inside the certificate calculation. The displayed intersection is still the original Boolean intersection of the full-resolution input solids.

## Dense-pair certificates in 0.22

For sources with at least 50,000 triangles, an inconclusive six-direction test
can try additional vertices of the same kernel. The same superset proof applies;
it can certify a near-margin diagonal fit without constructing the complete erosion.

A second exact certificate can prove that a genuine core overlap exists. For
convex kernel K and e = 0.02, K + eK = (1+e)K. If a translated (1+e)K is entirely
contained in source A, the correspondingly translated eK lies inside A's eroded
core. A positive-volume intersection of that small witness with B therefore
proves a core overlap. Boolean statuses must be valid and the witness volume
must be finite and positive. Face centers supply candidate positions; samples
never decide the result without those exact containment/intersection operations.

The algorithm first tries a few witnesses, then more kernel directions, then
the remaining candidate witnesses. In 0.22, if neither certificate decided the result, the original full erosion remained the fallback. Version 0.23 changes that for dense sources, as explained below. Both source directions are
still checked before a fit is accepted. A stable, geometry-based operand order
avoids UUID-dependent triangulation choices in the Boolean engine.

## Large-file memory and I/O

The per-file limit is now **200 MiB (209,715,200 bytes)**, approximately 4.19
million binary STL triangles. The application has one **Analyze** action that
produces connections, intersection/fit findings and the manual checklist together.

- The multipart parser already spools large uploads to disk. Import reads that
  file directly and checks its actual length; a second file-sized copy is avoided.
- Import preparation and analysis share one geometry worker, reusing native
  allocator arenas and avoiding simultaneous large geometry operations. Cancelled
  import requests wait for their worker before closing the upload stream.
- In 0.22, the FCL hierarchy was built lazily only for a surface-distance query. Pairs
  resolved by bounding boxes or a positive Boolean intersection do not build it.
- Large validation scratch arrays are released after preparation. Small volume,
  bounds and validity measurements are retained.
- Fit candidate volume/area filters use the existing Boolean solid measurements
  instead of creating full NumPy triangle arrays for the common region.
- Source and intersection STL responses are exported in chunks of at most 8,192
  triangles (409,600 data bytes). The response has a correct Content-Length and
  never constructs a complete binary STL response in memory.
- Analysis polling retries transient network resets up to three times; an HTTP
  error is still reported rather than treated as a network reset.

## Reusing pair results

Part identifiers name immutable imported shapes for the lifetime of the session. The existing relation record, including its intersection mesh, can therefore be reused for the same pair and fit margin. Successive analyses use this result. No second geometry cache or duplicate overlay mesh is stored.

- Importing a new part introduces only new pair identifiers.
- Deleting parts removes their relation records; surviving pairs remain valid.
- Changing visibility, selection, list order or review notes does not change geometry.
- A different fit margin would invalidate reuse.
- Uncertain results are recomputed so a transient engine failure is not retained indefinitely.

Analyze always creates/refreshes the per-part checklist as well as connections. Cached findings never mark a review complete. Model edits still invalidate prior manual reviews and preserve surviving notes. The obsolete split API modes are rejected; POST /analysis accepts an empty JSON object or check=ANALYSIS.

## Measurements

These are local Linux cloud workspace measurements with Python 3.12 and the pinned geometry dependencies, using generated sphere/socket meshes exported to STL and loaded through the same mesh preparation path as the application. They are examples, not a speed guarantee for arbitrary STL geometry.

| Triangles, socket + key | 0.20 cold analysis | 0.21 cold analysis |
| --- | ---: | ---: |
| 8,528 + 5,120 | 16.7503 s | 0.0708 s |
| 130,312 + 81,920 | Not measured | 1.2768 s |

The compared smaller pair returned the same kind (`WITHIN_TOLERANCE`) and volume (`6.031090685388437e-09 mm³`). Subsequent direct worker runs reused the pair and took less than 0.001 s; browser polling and HTTP overhead are separate. Fixture construction and import took about 0.18 s and 2.37 s for the two sizes and are excluded from the analysis columns. The larger fixture's construction/import time includes generating its Boolean socket.

Reproduce current cold/reused measurements from the repository root without starting a server:

```bash
.venv/bin/python -m backend.benchmark_analysis --subdivisions 4
.venv/bin/python -m backend.benchmark_analysis --subdivisions 6
.venv/bin/python -m backend.benchmark_analysis --files part-a.stl part-b.stl
```

On Windows, use `.venv\Scripts\python.exe` instead. The script prints JSON with triangle counts, construction/import time, analysis time, computed/reused pair counts and classification. The historical baseline used `backend/geometry.py` from commit `0b7ae7f` on the same generated STL input.

The certificates remain inconclusive for some orientations and overlaps near the threshold. Version 0.23 exposes these as unresolved for dense sources instead of attempting the full erosion. Reuse helps subsequent checks, while the certificates target the first analysis. Timing of large files is recorded separately below; the small historical example is not a promise of sub-second analysis for a 200 MiB part.

### Large STL verification in 0.22

Two disconnected copies of a dense generated sphere/socket fixture were exported
to binary STL and then imported through the application's real multipart endpoint.
This is synthetic geometry, not a benchmark of a production miniature.

| Part | STL bytes | MiB | Triangles |
| --- | ---: | ---: | ---: |
| Socket | 205,845,284 | 196.31 | 4,116,904 |
| Key | 131,072,084 | 125.00 | 2,621,440 |

Final HTTP measurements on the cloud workspace (4 CPU quota, 32 GiB RAM):

- Upload and preparation of both files: **23.265 s**.
- First complete analysis: **27.873 s** wall time, **27.87 s** reported worker time.
- Repeated complete analysis: **0.004 s** HTTP wall time, one reused pair and no recomputation.
- Streaming the 205,845,284-byte socket back through the STL endpoint: **0.683 s**;
  the byte length and binary triangle count matched.
- The result was `WITHIN_TOLERANCE`, and two fresh manual checklist entries were
  created without marking either reviewed.
- Server high-water RSS after the run: **7,948,716 KiB** (about **7.58 GiB**).
  Memory use depends on geometry, allocator behavior and platform, and can exceed
  file size by a large factor.

The server checks used new HTTP connections to avoid an idle keepalive race in
the test client. A transient browser polling reset is covered by a separate
automated recovery test. These measurements include API import, computation and
STL transfer; browser parsing/rendering of these two large files was not timed.
GUI interaction and rendering regression tests use smaller fixtures. Windows
performance has not been measured in this Linux environment.

The generated large files are not included in the repository. The benchmark
module accepts two user-supplied STL paths with `--files`; it reads them without
modification and reports file sizes, face counts, preparation and cold/reused
analysis times.

## Verification

Tests check a dense STL socket without building eroded source meshes, compare the fast path with forced full erosion around the margin at rotated orientations, exercise a diagonal case that must fall back, retain the existing deep-needle and mixed-region regressions, and verify reuse, fresh checklist creation, unchanged overlay bytes, new/deleted parts, uncertain retries and margin invalidation. Additional tests cover actual upload length, direct spool reuse, shared worker identity, cancellation lifetime, bounded valid STL chunks, reused native surface queries, exact dense-pair witnesses, one combined analysis action, EN/PL labels and recovery from a transient polling reset.


## Dense-source guard and cancellation in 0.23

A user reported a first analysis running for more than ten minutes on two
roughly 100 MB STL files on a 16 GB machine. The original files were not provided,
so their particular bottleneck has **not** been reproduced or confirmed fixed.
The 0.22 large benchmark above concerned a Boolean fit; it did not establish
performance for arbitrary intersecting figure meshes.

The old FCL surface-distance branch constructed a second hierarchy for each
source, copying all faces and vertices. Its Cython distance call runs while
holding the Python GIL (the pinned fcl.pyx has no `with nogil` around
`defs.distance`), so a slow query can prevent API polling and cancellation.
Version 0.23 uses Manifold.min_gap with a search cap of twice the unchanged
connection epsilon. The existing solid hierarchies are reused. Values above
epsilon are disconnected; edge and point contact remain connected. Regression
tests include rotated parts with overlapping bounds and gaps on both sides of
0.00001 mm. This distance call is itself native and not a hard-cancellable task.

The expensive whole-source Minkowski fallback is no longer attempted for a
source with at least 50,000 faces. The same exact certificates run first, with an
additional candidate at the common region's bounding-box center. Each accepted
witness still requires exact containment and positive-volume overlap. If no
certificate decides a dense pair, its result is UNCERTAIN with
reason=COMPUTATION_LIMIT. This intentionally reduces automatic coverage in hard
cases rather than guessing a fit or reporting no intersections. Smaller sources
retain the full erosion fallback. The original .001 mm margin and full input
resolution are unchanged.

A 90 s per-pair timer and a 45 s fit-verification timer set a native cancellation
context and are checked between operations. They are **cooperative budgets**, not
hard deadlines: native Minkowski and other calls may take time to return.
Native Boolean results are forced under Manifold's ExecutionContext. A cancelled
or budget-exhausted solid is never treated as an empty intersection. A user stop
cancels the run without publishing partial findings or a partial checklist; the
session stays busy until the worker finishes. Closing an abandoned tab also
requests cancellation. A budget limit, in contrast, finishes the pair as Needs
review and continues the remaining pairs. Limits and uncertain findings are not
cached as successful results. The UI displays the actual stage, elapsed time,
Stop analysis, a manual-verification count and an explanation next to limited
pairs. The checklist and PDF retain the uncertain result.

Additional local Linux measurements, with the same pinned dependencies:

- Two overlapping copies of the 131,072,084-byte key STL, each with 2,621,440
  triangles: 0.22 analysis **1.170 s**, 0.23 **1.092 s**; both returned INTERSECTION
  with volume 42.4110754189054 mm³. 0.23 peak process RSS was about 2.62 GiB.
  Preparation took 19.25 s and is excluded. These files contain two disconnected
  sphere copies each; the second part was translated by 1 mm.
- Two touching copies of the same 125 MiB key fixture (4 mm translation):
  0.22 **18.678 s**, 0.23 **0.935 s**; both returned CONNECTED with zero overlap
  volume. Peak process RSS decreased from **4,414.73 MiB to 2,686.39 MiB**.
  The measured query times exclude preparation (16.88 s and 20.49 s respectively).
  This measures the surface-distance branch, not a speedup of the positive-volume
  Boolean operation or a promise about the user's intersecting models.
- The existing 125/196 MiB Boolean socket/key fixture still returned
  WITHIN_TOLERANCE in 0.23: **33.58 s** analysis and about **6.40 GiB** peak process
  RSS. Import took 22.82 s and is excluded. Runs were not otherwise isolated from
  workspace activity, so small timing differences are not speedup claims.
- An additional near-margin rotated box pair with 196,608 triangles per source
  did not finish in the externally enforced 45 s baseline run. Version 0.23
  returned **UNCERTAIN in 37.90 s**, without building whole-source cores. This is
  evidence of the coverage/performance tradeoff, **not** an equivalent complete
  analysis or evidence that the user's files are fixed.

Tests preserve the original near-margin classifications on small sources,
exercise the dense guard and expired native work, check that uncertainty reaches
both checklist and PDF, and verify actual API cancellation, busy-state lifetime,
preservation of prior reviews and abandoned-session cancellation. Browser tests
cover stage/time display, live language changes, cancellation and explicit
manual-verification results. Large browser rendering and Windows performance
remain unmeasured.
