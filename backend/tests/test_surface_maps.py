import struct
from io import BytesIO

import numpy as np
import pytest
import trimesh
from pypdf import PdfReader

import backend.main as main
from backend.geometry import prepare
from backend.surface_maps import fit_map, nearest_surface, preview_mesh, thickness_map, thickness_summary, map_chunks
from backend.tests.test_api import client, session, analyze
from backend.tests.test_geometry import box


def test_normal_thickness_of_box_and_hollow_wall_is_measured_in_mm():
    shape = prepare(box())
    data = thickness_map(shape, shape.mesh, 0)
    assert np.allclose(data['values'], 2)
    assert thickness_summary(data, 2.1)['thin_faces'] == 12
    outer, inner = prepare(box(size=(10, 10, 10))), prepare(box(size=(9, 9, 9)))
    output = (outer.manifold - inner.manifold).to_mesh64()
    shell = prepare(trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False))
    measured = thickness_map(shell, shell.mesh, 0)
    assert np.allclose(measured['values'], .5)
    assert thickness_summary(measured, .6)['unknown_faces'] == 0
    rotated = shell.mesh.copy()
    rotated.apply_transform(trimesh.transformations.rotation_matrix(.48, [1, 2, 3]))
    rotated.apply_translation([1000000, -2000000, 3000000])
    remote = prepare(rotated)
    remote_data = thickness_map(remote, remote.mesh, 0)
    assert np.allclose(remote_data['values'], .5, atol=1e-6)


def test_fit_depth_uses_real_triangle_distance_and_retains_coarse_face_interiors():
    a, b = prepare(box()), prepare(box((1.9, 0, 0)))
    output = (a.manifold ^ b.manifold).to_mesh64()
    common = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts, process=False)
    data = fit_map(a, b, common)
    assert data['values'].max() == pytest.approx(.1)
    assert data['values'].min() == 0
    assert np.count_nonzero(data['values'] > .05) > 20
    binary = b''.join(map_chunks(data))
    assert binary[:4] == b'MCM2'
    faces, = struct.unpack('<I', binary[4:8])
    assert len(binary) == 8 + faces * 48
    values = np.frombuffer(binary, dtype='<f4', offset=8).reshape(-1, 4)[:, 3]
    assert np.isfinite(values).all() and values.max() == pytest.approx(.1)


def test_nearest_triangle_distance_matches_exhaustive_reference_on_concave_mesh():
    mesh = trimesh.util.concatenate([box((-3, 0, 0)), box((3, 0, 0))])
    mesh = mesh.subdivide().subdivide()
    points = np.random.default_rng(21).uniform([-5, -3, -3], [5, 3, 3], size=(80, 3))
    actual = nearest_surface(mesh, points)
    expected = trimesh.proximity.closest_point_naive(mesh, points)[1]
    assert np.allclose(actual, expected, atol=1e-10)


def test_maps_are_computed_once_reused_and_threshold_changes_reclassify_without_rays(monkeypatch):
    sid = session()
    data = box(size=(2, 2, .4)).export(file_type='stl')
    part = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('wall.stl', data))]).json()['parts'][0]
    calls = []
    original = main.thickness_map
    def measured(*args):
        calls.append(True)
        return original(*args)
    monkeypatch.setattr(main, 'thickness_map', measured)
    result = analyze(sid, {'thickness': True})
    assert result['tasks'][0]['thickness']['minimum'] == pytest.approx(.4)
    assert result['tasks'][0]['thickness']['thin_faces'] > 0
    first = client.get(f"/api/sessions/{sid}/parts/{part['id']}/thickness").content
    analyze(sid, {'thickness': True})
    assert len(calls) == 1
    assert client.get(f"/api/sessions/{sid}/parts/{part['id']}/thickness").content == first
    settings = client.patch(f'/api/sessions/{sid}/thickness-settings', json={'minimum': .2}).json()
    assert settings['tasks'][0]['thickness']['thin_faces'] == 0
    assert len(calls) == 1
    report = client.post(f'/api/sessions/{sid}/report', json={})
    text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(report.content)).pages)
    assert 'Wall thickness' in text and '0.2 mm' in text


def test_explicit_scope_checks_only_those_parts_and_preserves_an_all_parts_checklist():
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    analyze(sid)
    chosen = [part['id'] for part in parts[:2]]
    result = analyze(sid, {'part_ids': chosen})
    assert len(result['relations']) == 1
    assert result['job']['total'] == 1
    assert len(result['tasks']) == 3
    assert next(task for task in result['tasks'] if task['part_id'] not in chosen)['stale']
    assert client.post(f'/api/sessions/{sid}/analysis', json={'part_ids': ['missing', chosen[0]]}).status_code == 404


def test_invalid_solid_has_no_invented_thickness():
    mesh = box(); mesh.update_faces(np.arange(11))
    shape = prepare(mesh)
    assert thickness_map(shape, shape.mesh, 0) is None


def test_dense_preview_does_not_replace_or_modify_the_analysis_mesh():
    shape = prepare(trimesh.creation.icosphere(subdivisions=7, radius=4))
    vertices, faces = shape.mesh.vertices.copy(), shape.mesh.faces.copy()
    preview, error = preview_mesh(shape)
    assert error == .001 and len(preview.faces) < len(faces) // 2
    assert np.array_equal(shape.mesh.vertices, vertices)
    assert np.array_equal(shape.mesh.faces, faces)
    assert shape.solid and preview.is_volume


def test_adding_thickness_invalidates_the_old_review_and_then_reuses_the_complete_check():
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    original = analyze(sid)
    task = original['tasks'][0]
    path = f"/api/sessions/{sid}/tasks/{task['id']}"
    client.patch(path, json={'done': True, 'note': 'Keep this note'})
    with_walls = analyze(sid, {'thickness': True})
    changed = next(row for row in with_walls['tasks'] if row['id'] == task['id'])
    assert not changed['done'] and changed['note'] == 'Keep this note'
    client.patch(path, json={'done': True, 'note': 'Reviewed walls too'})
    again = analyze(sid, {'thickness': True})
    repeated = next(row for row in again['tasks'] if row['id'] == task['id'])
    assert repeated['done'] and repeated['note'] == 'Reviewed walls too'
