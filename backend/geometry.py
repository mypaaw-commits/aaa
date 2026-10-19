"""Read-only mesh analysis. All coordinates and distances are in millimetres."""
from dataclasses import dataclass
import numpy as np
import trimesh
import fcl
import manifold3d

CONTACT_EPS = 1e-5  # numerical tolerance, NOT a manufacturing tolerance


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


def analyze_pair(a: Shape, b: Shape, gap: float):
    """Returns metadata and optional exact Boolean intersection mesh."""
    base = {'kind': 'UNCERTAIN', 'distance': None, 'volume': None, 'points': None, 'message': ''}
    lower = bounds_distance(a, b)
    if lower > gap + CONTACT_EPS:
        return {**base, 'kind': 'DISCONNECTED', 'message': f'Odległość co najmniej {lower:.5g} mm (filtr przestrzenny).'}, None
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
                    'distance': 0.0, 'message': 'Wspólna objętość brył.'}, common
        request = fcl.DistanceRequest(enable_nearest_points=True)
        result = fcl.DistanceResult()
        distance = float(fcl.distance(a.collision, b.collision, request, result))
        if not np.isfinite(distance) or distance < -CONTACT_EPS:
            return {**base, 'message': 'Test powierzchni i operacja bryłowa dały sprzeczne wyniki.'}, None
        distance = max(0.0, distance)
        points = np.asarray(result.nearest_points, dtype=float)
        valid_points = points.shape == (2, 3) and np.isfinite(points).all()
        # FCL does not promise nearest points for touching meshes. Use a collision witness.
        if distance <= CONTACT_EPS:
            contacts = fcl.CollisionResult()
            fcl.collide(a.collision, b.collision, fcl.CollisionRequest(num_max_contacts=1, enable_contact=True), contacts)
            if contacts.contacts:
                point = np.asarray(contacts.contacts[0].pos)
                points = np.array([point, point]); valid_points = np.isfinite(points).all()
        kind = 'CONTACT' if distance <= CONTACT_EPS else ('GAP' if distance <= gap else 'DISCONNECTED')
        return {**base, 'kind': kind, 'distance': distance, 'volume': 0.0,
                'points': points.tolist() if valid_points else None,
                'message': 'Styk w granicach tolerancji numerycznej.' if kind == 'CONTACT' else ''}, None
    except Exception as exc:
        return {**base, 'message': f'Analiza nie powiodła się ({type(exc).__name__}). Wymagana ręczna weryfikacja.'}, None
