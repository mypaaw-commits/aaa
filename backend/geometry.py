"""Read-only mesh analysis. All coordinates and distances are in millimetres."""
from dataclasses import dataclass, field
from functools import lru_cache
import numpy as np
import trimesh
import manifold3d
from backend.analysis_control import AnalysisCancelled, AnalysisControl, AnalysisLimit, current_control, evaluated, stage

CONNECTION_EPS = 1e-5  # numerical tolerance, NOT a manufacturing tolerance
FIT_TOLERANCE = .001  # mm: user-selected allowance for STL/Boolean surface noise
DENSE_PROBE_MIN_FACES = 50000
MAX_EROSION_FACES = 50000


@dataclass
class Shape:
    mesh: trimesh.Trimesh
    solid: bool
    manifold: object | None
    cores: dict = field(default_factory=dict)

def prepare(mesh: trimesh.Trimesh) -> Shape:
    # Merge STL's repeated vertices on a working copy; never move source vertices.
    mesh = mesh.copy()
    mesh.merge_vertices()
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError('Pusta siatka lub nieprawidłowe współrzędne.')
    solid = bool(mesh.is_volume)
    manifold = None
    if solid:
        manifold = manifold3d.Manifold(manifold3d.Mesh64(
            vert_properties=np.asarray(mesh.vertices, dtype=np.float64),
            tri_verts=np.asarray(mesh.faces, dtype=np.uint64)))
        solid = manifold.status() == manifold3d.Error.NoError
    # Validation creates large temporary triangle/edge arrays. Keep only the small
    # cached measurements used later, rather than retaining another mesh-sized copy.
    mesh._cache.clear(exclude=['bounds', 'mass_properties', 'is_volume', 'is_watertight', 'is_winding_consistent'])
    return Shape(mesh, solid, manifold)


def bounds_distance(a: Shape, b: Shape) -> float:
    delta = np.maximum(0, np.maximum(a.mesh.bounds[0] - b.mesh.bounds[1], b.mesh.bounds[0] - a.mesh.bounds[1]))
    return float(np.linalg.norm(delta))


@lru_cache(maxsize=8)
def tolerance_kernel(tolerance):
    # Inscribed polyhedron: an empty core test is conservative relative to a
    # Euclidean surface band. Near the margin we may retain an intersection.
    return manifold3d.Manifold.sphere(tolerance, 16)


@lru_cache(maxsize=8)
def tolerance_probes(tolerance):
    vertices = tolerance_kernel(tolerance).to_mesh64().vert_properties[:, :3]
    # Opposite directions consecutively prune a surface patch before the next axis.
    directions = np.array([sign * axis for axis in np.eye(3) for sign in (-1, 1)])
    indices = dict.fromkeys(np.argmax(directions @ vertices.T, axis=1).tolist())
    return tuple(tuple(float(value) for value in vertices[index]) for index in indices)


def certifies_surface_band(source: Shape, common, tolerance: float, extended=False) -> bool:
    """Cheap sufficient test; a nonempty remainder proves nothing and needs the full erosion.

    A⊖K is contained in every A-v for v in K. Intersecting common with a subset
    of those translated solids therefore gives a SUPERSET of common∩(A⊖K).
    If that superset is empty, the original erosion test is also empty. This
    works for nonconvex meshes and disconnected overlaps, without simplifying
    either source or replacing a geometric test with a volume threshold.
    """
    remaining = common
    try:
        probes = tolerance_probes(tolerance)
        if extended:
            vertices = tolerance_kernel(tolerance).to_mesh64().vert_properties[:, :3]
            probes = tuple(dict.fromkeys((*probes, *(tuple(float(v) for v in point) for point in vertices))))
        for vertex in probes:
            remaining = evaluated(remaining ^ source.manifold.translate(tuple(-value for value in vertex)))
            if remaining.is_empty():
                return True
    except (ValueError, RuntimeError):
        return False
    return False


def certifies_core_overlap(source: Shape, other: Shape, common: trimesh.Trimesh, tolerance: float, start=0, stop=None) -> bool:
    """Sufficient deep-overlap witness using small convex kernel copies.

    For convex K, K + eK = (1+e)K. If P+(1+e)K is contained in source,
    P+eK is contained in its eroded core. A positive-volume intersection
    of that witness with the other part proves that the full core test is
    nonempty. Candidate points need not themselves be inside either solid.
    """
    kernel = tolerance_kernel(tolerance)
    # Face interiors also cover a deep overlap whose vertices lie on other source
    # faces (e.g. the corners of a thin box/box overlap). Samples only propose
    # candidates: every accepted witness still needs two exact solid operations.
    face_ids = np.unique(np.linspace(0, len(common.faces) - 1, min(32, len(common.faces)), dtype=np.intp))
    centers = np.asarray(common.vertices)[np.asarray(common.faces)[face_ids]].mean(axis=1)
    # An interior candidate often proves a real overlap before trying boundary
    # samples, which can lie exactly on the source being tested.
    candidates = np.vstack((common.bounds.mean(axis=0), centers))
    witness = kernel.scale((.02, .02, .02))
    outer = kernel.scale((1.02, 1.02, 1.02))
    try:
        for candidate in candidates[start:stop]:
            point = tuple(float(v) for v in candidate)
            outside = evaluated(outer.translate(point) - source.manifold)
            if not outside.is_empty():
                continue
            inside = evaluated(witness.translate(point) ^ other.manifold)
            if not inside.is_empty():
                volume = abs(float(inside.volume()))
                if np.isfinite(volume) and volume > 0:
                    return True
    except (ValueError, RuntimeError):
        return False
    return False


def within_tolerance(a: Shape, b: Shape, common: trimesh.Trimesh, tolerance: float, solid_common) -> bool:
    smaller = min(abs(a.mesh.volume), abs(b.mesh.volume))
    volume = abs(float(solid_common.volume()))
    if volume >= smaller * (1 - 1e-8):
        return False  # Containment of a small/thin part is never a fit.
    if volume > tolerance * solid_common.surface_area():
        return False  # Cheap candidate filter; acceptance requires both tests below.
    for source, other in sorted(((a, b), (b, a)), key=lambda pair: len(pair[0].mesh.faces)):
        if tolerance not in source.cores:
            if certifies_surface_band(source, solid_common, tolerance):
                continue
            if len(source.mesh.faces) >= DENSE_PROBE_MIN_FACES:
                if certifies_core_overlap(source, other, common, tolerance, stop=8):
                    return False
                if certifies_surface_band(source, solid_common, tolerance, extended=True):
                    continue
                if certifies_core_overlap(source, other, common, tolerance, start=8):
                    return False
                # Whole-source Minkowski erosion of millions of triangles can
                # consume minutes and many GB. An unresolved certificate is not
                # evidence of a fit or of an intersection: keep it for review.
                if len(source.mesh.faces) >= MAX_EROSION_FACES:
                    raise AnalysisLimit()
            core = source.manifold.minkowski_difference(tolerance_kernel(tolerance))
            if core.status() != manifold3d.Error.NoError:
                raise ValueError('Nie można zweryfikować marginesu dopasowania.')
            source.cores[tolerance] = core
        inside = evaluated(source.cores[tolerance] ^ other.manifold)
        if not inside.is_empty():
            return False
    return True


def analyze_pair(a: Shape, b: Shape, tolerance: float = FIT_TOLERANCE):
    control = current_control.get() or AnalysisControl()
    with control.pair():
        return _analyze_pair(a, b, tolerance)


def _analyze_pair(a: Shape, b: Shape, tolerance: float):
    """Returns metadata and optional exact Boolean intersection mesh."""
    if not np.isfinite(tolerance) or tolerance < 0:
        raise ValueError('Nieprawidłowy margines dopasowania.')
    # A stable operand order also avoids UUID-dependent Boolean triangulations.
    # It changes neither the input meshes nor the intersection being computed.
    if (len(a.mesh.faces), hash(a.mesh)) < (len(b.mesh.faces), hash(b.mesh)):
        a, b = b, a
    base = {'kind': 'UNCERTAIN', 'volume': None, 'message': '', 'coincident': False,
            'fit_tolerance': tolerance}
    stage('bounds')
    lower = bounds_distance(a, b)
    if lower > CONNECTION_EPS:
        return {**base, 'kind': 'DISCONNECTED', 'message': 'Elementy nie są ze sobą powiązane.'}, None
    if not a.solid or not b.solid:
        return {**base, 'message': 'Siatka otwarta, niespójna lub z odwróconą orientacją. Nie można pewnie ocenić bryły.'}, None
    try:
        # Mesh64 keeps double precision; the standard trimesh Boolean adapter uses float32.
        stage('intersection')
        solid_common = evaluated(a.manifold ^ b.manifold)
        volume = abs(float(solid_common.volume()))
        if not np.isfinite(volume):
            raise ValueError('Nieprawidłowa objętość przecięcia.')
        if volume > 0:
            output = solid_common.to_mesh64()
            common = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False)
            coincident = False
            # Bounds are only a cheap candidate filter. Identity requires both
            # Boolean differences to be empty, regardless of triangulation.
            if np.allclose(a.mesh.bounds, b.mesh.bounds, atol=CONNECTION_EPS, rtol=0):
                stage('coincidence')
                difference_a = evaluated(a.manifold - b.manifold)
                if difference_a.is_empty():
                    coincident = evaluated(b.manifold - a.manifold).is_empty()
            if not coincident and tolerance > 0:
                stage('fit')
                with current_control.get().fit():
                    fits = within_tolerance(a, b, common, tolerance, solid_common)
                if fits:
                    return {**base, 'kind': 'WITHIN_TOLERANCE', 'volume': volume,
                            'message': 'Dopasowanie w przyjętym marginesie. Wynik nie jest liczony jako intersekcja.'}, common
            # Borderline volumes remain uncertain unless the fit was verified.
            scale = max(float(min(a.mesh.volume, b.mesh.volume)), 1e-12)
            if not coincident and volume <= max(1e-12, scale * 1e-10):
                return {**base, 'volume': volume, 'message': 'Przenikanie na granicy precyzji obliczeń.'}, None
            return {**base, 'kind': 'INTERSECTION', 'volume': volume,
                    'coincident': bool(coincident),
                    'message': 'Elementy przenikają się. Włącz podświetlenie, aby zobaczyć wspólny obszar.'}, common
        # Surface proximity is only an internal test for a direct connection.
        # Separated parts are never proposed as related merely because they are near.
        stage('distance')
        # Reuse the existing solid hierarchy instead of building another full
        # FCL hierarchy per part. Its Python binding also holds the GIL while
        # running the native distance query, preventing polling/cancellation.
        # A capped exact distance suffices: anything > epsilon is disconnected.
        distance = float(a.manifold.min_gap(b.manifold, CONNECTION_EPS * 2))
        current_control.get().check()
        if not np.isfinite(distance) or distance < -CONNECTION_EPS:
            return {**base, 'message': 'Wyniki analizy są sprzeczne. Sprawdź tę parę ręcznie.'}, None
        connected = distance <= CONNECTION_EPS
        return {**base, 'kind': 'CONNECTED' if connected else 'DISCONNECTED', 'volume': 0.0,
                'message': 'Elementy są ze sobą powiązane. Nie wykryto intersekcji.' if connected else 'Elementy nie są ze sobą powiązane.'}, None
    except AnalysisCancelled:
        raise
    except AnalysisLimit:
        return {**base, 'reason': 'COMPUTATION_LIMIT',
                'message': 'Nie udało się potwierdzić wyniku w limicie obliczeń. Sprawdź tę parę ręcznie.'}, None
    except Exception as exc:
        return {**base, 'message': f'Analiza nie powiodła się ({type(exc).__name__}). Wymagana ręczna weryfikacja.'}, None
