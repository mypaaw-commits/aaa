import io
import time
import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def session():
    return client.post('/api/sessions').json()['id']


def analyze(sid, payload=None):
    response = client.post(f'/api/sessions/{sid}/analysis', json=payload or {})
    assert response.status_code == 200, response.text
    for _ in range(100):
        result = client.get(f'/api/sessions/{sid}/analysis').json()
        if result['job']['state'] != 'running':
            assert result['job']['state'] == 'done', result
            return result
        time.sleep(.01)
    pytest.fail('Analysis timed out')


def test_relations_are_information_and_only_explicit_check_creates_tasks():
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    result = analyze(sid)
    assert result['job']['total'] == 3
    assert result['job']['check'] == 'RELATIONS'
    assert result['tasks'] == []
    assert len({row['id'] for row in result['relations']}) == 3
    assert sorted(row['kind'] for row in result['relations']) == ['CONNECTED', 'DISCONNECTED', 'INTERSECTION']
    assert all('status' not in row and 'note' not in row for row in result['relations'])
    intersection = next(row for row in result['relations'] if row['kind'] == 'INTERSECTION')
    path = f"/api/sessions/{sid}/relations/{intersection['id']}"
    assert client.patch(path, json={'status': 'OK', 'note': ''}).status_code in (404, 405)
    data = client.get(path + '/intersection')
    mesh = trimesh.load(io.BytesIO(data.content), file_type='stl')
    assert mesh.volume == pytest.approx(32)
    checked = analyze(sid, {'check': 'INTERSECTIONS'})
    assert len(checked['tasks']) == 3
    assert all(not task['done'] and not task['stale'] for task in checked['tasks'])
    a, b, c = [next(task for task in checked['tasks'] if task['part_id'] == part['id']) for part in parts]
    assert a['result'] == 'CLEAR'
    assert b['result'] == c['result'] == 'INTERSECTION'
    assert b['intersections'] == c['intersections'] == 1
    task_path = f"/api/sessions/{sid}/tasks/{b['id']}"
    assert client.patch(task_path, json={'done': True, 'note': 'Sprawdzono B'}).status_code == 200
    again = analyze(sid)
    assert len(again['tasks']) == 3
    assert next(task for task in again['tasks'] if task['id'] == b['id'])['done'] is True
    assert next(task for task in again['tasks'] if task['id'] == c['id'])['done'] is False
    repeated = analyze(sid, {'check': 'INTERSECTIONS'})
    assert len(repeated['tasks']) == 3
    assert next(task for task in repeated['tasks'] if task['id'] == b['id'])['done'] is True
    assert client.delete(f"/api/sessions/{sid}/parts/{parts[2]['id']}").status_code == 200
    changed = client.get(f'/api/sessions/{sid}/analysis').json()
    assert len(changed['relations']) == 1
    assert len(changed['tasks']) == 2
    assert all(task['stale'] and not task['done'] for task in changed['tasks'])
    assert client.patch(task_path, json={'done': True}).status_code == 409
    refreshed = analyze(sid, {'check': 'INTERSECTIONS'})
    assert all(task['result'] == 'CLEAR' and not task['done'] and not task['stale'] for task in refreshed['tasks'])
    assert next(task for task in refreshed['tasks'] if task['id'] == b['id'])['note'] == 'Sprawdzono B'


def test_upload_preserves_coordinates_and_reports_invalid_files():
    sid = session()
    mesh = trimesh.creation.box(); mesh.apply_translation([25, -12, 3])
    response = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('test.stl', mesh.export(file_type='stl'))), ('files', ('broken.stl', b'not stl'))])
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result['parts']) == 1
    assert len(result['errors']) == 1
    assert np.allclose(result['parts'][0]['bounds'], mesh.bounds)
    part_id = result['parts'][0]['id']
    data = client.get(f'/api/sessions/{sid}/parts/{part_id}/stl')
    loaded = trimesh.load(io.BytesIO(data.content), file_type='stl')
    assert np.allclose(loaded.bounds, mesh.bounds)


def test_coincident_pairs_are_reported_and_remain_manual_intersection_checks():
    sid = session()
    data = trimesh.creation.box().export(file_type='stl')
    response = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('first.stl', data)), ('files', ('copy.stl', data))])
    assert response.status_code == 200
    result = analyze(sid)
    assert result['relations'][0]['coincident'] is True
    assert result['tasks'] == []
    checked = analyze(sid, {'check': 'INTERSECTIONS'})
    assert len(checked['tasks']) == 2
    assert all(task['coincident_pairs'] == 1 and task['intersections'] == 1 and task['result'] == 'INTERSECTION' and not task['done'] for task in checked['tasks'])


def test_invalid_selection_and_removed_analysis_setting():
    sid = session()
    assert client.post(f'/api/sessions/{sid}/analysis', json={}).status_code == 400
    assert client.post(f'/api/sessions/{sid}/analysis', json={'gap': -1}).status_code == 422
    assert client.post(f'/api/sessions/{sid}/analysis', json={'part_ids': ['unknown', 'other']}).status_code == 422
    assert client.get('/api/sessions/missing/analysis').status_code == 404
    assert client.post(f'/api/sessions/{sid}/analysis', json={'check': 'UNKNOWN'}).status_code == 422
    assert client.patch(f'/api/sessions/{sid}/tasks/missing', json={'done': True}).status_code == 404


def test_duplicate_names_are_separate_objects():
    sid = session()
    mesh = trimesh.creation.box().export(file_type='stl')
    result = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('A.stl', mesh)), ('files', ('A.stl', mesh))]).json()
    assert len(result['parts']) == 2
    assert len(set(part['id'] for part in result['parts'])) == 2
    analyzed = analyze(sid)
    assert analyzed['relations'][0]['kind'] == 'INTERSECTION'


def test_abandoned_session_can_release_memory():
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    assert client.post(f'/api/sessions/{sid}/close').status_code == 200
    assert client.get(f'/api/sessions/{sid}/analysis').status_code == 404


def test_import_invalidates_old_checks_without_creating_new_ones():
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    checked = analyze(sid, {'check': 'INTERSECTIONS'})
    task = checked['tasks'][0]
    path = f"/api/sessions/{sid}/tasks/{task['id']}"
    assert client.patch(path, json={'done': True, 'note': 'Zachowaj uwagę'}).status_code == 200
    mesh = trimesh.creation.box(); mesh.apply_translation([100, 0, 0])
    response = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('D.stl', mesh.export(file_type='stl')))])
    assert len(response.json()['parts']) == 1
    stale = analyze(sid)
    assert len(stale['tasks']) == 3
    assert all(task['stale'] and not task['done'] for task in stale['tasks'])
    fresh = analyze(sid, {'check': 'INTERSECTIONS'})
    assert len(fresh['tasks']) == 4
    assert all(not task['done'] and not task['stale'] for task in fresh['tasks'])
    assert next(row for row in fresh['tasks'] if row['id'] == task['id'])['note'] == 'Zachowaj uwagę'


def test_uncertain_mesh_creates_uncertain_unchecked_tasks():
    sid = session()
    good = trimesh.creation.box()
    broken = good.copy(); broken.update_faces(np.arange(11))
    result = client.post(f'/api/sessions/{sid}/parts', files=[('files', ('A.stl', good.export(file_type='stl'))), ('files', ('B.stl', broken.export(file_type='stl')))])
    assert len(result.json()['parts']) == 2
    checked = analyze(sid, {'check': 'INTERSECTIONS'})
    assert len(checked['tasks']) == 2
    assert all(task['result'] == 'UNCERTAIN' and not task['done'] for task in checked['tasks'])


def test_contact_surface_endpoint_is_real_area_and_remains_informational():
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    result = analyze(sid)
    row = next(row for row in result['relations'] if row['kind'] == 'CONNECTED')
    assert row['contact_area'] == pytest.approx(64)
    assert all(not key.startswith('_') for key in row)
    response = client.get(f"/api/sessions/{sid}/relations/{row['id']}/contact")
    assert response.status_code == 200
    surface = trimesh.load(io.BytesIO(response.content), file_type='stl')
    assert surface.area == pytest.approx(64)
    assert np.allclose(surface.vertices[:, 0], -4)
    for other in result['relations']:
        if other['kind'] != 'CONNECTED':
            assert other['contact_area'] == 0
            assert client.get(f"/api/sessions/{sid}/relations/{other['id']}/contact").status_code == 404
    assert result['tasks'] == []
