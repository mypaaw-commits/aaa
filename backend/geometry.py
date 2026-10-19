"""Read-only mesh analysis. All coordinates and distances are in millimetres."""
from dataclasses import dataclass
import numpy as np
import trimesh
import fcl
import manifold3d

CONNECTION_EPS = 1e-5  # numerical tolerance, NOT a manufacturing tolerance


@dataclass
class Shape:
    mesh: trimesh.Trimesh
    collision: object
    solid: bool
    manifold: object | None


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


def analyze_pair(a: Shape, b: Shape):
    """Returns metadata and optional exact Boolean intersection mesh."""
    base = {'kind': 'UNCERTAIN', 'volume': None, 'message': ''}
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
            # Treat very small computed volumes as uncertain, never as an automatic OK.
            scale = max(float(min(a.mesh.volume, b.mesh.volume)), 1e-12)
            if volume <= max(1e-12, scale * 1e-10):
                return {**base, 'volume': volume, 'message': 'Przenikanie na granicy precyzji obliczeń.'}, None
            output = solid_common.to_mesh64()
            common = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False)
            return {**base, 'kind': 'INTERSECTION', 'volume': volume,
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
