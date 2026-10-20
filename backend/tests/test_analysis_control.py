import threading
import time
from io import BytesIO

from pypdf import PdfReader

import backend.geometry as geometry
import backend.main as main
from backend.analysis_control import AnalysisControl, current_control
from backend.tests.test_api import analyze, client, session
from backend.tests.test_geometry import box


def test_unresolved_dense_margin_is_uncertain_without_whole_source_erosion(monkeypatch):
    monkeypatch.setattr(geometry, 'DENSE_PROBE_MIN_FACES', 0)
    monkeypatch.setattr(geometry, 'MAX_EROSION_FACES', 0)
    monkeypatch.setattr(geometry, 'certifies_surface_band', lambda *args, **kwargs: False)
    monkeypatch.setattr(geometry, 'certifies_core_overlap', lambda *args, **kwargs: False)
    a, b = geometry.prepare(box()), geometry.prepare(box((1.9995, 0, 0)))
    result, mesh = geometry.analyze_pair(a, b)
    assert result['kind'] == 'UNCERTAIN' and result['reason'] == 'COMPUTATION_LIMIT'
    assert mesh is None and not a.cores and not b.cores


def test_expired_native_work_is_not_mistaken_for_an_empty_intersection(monkeypatch):
    original = geometry.evaluated

    def expired(solid):
        current_control.get().expire()
        return original(solid)

    monkeypatch.setattr(geometry, 'evaluated', expired)
    result, mesh = geometry.analyze_pair(geometry.prepare(box()), geometry.prepare(box((1, 0, 0))))
    assert result['kind'] == 'UNCERTAIN' and result['reason'] == 'COMPUTATION_LIMIT'
    assert mesh is None


def test_limit_is_per_pair_and_uncertainty_reaches_checklist_and_pdf(monkeypatch):
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    original = geometry.evaluated
    calls = []

    def expire_once(solid):
        calls.append(True)
        if len(calls) == 1:
            current_control.get().expire()
        return original(solid)

    monkeypatch.setattr(geometry, 'evaluated', expire_once)
    result = analyze(sid)
    assert result['job']['state'] == 'done' and result['job']['completed'] == 3
    uncertain = [row for row in result['relations'] if row['kind'] == 'UNCERTAIN']
    assert len(uncertain) == 1
    assert uncertain[0]['reason'] == 'COMPUTATION_LIMIT'
    assert sum(task['result'] == 'UNCERTAIN' for task in result['tasks']) == 2
    assert all(not task['done'] for task in result['tasks'])
    pdf = client.post(f'/api/sessions/{sid}/report', json={})
    text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(pdf.content)).pages)
    assert 'Needs review: 1' in text and 'MANUAL REVIEW INCOMPLETE' in text


def test_cancel_stops_worker_before_unlocking_and_preserves_complete_results(monkeypatch):
    sid = session()
    client.post(f'/api/sessions/{sid}/demo')
    previous = analyze(sid)
    tid = previous['tasks'][0]['id']
    client.patch(f'/api/sessions/{sid}/tasks/{tid}', json={'done': True, 'note': 'Keep this review'})
    before = client.get(f'/api/sessions/{sid}/analysis').json()
    # Force a real worker run despite the immutable-pair cache.
    monkeypatch.setattr(main, 'FIT_TOLERANCE', .002)
    original = main.analyze_pair
    entered, release = threading.Event(), threading.Event()

    def blocked(a, b):
        entered.set()
        assert release.wait(3)
        return original(a, b)

    monkeypatch.setattr(main, 'analyze_pair', blocked)
    response = client.post(f'/api/sessions/{sid}/analysis', json={})
    assert response.status_code == 200 and entered.wait(3)
    try:
        running = client.get(f'/api/sessions/{sid}/analysis').json()['job']
        assert running['stage'] == 'bounds' and running['seconds'] >= 0
        assert '_control' not in running
        assert client.post(f'/api/sessions/{sid}/analysis/cancel').status_code == 200
        assert main.sessions[sid]['busy']
        assert client.delete(f'/api/sessions/{sid}/parts/{next(iter(main.sessions[sid]["parts"]))}').status_code == 409
    finally:
        release.set()
    for _ in range(100):
        after = client.get(f'/api/sessions/{sid}/analysis').json()
        if after['job']['state'] != 'running':
            break
        time.sleep(.01)
    assert after['job']['state'] == 'cancelled'
    assert not main.sessions[sid]['busy']
    assert after['relations'] == before['relations'] and after['tasks'] == before['tasks']
    assert client.post(f'/api/sessions/{sid}/analysis/cancel').status_code == 200


def test_closing_busy_session_requests_cancellation():
    sid = session()
    control = AnalysisControl()
    main.sessions[sid]['job'] = {'_control': control, 'state': 'running'}
    assert client.post(f'/api/sessions/{sid}/close').status_code == 200
    assert control.cancelled.is_set() and sid not in main.sessions


# The boxes have overlapping AABBs; rejection must use actual surface distance.
def test_reused_native_distance_preserves_connection_epsilon():
    import numpy as np
    import trimesh

    for gap in (0, .000005, .00000999, .00001001, .00002):
        a, b = box(size=(10, .5, .5)), box((0, .5 + gap, 0), size=(10, .5, .5))
        transform = trimesh.transformations.rotation_matrix(np.pi / 4, [0, 0, 1])
        a.apply_transform(transform); b.apply_transform(transform)
        first, second = geometry.prepare(a), geometry.prepare(b)
        assert geometry.bounds_distance(first, second) == 0
        result, region = geometry.analyze_pair(first, second)
        assert result['kind'] == ('CONNECTED' if gap <= geometry.CONNECTION_EPS else 'DISCONNECTED')
        assert region is None
