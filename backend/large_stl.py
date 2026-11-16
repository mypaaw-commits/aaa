"""Binary STL indexing with disk-backed arrays and bounded sorting buffers."""
from pathlib import Path
from tempfile import TemporaryDirectory
import struct
import weakref
import gc
import os

import numpy as np
import trimesh

STL_DTYPE = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])
CHUNK = 65536
DISK_THRESHOLD = 64 * 1024 * 1024


class _DiskBacking:
    def __init__(self, storage, arrays):
        self.storage=storage
        self.mappings=[array._mmap for array in arrays]
        self.remaining=len(arrays)
        # Hold the directory until every NumPy root/view has released its map.
        # This also permits directory removal on Windows, which locks open maps.
        for array in arrays:weakref.finalize(array,self.release)
    def release(self):
        self.remaining-=1
        if self.remaining==0:
            for mapping in self.mappings:mapping.close()
            self.mappings=[]
            self.storage.cleanup()


def load_indexed_binary(source, progress=lambda **kw: None):
    source.seek(0, 2); size = source.tell(); source.seek(0)
    header = source.read(84)
    if len(header) != 84:
        return None
    count, = struct.unpack('<I', header[80:])
    if not count or 84 + count * 50 != size:
        source.seek(0)
        return None
    return _index_vertices(source,count,STL_DTYPE,np.dtype('<f4'),progress)


def _index_vertices(source,count,triangle_dtype,coordinate_dtype,progress):
    record_dtype=np.dtype([('point','<u4'),('xyz',coordinate_dtype,(3,))])
    coordinate_bytes=coordinate_dtype.itemsize*3
    gc.collect()
    storage = TemporaryDirectory(prefix=f'ModelCheck mesh {os.getpid()} ',ignore_cleanup_errors=True)
    root = Path(storage.name)
    handles = []
    try:
        handles = [(root / f'bucket-{i}').open('wb') for i in range(128)]
        bounds = np.array([[np.inf]*3, [-np.inf]*3])
        for start in range(0, count, CHUNK):
            records = np.frombuffer(source.read(min(CHUNK, count-start)*triangle_dtype.itemsize), dtype=triangle_dtype)
            points = records['vertices'].reshape(-1,3).copy()
            if not np.isfinite(points).all():
                raise ValueError('Invalid STL coordinates.')
            points[points == 0] = 0  # normalize the sign bit of zero only
            bounds[0] = np.minimum(bounds[0], points.min(axis=0)); bounds[1] = np.maximum(bounds[1], points.max(axis=0))
            bits = points.view('<u4' if coordinate_dtype.itemsize==4 else '<u8').astype(np.uint64)
            hashed = (bits[:,0]*73856093) ^ (bits[:,1]*19349663) ^ (bits[:,2]*83492791)
            hashed ^= hashed >> np.uint64(17)
            if coordinate_dtype.itemsize==8:
                hashed ^= hashed >> np.uint64(33)
                hashed *= np.uint64(0xff51afd7ed558ccd)
                hashed ^= hashed >> np.uint64(33)
            bucket = (hashed % 128).astype(np.uint8)
            order = np.argsort(bucket, kind='stable')
            output = np.empty(len(points), dtype=record_dtype)
            output['point'] = np.arange(start*3, start*3+len(points), dtype=np.uint32)
            output['xyz'] = points
            sorted_buckets = bucket[order]
            limits = np.r_[0, np.flatnonzero(np.diff(sorted_buckets))+1, len(order)]
            for a,b in zip(limits[:-1], limits[1:]):
                handles[int(sorted_buckets[a])].write(output[order[a:b]].tobytes())
            progress(stage='reading', completed=start+len(records), total=count)
        for handle in handles: handle.close()
        handles = []
        faces = np.memmap(root/'faces.bin', mode='w+', dtype='<i8', shape=(count,3))
        vertices = np.memmap(root/'vertices.bin', mode='w+', dtype='<f8', shape=(count*3,3))
        flat_faces = faces.reshape(-1)
        total_vertices = 0
        for bucket in range(128):
            path = root/f'bucket-{bucket}'
            # A per-bucket dictionary handles repeated points without ever
            # sorting a complete 1 GiB input or expanding all STL vertices.
            lookup = {}
            with path.open('rb') as stream:
                while True:
                    data = np.frombuffer(stream.read(CHUNK*3*record_dtype.itemsize), dtype=record_dtype)
                    if not len(data): break
                    xyz = np.ascontiguousarray(data['xyz'])
                    unique, inverse = np.unique(xyz.view(f'V{coordinate_bytes}').reshape(-1), return_inverse=True)
                    ids = np.empty(len(unique), dtype=np.int64)
                    new = []
                    for index,key in enumerate(unique):
                        value = key.tobytes()
                        found = lookup.get(value)
                        if found is None:
                            found = total_vertices + len(new)
                            lookup[value] = found
                            new.append(index)
                        ids[index] = found
                    if new:
                        vertices[total_vertices:total_vertices+len(new)] = unique[new].view(coordinate_dtype).reshape(-1,3)
                        total_vertices += len(new)
                    flat_faces[data['point']] = ids[inverse]
            path.unlink()
            progress(stage='indexing', completed=bucket+1, total=128)
        vertices.flush(); faces.flush()
        mesh = trimesh.Trimesh(vertices=vertices[:total_vertices], faces=faces, process=False)
        mesh._cache['bounds'] = bounds
        # Keep the mappings and temporary directory alive with the imported part.
        mesh._disk_storage = _DiskBacking(storage,[vertices,faces])
        return mesh
    except BaseException:
        for handle in handles: handle.close()
        storage.cleanup()
        raise


def load_indexed_ascii(source,progress=lambda **kw:None):
    """Stream ASCII vertices to a compact binary spool before disk indexing."""
    import tempfile
    source.seek(0)
    with tempfile.TemporaryFile() as binary:
        triangle_dtype=np.dtype([('vertices','<f8',(3,3))])
        vertices=[]; count=0; seen_header=False
        for raw in source:
            try:line=raw.decode('ascii').strip()
            except UnicodeDecodeError:raise ValueError('Invalid binary or ASCII STL.')
            if not line:continue
            if not seen_header:
                if not line.lower().startswith('solid'):raise ValueError('Invalid STL header.')
                seen_header=True
            if line.lower().startswith('vertex '):
                fields=line.split()
                if len(fields)!=4:raise ValueError('Invalid STL vertex.')
                try:vertices.append([float(value) for value in fields[1:]])
                except ValueError:raise ValueError('Invalid STL vertex.')
                if len(vertices)==3:
                    record=np.zeros(1,dtype=triangle_dtype);record['vertices'][0]=vertices
                    binary.write(record.tobytes());count+=1;vertices=[]
                    if count%CHUNK==0:progress(stage='reading',completed=source.tell(),total=0)
        if vertices or not count:raise ValueError('Incomplete or empty STL.')
        binary.flush();binary.seek(0)
        return _index_vertices(binary,count,triangle_dtype,np.dtype('<f8'),progress)
