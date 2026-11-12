from io import BytesIO

from pypdf import PdfReader
import pytest

import backend.main as main
from backend.tests.test_api import client, session, analyze
from backend.tests.test_geometry import box


def load_pair():
    sid = session()
    data = [(name, box((x, 0, 0)).export(file_type='stl')) for name, x in [('A.stl', 0), ('B.stl', 1.9995)]]
    response = client.post(f'/api/sessions/{sid}/parts', files=[('files', (name, mesh)) for name, mesh in data])
    assert not response.json()['errors']
    return sid


def test_margin_changes_classification_invalidates_reviews_and_updates_pdf():
    sid = load_pair()
    other = load_pair()
    first = analyze(sid)
    assert first['relations'][0]['kind'] == 'WITHIN_TOLERANCE'
    task = first['tasks'][0]
    client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': 'Keep my inspection note'})
    settings = client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': .0001})
    assert settings.status_code == 200
    assert all(row['stale'] and not row['done'] for row in settings.json()['tasks'])
    assert settings.json()['tasks'][0]['note'] == 'Keep my inspection note'
    stale = client.get(f'/api/sessions/{sid}/analysis').json()
    assert stale['relations'] == [] and stale['job'] is None
    second = analyze(sid)
    assert second['relations'][0]['kind'] == 'INTERSECTION'
    assert second['job']['computed'] == 1 and second['job']['fit_tolerance'] == .0001
    assert not any(task['done'] for task in second['tasks'])
    repeated = analyze(sid)
    assert repeated['job']['reused'] == 1
    pdf = client.post(f'/api/sessions/{sid}/report', json={})
    text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(pdf.content)).pages)
    assert 'Fit margin: 0.0001 mm' in text
    assert analyze(other)['relations'][0]['kind'] == 'WITHIN_TOLERANCE'
    client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': 0})
    assert analyze(sid)['relations'][0]['kind'] == 'INTERSECTION'
    client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': .01})
    assert analyze(sid)['relations'][0]['kind'] == 'WITHIN_TOLERANCE'


def test_saving_same_margin_keeps_reviews_results_and_cached_geometry():
    sid = load_pair()
    first = analyze(sid)
    task = first['tasks'][0]
    client.patch(f"/api/sessions/{sid}/tasks/{task['id']}", json={'done': True, 'note': 'Reviewed'})
    before = client.get(f'/api/sessions/{sid}/analysis').json()
    assert client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': .001}).status_code == 200
    assert client.get(f'/api/sessions/{sid}/analysis').json() == before


@pytest.mark.parametrize('value', [-1, 10.1, True, 'NaN', 'Infinity', None])
def test_margin_validation_and_busy_protection(value):
    sid = session()
    assert client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': value}).status_code == 422
    assert main.sessions[sid]['fit_tolerance'] == .001
    main.sessions[sid]['busy'] = True
    try:
        assert client.patch(f'/api/sessions/{sid}/settings', json={'fit_tolerance': .1}).status_code == 409
    finally:
        main.sessions[sid]['busy'] = False
    assert main.sessions[sid]['fit_tolerance'] == .001
