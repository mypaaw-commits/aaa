"""Reproduce disk-backed STL import; generate a bounded-memory dense cube."""
import argparse
import json
from pathlib import Path
import struct
import tempfile
import time
import numpy as np
from backend.large_stl import STL_DTYPE,load_indexed_binary,load_indexed_ascii
from backend.geometry import prepare
from backend.surface_maps import preview_mesh


def generate_cube(path,grid=128):
    """A closed 32 mm cube with shared float32 grid coordinates on every side."""
    count=12*grid*grid
    if grid<1 or 84+count*50>1024**3:raise ValueError('Choose a grid from 1 to 1337, within the 1 GiB limit.')
    coords=np.linspace(-16,16,grid+1,dtype=np.float64).astype(np.float32)
    with Path(path).open('wb') as stream:
        stream.write(b'ModelCheck dense cube import benchmark'.ljust(80,b'\0')+struct.pack('<I',count))
        for axis in range(3):
            other=[i for i in range(3) if i!=axis]
            for sign in (-1,1):
                for start in range(0,grid*grid,65536):
                    cells=np.arange(start,min(start+65536,grid*grid));u=cells%grid;v=cells//grid
                    corners=np.zeros((len(cells),4,3),dtype=np.float32);corners[:,:,axis]=sign*16
                    for index,du,dv in ((0,0,0),(1,1,0),(2,1,1),(3,0,1)):
                        corners[:,index,other[0]]=coords[u+du];corners[:,index,other[1]]=coords[v+dv]
                    faces=[[0,1,2],[0,2,3]] if sign*(1 if axis!=1 else -1)>0 else [[0,2,1],[0,3,2]]
                    output=np.zeros(len(cells)*2,dtype=STL_DTYPE)
                    output['vertices']=corners[:,faces].reshape(-1,3,3);output['normal'][:,axis]=sign
                    stream.write(output.tobytes())
    return count


def measure(path):
    started=time.monotonic()
    with Path(path).open('rb') as stream:
        mesh=load_indexed_binary(stream)
        if mesh is None:mesh=load_indexed_ascii(stream)
    indexed=time.monotonic();shape=prepare(mesh,indexed=True);prepared=time.monotonic()
    preview,error=preview_mesh(shape);finished=time.monotonic()
    try:
        import resource
        rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
    except ImportError:rss=None
    return {'bytes':Path(path).stat().st_size,'faces':len(mesh.faces),'vertices':len(mesh.vertices),
            'solid':shape.solid,'bounds':mesh.bounds.tolist(),'volume':float(shape.manifold.volume()) if shape.solid else None,
            'preview_faces':len(preview.faces),'preview_tolerance':error,
            'index_seconds':round(indexed-started,3),'prepare_seconds':round(prepared-indexed,3),
            'preview_seconds':round(finished-prepared,3),'peak_rss_mib':rss}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file',type=Path,help='Read an existing STL without modifying it')
    parser.add_argument('--grid',type=int,default=128)
    parser.add_argument('--output',type=Path,help='Keep the generated fixture at this path')
    parser.add_argument('--generate-only',action='store_true')
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='ModelCheck benchmark ') as root:
        path=args.file or args.output or Path(root)/'cube.stl'
        if not args.file:generate_cube(path,args.grid)
        if not args.generate_only:print(json.dumps(measure(path),indent=2))
        elif args.output:print(f'Generated {path.stat().st_size} bytes: {path}')
        else:parser.error('--generate-only requires --output')

if __name__=='__main__':main()
