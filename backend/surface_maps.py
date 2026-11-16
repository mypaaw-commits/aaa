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
    if len(shape.mesh.faces) < PREVIEW_MIN_FACES:
        return shape.mesh, 0.0
    if not shape.solid:
        step=max(1,int(np.ceil(len(shape.mesh.faces)/250000)))
        triangles=np.asarray(shape.mesh.vertices)[np.asarray(shape.mesh.faces)[::step]]
        return trimesh.Trimesh(vertices=triangles.reshape(-1,3),faces=np.arange(len(triangles)*3).reshape(-1,3),process=False),None
    simplified=shape.manifold.simplify(PREVIEW_ERROR)
    tolerance=PREVIEW_ERROR
    error=PREVIEW_ERROR
    maximum=max(float(np.linalg.norm(shape.mesh.extents))*.01,PREVIEW_ERROR)
    while simplified.num_tri()>300000 and tolerance<maximum:
        check_cancelled()
        tolerance=min(tolerance*2,maximum)
        simplified=simplified.simplify(tolerance)
        error+=tolerance
    if simplified.is_empty() or simplified.status().name!='NoError':
        return shape.mesh,0.0
    output=simplified.to_mesh64()
    return trimesh.Trimesh(vertices=output.vert_properties[:,:3],faces=output.tri_verts,process=False),error


def nearest_surface(mesh, points):
    """Exact nearest-triangle distances using a native AABB tree and batches."""
    import igl
    vertices=np.asarray(mesh.vertices,dtype=np.float64)
    faces=np.asarray(mesh.faces,dtype=np.int64)
    tree=igl.AABB()
    tree.init(vertices,faces)
    output=np.empty(len(points),dtype=np.float64)
    for start in range(0,len(points),16384):
        check_cancelled()
        squared,_,_=tree.squared_distance(vertices,faces,np.asarray(points[start:start+16384],dtype=np.float64))
        output[start:start+len(squared)]=np.sqrt(np.maximum(squared,0))
    return output


def fit_map(a, b, common):
    # Refinement adds points on the exact existing triangles; it never moves
    # their surfaces. Coarse boxes otherwise have only shared-edge vertices,
    # whose distances are all zero despite a positive overlap between them.
    mesh = common
    if len(mesh.faces)>300000:
        from types import SimpleNamespace
        import manifold3d
        solid=getattr(common,'_analysis_solid',None)
        if solid is None:solid=manifold3d.Manifold(manifold3d.Mesh64(np.asarray(mesh.vertices),np.asarray(mesh.faces).view(np.uint64)))
        mesh,_=preview_mesh(SimpleNamespace(mesh=mesh,solid=True,manifold=solid))
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
    minimum = float(values[known].min()) if known.any() else None
    maximum = float(values[known].max()) if known.any() else None
    def location(index):
        return np.asarray(data['mesh'].vertices)[np.asarray(data['mesh'].faces)[index]].mean(axis=0).tolist()
    low = int(np.argmin(np.where(known,values,np.inf))) if known.any() else None
    high = int(np.argmax(np.where(known,values,-np.inf))) if known.any() else None
    return {'minimum': minimum, 'maximum': maximum,
            'deficit': max(0,threshold-minimum) if minimum is not None else None,
            'minimum_location': location(low) if low is not None else None,
            'maximum_location': location(high) if high is not None else None,
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


def _clip_contact(triangle, target, normal):
    """Clip on the original triangle's plane; retain the actual contact outline."""
    polygon = [point for point in triangle]
    for index in range(3):
        edge = target[(index+1)%3] - target[index]
        origin = target[index]
        out = []
        for a,b in zip(polygon, polygon[1:]+polygon[:1]):
            da = float(np.dot(np.cross(edge,a-origin),normal))
            db = float(np.dot(np.cross(edge,b-origin),normal))
            inside_a,inside_b = da >= -1e-12, db >= -1e-12
            if inside_a: out.append(a)
            if inside_a != inside_b:
                out.append(a+(b-a)*(da/(da-db)))
        polygon = out
        if len(polygon)<3: return []
    return [[polygon[0],polygon[i],polygon[i+1]] for i in range(1,len(polygon)-1)]


def contact_map(a,b,tolerance):
    """Area patches on opposing surfaces, including zero-volume Boolean fits.

    Native short normal rays identify candidate facets in batches. Polygon
    clipping preserves contact borders instead of drawing scattered samples.
    Distances and coplanarity are checked against original double coordinates.
    """
    from embreex.rtcore_scene import EmbreeScene
    from embreex.mesh_construction import TriangleMesh
    tolerance = max(tolerance,1e-5)
    patches=[]
    for source,target in ((a,b),(b,a)):
        check_cancelled()
        centre=target.mesh.bounds.mean(axis=0)
        span=max(float(np.linalg.norm(target.mesh.extents)),1e-6)
        scale=100/span
        ray_offset=max(tolerance*2,span*4e-7)
        scene=EmbreeScene()
        TriangleMesh(scene,((np.asarray(target.mesh.vertices)-centre)*scale).astype(np.float32),np.asarray(target.mesh.faces,dtype=np.int32))
        lower,upper=target.mesh.bounds+np.array([[-tolerance]*3,[tolerance]*3])
        for start in range(0,len(source.mesh.faces),8192):
            check_cancelled()
            triangles=np.asarray(source.mesh.vertices)[np.asarray(source.mesh.faces)[start:start+8192]]
            eligible=np.all(triangles.max(axis=1)>=lower,axis=1)&np.all(triangles.min(axis=1)<=upper,axis=1)
            triangles=triangles[eligible]
            if not len(triangles):continue
            points=triangles.mean(axis=1)
            normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
            lengths=np.linalg.norm(normals,axis=1)
            directions=normals/np.maximum(lengths[:,None],1e-30)
            origins=points-directions*ray_offset
            hits=scene.run(((origins-centre)*scale).astype(np.float32),directions.astype(np.float32),dists=np.full(len(points),2*ray_offset*scale,dtype=np.float32))
            indices=np.flatnonzero((hits>=0)&(lengths>0))
            candidates=np.asarray(target.mesh.vertices)[np.asarray(target.mesh.faces)[hits[indices]]]
            cn=np.cross(candidates[:,1]-candidates[:,0],candidates[:,2]-candidates[:,0])
            cl=np.linalg.norm(cn,axis=1)
            cn/=np.maximum(cl[:,None],1e-30)
            opposing=np.einsum('ij,ij->i',directions[indices],cn)<-.999
            distance=np.max(np.abs(np.einsum('ijk,ik->ij',triangles[indices]-candidates[:,None,0],cn)),axis=1)
            accepted=np.flatnonzero(opposing&(distance<=tolerance)&(cl>0))
            for index in accepted:
                for triangle in _clip_contact(triangles[indices[index]],candidates[index],cn[index]):
                    if np.linalg.norm(np.cross(triangle[1]-triangle[0],triangle[2]-triangle[0]))>1e-16:
                        patches.append(triangle)
        del scene
    if not patches:return None
    triangles=np.asarray(patches)
    mesh=trimesh.Trimesh(vertices=triangles.reshape(-1,3),faces=np.arange(len(triangles)*3).reshape(-1,3),process=False)
    return {'mesh':mesh,'values':np.zeros(len(mesh.faces),dtype=np.float32),'per_face':True}


def thickness_display(data, preview, error):
    """Conservative display aggregation; numerical extrema retain source detail."""
    if len(data['mesh'].faces)<=300000 or preview is data['mesh']:
        return data
    from embreex.rtcore_scene import EmbreeScene
    from embreex.mesh_construction import TriangleMesh
    mesh=data['mesh']
    centre=mesh.bounds.mean(axis=0)
    span=max(float(np.linalg.norm(mesh.extents)),1e-6)
    scale=100/span
    offset=max((error or .001)*3,span*4e-7)
    scene=EmbreeScene()
    TriangleMesh(scene,((np.asarray(preview.vertices)-centre)*scale).astype(np.float32),np.asarray(preview.faces,dtype=np.int32))
    values=np.full(len(preview.faces),np.inf,dtype=np.float32)
    unknown=np.zeros(len(preview.faces),dtype=bool)
    for start in range(0,len(mesh.faces),8192):
        check_cancelled()
        triangles=np.asarray(mesh.vertices)[np.asarray(mesh.faces)[start:start+8192]]
        points=triangles.mean(axis=1)
        normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
        normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-30)
        hits=scene.run(((points+normals*offset-centre)*scale).astype(np.float32),(-normals).astype(np.float32),dists=np.full(len(points),2*offset*scale,dtype=np.float32))
        source=data['values'][start:start+len(points)]
        use=(hits>=0)&(source>=0)
        np.minimum.at(values,hits[use],source[use])
        unknown[hits[(hits>=0)&(source<0)]]=True
    values[~np.isfinite(values)|unknown]=-1
    known=data['values']>=0
    extras=[]
    if known.any():
        for index in (int(np.argmin(np.where(known,data['values'],np.inf))),int(np.argmax(np.where(known,data['values'],-np.inf)))):
            triangle=np.asarray(mesh.vertices)[np.asarray(mesh.faces)[index]]
            extras.append(trimesh.Trimesh(vertices=triangle,faces=[[0,1,2]],process=False))
            values=np.r_[values,data['values'][index]].astype(np.float32)
    return {'mesh':trimesh.util.concatenate([preview,*extras]),'values':values,'per_face':True}
