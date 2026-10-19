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


def contact_surface(a: Shape, b: Shape) -> trimesh.Trimesh | None:
    """Intersect opposing coplanar triangles, without inventing area for edges/gaps.

    Call for related valid solids. A pair can touch in one region and overlap
    in another; this surface test does not replace its volume classification.
    R-tree candidates avoid comparing every source triangle with every target.
    The tolerance handles roundoff, independently of the connection epsilon.
    """
    if len(a.mesh.faces) > len(b.mesh.faces):
        a, b = b, a
    coordinate_scale = max(float(np.max(np.abs([a.mesh.bounds, b.mesh.bounds]))), 1.)
    extent = max(float(np.max([a.mesh.extents, b.mesh.extents])), 1.)
    tolerance = extent * 1e-10 + np.finfo(float).eps * coordinate_scale * 64
    triangles_a, triangles_b = a.mesh.triangles, b.mesh.triangles
    bounds_a = np.stack((triangles_a.min(axis=1), triangles_a.max(axis=1)), axis=1)
    bounds_b = b.mesh.bounds
    candidates = np.flatnonzero(np.all(bounds_a[:, 1] >= bounds_b[0] - tolerance, axis=1)
                                & np.all(bounds_a[:, 0] <= bounds_b[1] + tolerance, axis=1))
    tree = b.mesh.triangles_tree
    patches = []

    def cross2(u, v):
        return u[0] * v[1] - u[1] * v[0]

    for index in candidates:
        triangle = triangles_a[index]
        normal = a.mesh.face_normals[index]
        query = np.concatenate((bounds_a[index, 0] - tolerance, bounds_a[index, 1] + tolerance))
        nearby = np.array(list(tree.intersection(query)), dtype=int)
        if not len(nearby):
            continue
        nearby = nearby[b.mesh.face_normals[nearby] @ normal < -1 + 1e-10]
        if not len(nearby):
            continue
        coplanar = np.max(np.abs((triangles_b[nearby] - triangle[0]) @ normal), axis=1) <= tolerance
        nearby = nearby[coplanar]
        if not len(nearby):
            continue
        u = triangle[1] - triangle[0]
        u /= np.linalg.norm(u)
        v = np.cross(normal, u)
        basis = np.column_stack((u, v))
        subject = (triangle - triangle[0]) @ basis
        for other_index in nearby:
            clip = (triangles_b[other_index] - triangle[0]) @ basis
            if cross2(clip[1] - clip[0], clip[2] - clip[0]) < 0:
                clip = clip[::-1]
            polygon = list(subject)
            for start, end in zip(clip, np.roll(clip, -1, axis=0)):
                if not polygon:
                    break
                edge = end - start
                output = []
                previous = polygon[-1]
                previous_distance = cross2(edge, previous - start)
                for current in polygon:
                    distance = cross2(edge, current - start)
                    # Strict half-planes: touching an edge produces no area.
                    if (distance >= 0) != (previous_distance >= 0):
                        output.append(previous + (current - previous) * previous_distance / (previous_distance - distance))
                    if distance >= 0:
                        output.append(current)
                    previous, previous_distance = current, distance
                polygon = output
            for offset in range(1, len(polygon) - 1):
                patch = np.array([polygon[0], polygon[offset], polygon[offset + 1]])
                if abs(cross2(patch[1] - patch[0], patch[2] - patch[0])) <= tolerance ** 2:
                    continue
                patches.append(patch @ basis.T + triangle[0])
    if not patches:
        return None
    vertices = np.asarray(patches).reshape(-1, 3)
    return trimesh.Trimesh(vertices=vertices, faces=np.arange(len(vertices)).reshape(-1, 3), process=False)


def analyze_pair(a: Shape, b: Shape):
    """Returns metadata and optional exact Boolean intersection mesh."""
    base = {'kind': 'UNCERTAIN', 'volume': None, 'message': '', 'coincident': False}
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
            coincident = False
            # Bounds are only a cheap candidate filter. Identity requires both
            # Boolean differences to be empty, regardless of triangulation.
            if np.allclose(a.mesh.bounds, b.mesh.bounds, atol=CONNECTION_EPS, rtol=0):
                difference_a = a.manifold - b.manifold
                difference_b = b.manifold - a.manifold
                coincident = (difference_a.status() == manifold3d.Error.NoError
                              and difference_b.status() == manifold3d.Error.NoError
                              and difference_a.is_empty() and difference_b.is_empty())
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
