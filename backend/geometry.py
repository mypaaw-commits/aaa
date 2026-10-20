"""Read-only mesh analysis. All coordinates and distances are in millimetres."""
from dataclasses import dataclass, field
from functools import lru_cache
import numpy as np
import trimesh
import fcl
import manifold3d

CONNECTION_EPS = 1e-5  # numerical tolerance, NOT a manufacturing tolerance
FIT_TOLERANCE = .001  # mm: user-selected allowance for STL/Boolean surface noise


@dataclass
class Shape:
    mesh: trimesh.Trimesh
    collision: object
    solid: bool
    manifold: object | None
    cores: dict = field(default_factory=dict)


def prepare(mesh: trimesh.Trimesh) -> Shape:
    # Merge STL's repeated vertices on a working copy; never move source vertices.
    mesh = mesh.copy()
    mesh.merge_vertices()
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError('Pusta siatka lub nieprawidłowe współrzędne.')
    model = fcl.BVHModel()
    model.beginModel(len(mesh.vertices), len(mesh.faces))
    model.addSubModel(np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces, dtype=np.int32))
    model.endModel()
    solid = bool(mesh.is_volume)
    manifold = None
    if solid:
        manifold = manifold3d.Manifold(manifold3d.Mesh64(
            vert_properties=np.asarray(mesh.vertices, dtype=np.float64),
            tri_verts=np.asarray(mesh.faces, dtype=np.uint64)))
        solid = manifold.status() == manifold3d.Error.NoError
    return Shape(mesh, fcl.CollisionObject(model), solid, manifold)


def bounds_distance(a: Shape, b: Shape) -> float:
    delta = np.maximum(0, np.maximum(a.mesh.bounds[0] - b.mesh.bounds[1], b.mesh.bounds[0] - a.mesh.bounds[1]))
    return float(np.linalg.norm(delta))


@lru_cache(maxsize=8)
def tolerance_kernel(tolerance):
    # Inscribed polyhedron: an empty core test is conservative relative to a
    # Euclidean surface band. Near the margin we may retain an intersection.
    return manifold3d.Manifold.sphere(tolerance, 16)


def within_tolerance(a: Shape, b: Shape, common: trimesh.Trimesh, tolerance: float) -> bool:
    smaller = min(abs(a.mesh.volume), abs(b.mesh.volume))
    if abs(common.volume) >= smaller * (1 - 1e-8):
        return False  # Containment of a small/thin part is never a fit.
    if abs(common.volume) > tolerance * common.area:
        return False  # Cheap candidate filter; acceptance requires both tests below.
    for source, other in sorted(((a, b), (b, a)), key=lambda pair: len(pair[0].mesh.faces)):
        if tolerance not in source.cores:
            core = source.manifold.minkowski_difference(tolerance_kernel(tolerance))
            if core.status() != manifold3d.Error.NoError:
                raise ValueError('Nie można zweryfikować marginesu dopasowania.')
            source.cores[tolerance] = core
        inside = source.cores[tolerance] ^ other.manifold
        if inside.status() != manifold3d.Error.NoError:
            raise ValueError('Nie można zweryfikować marginesu dopasowania.')
        if not inside.is_empty():
            return False
    return True


def analyze_pair(a: Shape, b: Shape, tolerance: float = FIT_TOLERANCE):
    """Returns metadata and optional exact Boolean intersection mesh."""
    if not np.isfinite(tolerance) or tolerance < 0:
        raise ValueError('Nieprawidłowy margines dopasowania.')
    base = {'kind': 'UNCERTAIN', 'volume': None, 'message': '', 'coincident': False,
            'fit_tolerance': tolerance}
    lower = bounds_distance(a, b)
    if lower > CONNECTION_EPS:
        return {**base, 'kind': 'DISCONNECTED', 'message': 'Elementy nie są ze sobą powiązane.'}, None
    if not a.solid or not b.solid:
        return {**base, 'message': 'Siatka otwarta, niespójna lub z odwróconą orientacją. Nie można pewnie ocenić bryły.'}, None
    try:
        # Mesh64 keeps double precision; the standard trimesh Boolean adapter uses float32.
        solid_common = a.manifold ^ b.manifold
        if solid_common.status() != manifold3d.Error.NoError:
            raise ValueError('Silnik nie zwrócił poprawnego wyniku przecięcia.')
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
                difference_a = a.manifold - b.manifold
                difference_b = b.manifold - a.manifold
                coincident = (difference_a.status() == manifold3d.Error.NoError
                              and difference_b.status() == manifold3d.Error.NoError
                              and difference_a.is_empty() and difference_b.is_empty())
            if not coincident and tolerance > 0 and within_tolerance(a, b, common, tolerance):
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
        result = fcl.DistanceResult()
        distance = float(fcl.distance(a.collision, b.collision, fcl.DistanceRequest(), result))
        if not np.isfinite(distance) or distance < -CONNECTION_EPS:
            return {**base, 'message': 'Wyniki analizy są sprzeczne. Sprawdź tę parę ręcznie.'}, None
        connected = distance <= CONNECTION_EPS
        return {**base, 'kind': 'CONNECTED' if connected else 'DISCONNECTED', 'volume': 0.0,
                'message': 'Elementy są ze sobą powiązane. Nie wykryto intersekcji.' if connected else 'Elementy nie są ze sobą powiązane.'}, None
    except Exception as exc:
        return {**base, 'message': f'Analiza nie powiodła się ({type(exc).__name__}). Wymagana ręczna weryfikacja.'}, None
