import io

import numpy as np
import pytest
import trimesh

import backend.geometry as geometry
import backend.main as main
from backend.tests.test_api import analyze, client, session
from backend.tests.test_geometry import box


def test_dense_boolean_socket_uses_a_certificate_without_building_eroded_meshes():
    outer = geometry.prepare(trimesh.creation.icosphere(subdivisions=4, radius=4))
    key = trimesh.creation.icosphere(subdivisions=4, radius=2)
    key.apply_translation([0, 0, 3])
    output = (outer.manifold - geometry.prepare(key).manifold).to_mesh64()
    socket = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False)
    socket, key = [trimesh.load(io.BytesIO(mesh.export(file_type='stl')), file_type='stl') for mesh in (socket, key)]
    a, b = geometry.prepare(socket), geometry.prepare(key)
    assert len(a.mesh.faces) > 8000 and len(b.mesh.faces) > 5000
    vertices = [shape.mesh.vertices.copy() for shape in (a, b)]
    result, region = geometry.analyze_pair(a, b)
    assert result['kind'] == 'WITHIN_TOLERANCE'
    assert region is not None and 0 < result['volume'] < 1e-5
    assert not a.cores and not b.cores  # Avoid the dense Minkowski erosion, rather than merely timing a fast CPU.
    for shape, original in zip((a, b), vertices):
        assert np.array_equal(shape.mesh.vertices, original)


@pytest.mark.parametrize('depth', [.0005, .0009, .000999, .001001, .0011])
@pytest.mark.parametrize('angle', [np.pi / 4, .617])
def test_certificate_matches_full_erosion_near_the_margin(monkeypatch, depth, angle):
    a, b = box(), box((2 - depth, 0, 0))
    transform = trimesh.transformations.rotation_matrix(angle, [1, 2, 3])
    transform[:3, 3] = [110, -43, 12]
    a.apply_transform(transform); b.apply_transform(transform)
    fast, _ = geometry.analyze_pair(geometry.prepare(a), geometry.prepare(b))
    with monkeypatch.context() as context:
        context.setattr(geometry, 'certifies_surface_band', lambda *args: False)
        reference, _ = geometry.analyze_pair(geometry.prepare(a), geometry.prepare(b))
    assert fast == reference


def test_diagonal_near_margin_falls_back_to_full_erosion():
    a, b = box(), box((1.9991, 0, 0))
    transform = trimesh.transformations.rotation_matrix(np.pi / 4, [0, 0, 1])
    a.apply_transform(transform); b.apply_transform(transform)
    a, b = geometry.prepare(a), geometry.prepare(b)
    result, _ = geometry.analyze_pair(a, b)
    assert result['kind'] == 'WITHIN_TOLERANCE'
    assert a.cores and b.cores  # Six directions alone cannot certify this orientation/depth.


def test_cached_pairs_reused_across_checks_and_only_new_pairs_computed(monkeypatch):
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    calls = []
    original = main.analyze_pair

    def counted(a, b):
        calls.append((a, b))
        return original(a, b)

    monkeypatch.setattr(main, 'analyze_pair', counted)
    first = analyze(sid)
    assert len(calls) == 3
    assert first['job']['computed'] == 3 and first['job']['reused'] == 0
    rid = next(row['id'] for row in first['relations'] if row['kind'] == 'INTERSECTION')
    original_mesh = client.get(f'/api/sessions/{sid}/relations/{rid}/intersection').content
    repeated = analyze(sid, {'check': 'ANALYSIS'})
    assert len(calls) == 3
    assert repeated['job']['computed'] == 0 and repeated['job']['reused'] == 3
    assert repeated['relations'] == first['relations']
    assert len(repeated['tasks']) == 3 and not any(task['done'] for task in repeated['tasks'])
    cached_mesh = client.get(f'/api/sessions/{sid}/relations/{rid}/intersection')
    assert cached_mesh.status_code == 200 and cached_mesh.content == original_mesh
    assert trimesh.load(io.BytesIO(cached_mesh.content), file_type='stl').volume == pytest.approx(32)
    fourth = box((30, 0, 0)).export(file_type='stl')
    assert client.post(f'/api/sessions/{sid}/parts', files=[('files', ('D.stl', fourth))]).status_code == 200
    added = analyze(sid, {'check': 'ANALYSIS'})
    assert len(calls) == 6 and added['job']['computed'] == 3 and added['job']['reused'] == 3
    assert client.delete(f"/api/sessions/{sid}/parts/{parts[0]['id']}").status_code == 200
    removed = analyze(sid, {'check': 'ANALYSIS'})
    assert len(calls) == 6 and removed['job']['computed'] == 0 and removed['job']['reused'] == 3
    assert len(removed['tasks']) == 3


def test_uncertain_results_retry_and_tolerance_changes_invalidate_the_cache():
    sid = session()
    data = box().export(file_type='stl')
    client.post(f'/api/sessions/{sid}/parts', files=[('files', ('A.stl', data)), ('files', ('B.stl', data))])
    first = analyze(sid)
    rid = first['relations'][0]['id']
    row = main.sessions[sid]['relations'][rid]
    row['kind'] = 'UNCERTAIN'
    retried = analyze(sid)
    assert retried['job']['computed'] == 1 and retried['job']['reused'] == 0
    assert retried['relations'][0]['kind'] == 'INTERSECTION'
    main.sessions[sid]['relations'][rid]['fit_tolerance'] = .002
    changed = analyze(sid)
    assert changed['job']['computed'] == 1 and changed['job']['reused'] == 0
    assert changed['relations'][0]['fit_tolerance'] == .001
