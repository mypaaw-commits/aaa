"""Reproducible cold/reused analysis timings, without running an HTTP server.

Run from the repository root: python -m backend.benchmark_analysis --subdivisions 4
Fixture construction and import are timed separately from analysis.
"""
import argparse
import io
import json
from pathlib import Path
import time

import trimesh

from backend.geometry import prepare
from backend.main import LIMIT, add_part, create_session, run_analysis, session_for


def benchmark(subdivisions, runs, files=None):
    started = time.perf_counter()
    session = session_for(create_session()['id'])
    if files:
        for path in map(Path, files):
            if path.stat().st_size > LIMIT:
                raise ValueError(f'{path.name}: exceeds the 200 MiB file limit')
            with path.open('rb') as source:
                imported = trimesh.Trimesh(**trimesh.exchange.stl.load_stl(source), process=False)
                add_part(session, imported, path.name, path.stat().st_size)
    else:
        outer = prepare(trimesh.creation.icosphere(subdivisions=subdivisions, radius=4))
        key = trimesh.creation.icosphere(subdivisions=subdivisions, radius=2)
        key.apply_translation([0, 0, 3])
        output = (outer.manifold - prepare(key).manifold).to_mesh64()
        socket = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False)
        for name, mesh in [('socket.stl', socket), ('key.stl', key)]:
            data = mesh.export(file_type='stl')
            imported = trimesh.Trimesh(**trimesh.exchange.stl.load_stl(io.BytesIO(data)), process=False)
            add_part(session, imported, name, len(data))
    print(json.dumps({'faces': [part['meta']['faces'] for part in session['parts'].values()],
                      'file_bytes': [part['meta']['size'] for part in session['parts'].values()],
                      'fixture_and_import_seconds': round(time.perf_counter() - started, 4)}), flush=True)
    for run in range(runs):
        job = {'check': 'ANALYSIS', 'state': 'running', 'completed': 0,
               'reused': 0, 'computed': 0, '_start': time.monotonic()}
        started = time.perf_counter()
        run_analysis(session, sorted(session['parts']), job)
        if job['state'] != 'done':
            raise RuntimeError(job.get('error', 'Analysis failed'))
        print(json.dumps({'run': run + 1, 'seconds': round(time.perf_counter() - started, 6),
                          'computed': job['computed'], 'reused': job['reused'],
                          'kinds': [row['kind'] for row in session['relations'].values()]}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subdivisions', type=int, choices=range(2, 8), default=4)
    parser.add_argument('--runs', type=int, choices=range(1, 11), default=3)
    parser.add_argument('--files', nargs=2, metavar=('PART_A.stl', 'PART_B.stl'), help='Read two existing STL files instead of generating the fixture; files are not modified.')
    options = parser.parse_args()
    benchmark(options.subdivisions, options.runs, options.files)
