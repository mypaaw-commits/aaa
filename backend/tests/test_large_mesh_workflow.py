import asyncio
import io
import tempfile
import threading

import numpy as np
import pytest
import trimesh
from starlette.datastructures import UploadFile

import backend.geometry as geometry
import backend.main as main
from backend.stl_stream import stl_chunks
from backend.tests.test_api import client, session
from backend.tests.test_geometry import box


def test_upload_reuses_the_spooled_file_and_checks_actual_size(monkeypatch):
    sid = session()
    mesh = box((7, -5, 11))
    data = mesh.export(file_type='stl')
    source = tempfile.SpooledTemporaryFile(max_size=1)
    source.write(data)
    upload = UploadFile(source, filename='large.stl', size=1)  # A supplied size cannot bypass the real file length.
    original = main.trimesh.exchange.stl.load_stl
    seen = []
    worker_ids = []

    def loaded(file):
        assert file is source
        seen.append(file)
        worker_ids.append(threading.get_ident())
        return original(file)

    monkeypatch.setattr(main.trimesh.exchange.stl, 'load_stl', loaded)
    monkeypatch.setattr(main, 'LIMIT', len(data))
    result = asyncio.run(main.import_parts(sid, [upload]))
    assert len(result['parts']) == 1 and result['errors'] == []
    assert result['parts'][0]['size'] == len(data)
    assert np.allclose(result['parts'][0]['bounds'], mesh.bounds)
    assert len(seen) == 1 and source.closed
    assert worker_ids == [main.executor.submit(threading.get_ident).result()]
    too_large = UploadFile(io.BytesIO(data + b'x'), filename='over.stl', size=1)
    result = asyncio.run(main.import_parts(sid, [too_large]))
    assert result['parts'] == []
    assert result['errors'] == [{'name': 'over.stl', 'message': 'Przekroczono limit 200 MB na plik.'}]
    assert len(seen) == 1


def test_streamed_stl_is_valid_and_export_chunks_are_bounded():
    mesh = trimesh.creation.icosphere(subdivisions=3)
    mesh.apply_translation([11, -4, 2])
    chunks = list(stl_chunks(mesh, chunk_faces=100))
    assert len(chunks) > 10 and len(chunks[0]) == 84
    assert max(map(len, chunks)) <= 5000
    data = b''.join(chunks)
    assert len(data) == 84 + 50 * len(mesh.faces)
    restored = trimesh.load(io.BytesIO(data), file_type='stl', process=False)
    assert len(restored.faces) == len(mesh.faces)
    assert np.array_equal(restored.triangles, mesh.triangles.astype(np.float32))
    assert np.isfinite(restored.face_normals).all()
    assert np.allclose(np.linalg.norm(restored.face_normals, axis=1), 1)


def test_contact_queries_reuse_existing_manifold_hierarchies():
    a, overlap, contact, far = [geometry.prepare(box((x, 0, 0))) for x in (0, 1, 2, 20)]
    assert geometry.analyze_pair(a, overlap)[0]['kind'] == 'INTERSECTION'
    assert geometry.analyze_pair(a, far)[0]['kind'] == 'DISCONNECTED'
    assert geometry.analyze_pair(a, contact)[0]['kind'] == 'CONNECTED'
    assert geometry.analyze_pair(a, contact)[0]['kind'] == 'CONNECTED'
    assert all('collision' not in shape.__dict__ for shape in (a, overlap, contact, far))


@pytest.mark.parametrize('depth', [.0005, .0009, .000999, .001001, .0011, .002])
@pytest.mark.parametrize('angle', [np.pi / 4, .617])
def test_dense_witness_and_extended_probes_match_full_erosion(monkeypatch, depth, angle):
    a, b = box(), box((2 - depth, 0, 0))
    transform = trimesh.transformations.rotation_matrix(angle, [1, 2, 3])
    a.apply_transform(transform); b.apply_transform(transform)
    with monkeypatch.context() as context:
        context.setattr(geometry, 'DENSE_PROBE_MIN_FACES', 0)
        fast, _ = geometry.analyze_pair(geometry.prepare(a), geometry.prepare(b))
    with monkeypatch.context() as context:
        context.setattr(geometry, 'certifies_surface_band', lambda *args, **kwargs: False)
        context.setattr(geometry, 'certifies_core_overlap', lambda *args: False)
        reference, _ = geometry.analyze_pair(geometry.prepare(a), geometry.prepare(b))
    assert fast == reference


def test_old_split_analysis_modes_are_rejected():
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    for mode in ('RELATIONS', 'INTERSECTIONS'):
        assert client.post(f'/api/sessions/{sid}/analysis', json={'check': mode}).status_code == 422


def test_face_interior_witness_certifies_true_penetration_without_full_erosion(monkeypatch):
    monkeypatch.setattr(geometry, 'DENSE_PROBE_MIN_FACES', 0)
    a, b = geometry.prepare(box()), geometry.prepare(box((1.9989, 0, 0)))
    result, _ = geometry.analyze_pair(a, b)
    assert result['kind'] == 'INTERSECTION'
    assert not a.cores and not b.cores
    assert 'collision' not in a.__dict__ and 'collision' not in b.__dict__


def test_cancelled_import_waits_for_the_worker_before_closing_its_file():
    entered, release = threading.Event(), threading.Event()
    finished = []

    def work():
        entered.set()
        release.wait(timeout=3)
        finished.append(True)

    async def run():
        task = asyncio.create_task(main.geometry_work(work))
        await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finished == [True]

    asyncio.run(run())
