import io

import trimesh
from fastapi.testclient import TestClient
from pypdf import PdfReader

from backend.main import app
from backend.reports import checklist_pdf
from backend.tests.test_api import analyze

client = TestClient(app)


def extract(response):
    assert response.status_code == 200, response.text[:200] if response.status_code != 200 else ''
    assert response.headers['content-type'] == 'application/pdf'
    assert response.headers['content-disposition'].startswith('attachment; filename="modelcheck-checklist-')
    assert response.headers['cache-control'] == 'no-store'
    assert response.content.startswith(b'%PDF-')
    reader = PdfReader(io.BytesIO(response.content))
    return '\n'.join(page.extract_text() for page in reader.pages), reader


def demo():
    sid = client.post('/api/sessions').json()['id']
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    return sid, parts


def test_pdf_reports_unrun_partial_and_complete_review_without_hiding_errors():
    sid, parts = demo()
    path = f'/api/sessions/{sid}/report'
    unrun, _ = extract(client.post(path, json={}))
    assert 'MANUAL REVIEW INCOMPLETE' in unrun
    assert 'Reviewed: 0 / 3' in unrun
    assert 'Not checked' in unrun
    result = analyze(sid, {'check': 'INTERSECTIONS'})
    for task in result['tasks'][:1]:
        client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': 'Reviewed a joint <socket> & peg.'})
    partial, _ = extract(client.post(path, json={'part_ids': [part['id'] for part in reversed(parts)]}))
    assert 'Reviewed: 1 / 3' in partial
    assert 'MANUAL REVIEW INCOMPLETE' in partial
    assert 'Reviewed a joint <socket> & peg.' in partial
    assert partial.index(parts[2]['name']) < partial.index(parts[0]['name'])
    for task in result['tasks']:
        client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': task['note']})
    complete, _ = extract(client.post(path, json={}))
    assert 'MANUAL REVIEW COMPLETE' in complete
    assert 'Reviewed: 3 / 3' in complete
    assert 'Intersections: 1' in complete
    # A manual review does not turn an intersection into a successful analysis.
    assert 'No intersections' in complete


def test_pdf_stale_and_new_parts_are_unreviewed_but_notes_are_retained():
    sid, _ = demo()
    result = analyze(sid, {'check': 'INTERSECTIONS'})
    for task in result['tasks']:
        client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': 'Keep this note'})
    mesh = trimesh.creation.box(); mesh.apply_translation([100, 0, 0])
    client.post(f'/api/sessions/{sid}/parts', files=[('files', ('new.stl', mesh.export(file_type='stl')))])
    text, _ = extract(client.post(f'/api/sessions/{sid}/report', json={}))
    assert 'MANUAL REVIEW INCOMPLETE' in text
    assert 'Reviewed: 0 / 4' in text
    assert 'Out of date' in text and 'Not checked' in text
    assert 'Keep this note' in text
    assert 'Intersections: 1' not in text


def test_pdf_polish_names_notes_duplicate_identity_and_timezone():
    sid = client.post('/api/sessions').json()['id']
    mesh = trimesh.creation.box().export(file_type='stl')
    client.post(f'/api/sessions/{sid}/parts', files=[('files', ('Żółć.stl', mesh)), ('files', ('Żółć.stl', mesh))])
    result = analyze(sid, {'check': 'INTERSECTIONS'})
    task = result['tasks'][0]
    client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': 'Sprawdzono łączenie. <b>To tekst</b> & całość.'})
    text, reader = extract(client.post(f'/api/sessions/{sid}/report', json={'language': 'pl', 'utc_offset_minutes': 120}))
    assert 'Checklista przeglądu modelu' in text
    assert 'PRZEGLĄD RĘCZNY NIEZAKOŃCZONY' in text
    assert 'Żółć.stl · 1' in text and 'Żółć.stl · 2' in text
    assert 'Sprawdzono łączenie. <b>To tekst</b> & całość.' in ' '.join(text.split())
    assert 'Pełne pokrycie: 1' in text
    assert '0,001 mm' in text and 'UTC+02:00' in text
    assert reader.metadata.title == 'Checklista przeglądu modelu'


def test_pdf_multipage_long_unbroken_notes_repeat_headers_and_keep_all_parts():
    parts = [{'id': str(i), 'name': f'part-{i}-' + 'long-name-' * 16 + '.stl'} for i in range(12)]
    tasks = {part['id']: {'done': False, 'stale': False, 'intersections': 0, 'fit_pairs': 0,
                         'note': ('Żółć ' * 500) + 'x' * 2000 + f' END-{part["id"]}'} for part in parts}
    data, _ = checklist_pdf(parts, tasks, 'pl', 120, '0.18.0', .001)
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) > 2
    text = '\n'.join(page.extract_text() for page in reader.pages)
    for i in range(12):
        assert f'part-{i}-' in text
        assert f'END-{i}' in text
    assert text.count('Wynik analizy') >= len(reader.pages) - 1
    assert 'Brak intersekcji' in text


def test_report_rejects_empty_model_invalid_language_and_obsolete_order():
    sid = client.post('/api/sessions').json()['id']
    path = f'/api/sessions/{sid}/report'
    assert client.post(path, json={}).status_code == 400
    parts = client.post(f'/api/sessions/{sid}/demo').json()['parts']
    ids = [p['id'] for p in parts]
    for order in [ids[:2], ['unknown'] * 3, [ids[0]] * 3]:
        assert client.post(path, json={'part_ids': order}).status_code == 409
    assert client.post(path, json={'language': 'de'}).status_code == 422
    assert client.post(path, json={'utc_offset_minutes': 99999}).status_code == 422
    assert client.post('/api/sessions/missing/report', json={}).status_code == 404
