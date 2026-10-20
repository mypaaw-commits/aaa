from backend.main import sessions
from backend.tests.test_api import analyze, client, session


def test_batch_delete_removes_parts_and_links_and_invalidates_remaining_reviews():
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    checked = analyze(sid, {'check': 'ANALYSIS'})
    kept = next(task for task in checked['tasks'] if task['part_id'] == parts[2]['id'])
    client.patch(f"/api/sessions/{sid}/tasks/{kept['id']}", json={'done': True, 'note': 'Keep this note'})
    response = client.request('DELETE', f'/api/sessions/{sid}/parts', json={'part_ids': [part['id'] for part in parts[:2]]})
    assert response.status_code == 200
    state = client.get(f'/api/sessions/{sid}/analysis').json()
    assert state['relations'] == []
    assert len(state['tasks']) == 1
    assert state['tasks'][0]['part_id'] == parts[2]['id']
    assert state['tasks'][0]['stale'] and not state['tasks'][0]['done']
    assert state['tasks'][0]['note'] == 'Keep this note'
    for part in parts:
        assert client.get(f"/api/sessions/{sid}/parts/{part['id']}/stl").status_code == (200 if part == parts[2] else 404)
    assert client.request('DELETE', f'/api/sessions/{sid}/parts', json={'part_ids': [parts[2]['id']]}).status_code == 200
    assert sessions[sid]['parts'] == {}


def test_batch_delete_is_atomic_and_rejects_empty_or_invalid_requests():
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    checked = analyze(sid, {'check': 'ANALYSIS'})
    for body, code in [({'part_ids': [parts[0]['id'], 'missing']}, 404), ({'part_ids': []}, 422),
                       ({'part_ids': [parts[0]['id']], 'other': True}, 422)]:
        assert client.request('DELETE', f'/api/sessions/{sid}/parts', json=body).status_code == code
        assert len(sessions[sid]['parts']) == 3
        assert client.get(f'/api/sessions/{sid}/analysis').json() == checked


def test_batch_delete_rejects_a_busy_session_without_removing_anything(monkeypatch):
    sid = session()
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    with monkeypatch.context() as context:
        context.setitem(sessions[sid], 'busy', True)
        response = client.request('DELETE', f'/api/sessions/{sid}/parts', json={'part_ids': [part['id'] for part in parts]})
        assert response.status_code == 409
        assert len(sessions[sid]['parts']) == 3
    # Duplicate identifiers still identify one part and do not delete unrelated parts.
    assert client.request('DELETE', f'/api/sessions/{sid}/parts', json={'part_ids': [parts[0]['id']] * 2}).status_code == 200
    assert set(sessions[sid]['parts']) == {part['id'] for part in parts[1:]}
