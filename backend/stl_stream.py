"""Binary STL chunks with bounded export working memory, including for dense meshes."""
import struct

import numpy as np

RECORD = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])


def stl_chunks(mesh, chunk_faces=8192):
    yield bytes(80) + struct.pack('<I', len(mesh.faces))
    for start in range(0, len(mesh.faces), chunk_faces):
        triangles = np.asarray(mesh.vertices)[np.asarray(mesh.faces)[start:start + chunk_faces]]
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        lengths = np.linalg.norm(normals, axis=1)
        np.divide(normals, lengths[:, None], out=normals, where=lengths[:, None] > 0)
        records = np.zeros(len(triangles), dtype=RECORD)
        records['normal'] = normals
        records['vertices'] = triangles
        yield records.tobytes()
