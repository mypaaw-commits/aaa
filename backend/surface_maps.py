"""Cached surface measurements in mm. Source meshes are never modified."""
import struct

import numpy as np
import trimesh

from backend.analysis_control import current_control

PREVIEW_ERROR = .001
PREVIEW_MIN_FACES = 100000


def check_cancelled():
    control = current_control.get()
    if control:
        control.check_cancelled()


def preview_mesh(shape):
    if len(shape.mesh.faces) < PREVIEW_MIN_FACES or not shape.solid:
        return shape.mesh, 0.0
    simplified = shape.manifold.simplify(PREVIEW_ERROR)
    if simplified.is_empty() or simplified.status().name != 'NoError':
        return shape.mesh, 0.0
    output = simplified.to_mesh64()
    return trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False), PREVIEW_ERROR


def nearest_surface(mesh, points):
    """Exact point/triangle distances using expanding native R-tree queries.

    An AABB distance is a lower bound. Once the last nearest-box lower bound
    reaches our best triangle distance, every remaining triangle is excluded.
    Ties are returned by Rtree. Work arrays are limited to 1024 triangles.
    """
    tree = mesh.triangles_tree
    output = np.empty(len(points), dtype=np.float64)
    for index, point in enumerate(points):
        if index % 128 == 0:
            check_cancelled()
        best = np.inf
        count = min(16, len(mesh.faces))
        while True:
            ids = np.fromiter(tree.nearest(tuple(point) * 2, count), dtype=np.intp)
            farthest_bound = 0.0
            for start in range(0, len(ids), 1024):
                check_cancelled()
                triangles = np.asarray(mesh.vertices)[np.asarray(mesh.faces)[ids[start:start + 1024]]]
                bounds_min, bounds_max = triangles.min(axis=1), triangles.max(axis=1)
                delta = np.maximum(0, np.maximum(bounds_min - point, point - bounds_max))
                lower = np.einsum('ij,ij->i', delta, delta)
                farthest_bound = max(farthest_bound, float(lower.max(initial=0)))
                use = lower <= best
                if use.any():
                    closest = trimesh.triangles.closest_point(triangles[use], np.broadcast_to(point, (int(use.sum()), 3)))
                    differences = closest - point
                    best = min(best, float(np.einsum('ij,ij->i', differences, differences).min()))
            if best <= 1e-24 or farthest_bound >= best or count >= len(mesh.faces):
                break
            count = min(count * 2, len(mesh.faces))
        output[index] = np.sqrt(best)
    return output


def fit_map(a, b, common):
    # Refinement adds points on the exact existing triangles; it never moves
    # their surfaces. Coarse boxes otherwise have only shared-edge vertices,
    # whose distances are all zero despite a positive overlap between them.
    mesh = common
    while len(mesh.faces) < 512:
        mesh = mesh.subdivide()
    try:
        values = np.maximum(nearest_surface(a.mesh, mesh.vertices), nearest_surface(b.mesh, mesh.vertices))
    finally:
        for source in (a, b):
            source.mesh._cache.clear(exclude=['bounds', 'mass_properties', 'is_volume', 'is_watertight', 'is_winding_consistent'])
    return {'mesh': mesh, 'values': values.astype(np.float32), 'per_face': False}


def thickness_map(shape, surface, error, progress=None):
    """Batched normal rays against the original mesh, with double plane distances.

    Embree's float32 BVH is local to this operation and discarded afterwards.
    Translate/scale only the query copy to retain precision for remote STL
    coordinates. Ambiguous self/grazing hits stay unknown, never zero/clear.
    """
    if not shape.solid:
        return None
    from embreex.rtcore_scene import EmbreeScene
    from embreex.mesh_construction import TriangleMesh

    vertices, faces = np.asarray(shape.mesh.vertices), np.asarray(shape.mesh.faces)
    span = max(float(np.linalg.norm(shape.mesh.extents)), 1e-6)
    centre = shape.mesh.bounds.mean(axis=0)
    scale = 100 / span
    epsilon = max(span * 2e-7, 1e-9)
    check_cancelled()
    scene = EmbreeScene()
    TriangleMesh(scene, ((vertices - centre) * scale).astype(np.float32), faces.astype(np.int32))
    values = np.full(len(surface.faces), -1, dtype=np.float32)
    for start in range(0, len(surface.faces), 8192):
        check_cancelled()
        if progress:
            progress(start, len(surface.faces))
        triangles = np.asarray(surface.vertices)[np.asarray(surface.faces)[start:start + 8192]]
        points = triangles.mean(axis=1)
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        lengths = np.linalg.norm(normals, axis=1)
        directions = -normals / np.maximum(lengths[:, None], 1e-30)
        origins = points + directions * epsilon
        hits = scene.run(((origins - centre) * scale).astype(np.float32), directions.astype(np.float32))
        rays = np.flatnonzero((hits >= 0) & (lengths > 0))
        targets = vertices[faces[hits[rays]]]
        target_normals = np.cross(targets[:, 1] - targets[:, 0], targets[:, 2] - targets[:, 0])
        divisor = np.einsum('ij,ij->i', target_normals, directions[rays])
        exiting = divisor > np.linalg.norm(target_normals, axis=1) * 1e-7
        rays, targets, target_normals, divisor = rays[exiting], targets[exiting], target_normals[exiting], divisor[exiting]
        distances = np.einsum('ij,ij->i', target_normals, targets[:, 0] - points[rays]) / divisor
        intersections = points[rays] + directions[rays] * distances[:, None]
        closest = trimesh.triangles.closest_point(targets, intersections) if len(rays) else intersections
        good = (distances > epsilon) & (np.linalg.norm(closest - intersections, axis=1) <= epsilon * 2)
        values[start + rays[good]] = distances[good]
    if progress:
        progress(len(values), len(values))
    return {'mesh': surface, 'values': values, 'per_face': True, 'preview_error': error}


def thickness_summary(data, threshold):
    values = data['values']
    known = values >= 0
    return {'minimum': float(values[known].min()) if known.any() else None,
            'maximum': float(values[known].max()) if known.any() else None,
            'thin_faces': int(np.count_nonzero(known & (values < threshold))),
            'unknown_faces': int(np.count_nonzero(~known)), 'faces': len(values),
            'threshold': threshold, 'preview_error': data.get('preview_error', 0)}


def map_chunks(data):
    """MCM2: uint32 face count, followed by xyz/value for each triangle vertex."""
    mesh, values = data['mesh'], data['values']
    yield b'MCM2' + struct.pack('<I', len(mesh.faces))
    for start in range(0, len(mesh.faces), 4096):
        faces = np.asarray(mesh.faces)[start:start + 4096]
        output = np.empty((len(faces), 3, 4), dtype='<f4')
        output[:, :, :3] = np.asarray(mesh.vertices)[faces]
        output[:, :, 3] = values[start:start + len(faces), None] if data['per_face'] else values[faces]
        yield output.tobytes()
