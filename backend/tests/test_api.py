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


def test_demo_analysis_review_isolation_and_delete():
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    result = analyze(sid)
    assert result['job']['total'] == 3
    assert len({row['id'] for row in result['relations']}) == 3
    assert sorted(row['kind'] for row in result['relations']) == ['CONTACT', 'DISCONNECTED', 'INTERSECTION']
    intersection = next(row for row in result['relations'] if row['kind'] == 'INTERSECTION')
    assert intersection['status'] == 'TODO'
    path = f"/api/sessions/{sid}/relations/{intersection['id']}"
    assert client.patch(path, json={'status': 'FIX', 'note': 'Zmniejszyć przenikanie'}).status_code == 200
    data = client.get(path + '/intersection')
    mesh = trimesh.load(io.BytesIO(data.content), file_type='stl')
    assert mesh.volume == pytest.approx(32)
    selected = analyze(sid, {'part_ids': [parts[1]['id'], parts[2]['id']]})
    assert selected['job']['total'] == 1
    row = next(row for row in selected['relations'] if row['id'] == intersection['id'])
    assert row['note'] == 'Zmniejszyć przenikanie'
    assert row['status'] == 'FIX'
    # Results of unrelated pairs are retained; each still has a single shared status.
    assert len(selected['relations']) == 3
    assert client.delete(f"/api/sessions/{sid}/parts/{parts[2]['id']}").status_code == 200
    assert len(client.get(f'/api/sessions/{sid}/analysis').json()['relations']) == 1


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


def test_invalid_selection_threshold_and_status():
    sid = session()
    assert client.post(f'/api/sessions/{sid}/analysis', json={}).status_code == 400
    assert client.post(f'/api/sessions/{sid}/analysis', json={'gap': -1}).status_code == 422
    assert client.post(f'/api/sessions/{sid}/analysis', json={'part_ids': ['unknown', 'other']}).status_code == 404
    assert client.get('/api/sessions/missing/analysis').status_code == 404


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
