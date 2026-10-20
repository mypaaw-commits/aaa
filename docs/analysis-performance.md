# Intersection analysis in 0.21

The source geometry, result mesh and 0.001 mm fit margin are preserved. No decimation, bounding-box approximation of a positive intersection, or volume-only fit acceptance is used.

## Faster fit certification

The previous fit test eroded each complete source by a small polyhedral sphere using a Minkowski difference, then intersected each eroded source with the other part. On dense, nonconvex sources this was the dominant cost. Profiling a generated sphere/socket pair with 13,648 triangles attributed more than 99% of the analysis time to this test.

For source solid A, tolerance kernel K and common intersection C:

```
A ⊖ K ⊆ A − v                    for every vertex v of K
C ∩ (A ⊖ K) ⊆ C ∩ ⋂(A − v)      for any subset of those vertices
```

The new fast test selects six extremal vertices from the **same** kernel used by the original erosion. It intersects the common region with the corresponding translated copies of the source, stopping if the result becomes empty. Opposite directions are tested consecutively. Empty is sufficient to prove that the original core intersection is empty. A nonempty result proves nothing; it triggers the original full erosion. Engine errors in the certificate also fall back to that test.

Both source directions must pass, as before. Containment and the existing volume/area rejection filters remain unchanged. This superset argument also applies to nonconvex sources and disconnected intersection regions. It does not rely on point sampling, a small overlap volume, or an estimated depth.

Meshes are stationary; these translations exist only inside the certificate calculation. The displayed intersection is still the original Boolean intersection of the full-resolution input solids.

## Reusing pair results

Part identifiers name immutable imported shapes for the lifetime of the session. The existing relation record, including its intersection mesh, can therefore be reused for the same pair and fit margin. Both analysis commands use this result. No second geometry cache or duplicate overlay mesh is stored.

- Importing a new part introduces only new pair identifiers.
- Deleting parts removes their relation records; surviving pairs remain valid.
- Changing visibility, selection, list order or review notes does not change geometry.
- A different fit margin would invalidate reuse.
- Uncertain results are recomputed so a transient engine failure is not retained indefinitely.

Explicit intersection checks still create/refresh the per-part checklist. Cached findings never mark a review complete. Model edits still invalidate prior manual reviews and preserve surviving notes.

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
```

On Windows, use `.venv\Scripts\python.exe` instead. The script prints JSON with triangle counts, construction/import time, analysis time, computed/reused pair counts and classification. The historical baseline used `backend/geometry.py` from commit `0b7ae7f` on the same generated STL input.

The full erosion remains necessary for some orientations and overlaps near the threshold, so those cases can still be slow. Reuse helps subsequent checks, while the certificate targets the first analysis of ordinary shallow fit artifacts.

## Verification

Tests check a dense STL socket without building eroded source meshes, compare the fast path with forced full erosion around the margin at rotated orientations, exercise a diagonal case that must fall back, retain the existing deep-needle and mixed-region regressions, and verify reuse, fresh checklist creation, unchanged overlay bytes, new/deleted parts, uncertain retries and margin invalidation.
