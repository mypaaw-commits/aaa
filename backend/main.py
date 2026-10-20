from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from pathlib import Path
from threading import RLock
from uuid import uuid4
from typing import Literal
import tempfile
import time

import trimesh
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ConfigDict
from backend.geometry import prepare, analyze_pair, CONNECTION_EPS, FIT_TOLERANCE
from backend.reports import checklist_pdf

app = FastAPI(title='ModelCheck 3D', version='0.19.0')
executor = ThreadPoolExecutor(max_workers=1)
sessions = {}
lock = RLock()
LIMIT = 100 * 1024 * 1024


class AnalysisRequest(BaseModel):
    check: Literal['RELATIONS', 'INTERSECTIONS'] = 'RELATIONS'
    model_config = ConfigDict(extra='forbid')


class TaskReview(BaseModel):
    done: bool = Field(strict=True)
    note: str = Field(default='', max_length=5000)
    model_config = ConfigDict(extra='forbid')


class ReportRequest(BaseModel):
    language: Literal['en', 'pl'] = 'en'
    part_ids: list[str] = Field(default_factory=list, max_length=100)
    utc_offset_minutes: int = Field(default=0, ge=-840, le=840)
    model_config = ConfigDict(extra='forbid')


def session_for(sid):
    if sid not in sessions:
        raise HTTPException(404, 'Sesja wygasła. Odśwież stronę i wczytaj pliki ponownie.')
    return sessions[sid]


def idle(session):
    if session['busy']:
        raise HTTPException(409, 'Poczekaj na zakończenie bieżącej operacji.')


def invalidate_tasks(session):
    for task in session['tasks'].values():
        task.update(stale=True, done=False)


def add_part(session, mesh, name, size):
    shape = prepare(mesh)
    pid = uuid4().hex
    meta = {'id': pid, 'name': name, 'size': size, 'faces': len(shape.mesh.faces),
            'solid': shape.solid, 'bounds': shape.mesh.bounds.tolist()}
    session['parts'][pid] = {'meta': meta, 'shape': shape}
    invalidate_tasks(session)
    return meta


@app.get('/api/health')
def health():
    return {'status': 'ok', 'version': app.version, 'units': 'mm', 'connection_epsilon': CONNECTION_EPS, 'fit_tolerance': FIT_TOLERANCE}


@app.post('/api/sessions')
def create_session():
    sid = uuid4().hex
    with lock:
        sessions[sid] = {'parts': {}, 'relations': {}, 'tasks': {}, 'busy': False, 'job': None}
    return {'id': sid, 'fit_tolerance': FIT_TOLERANCE}


@app.delete('/api/sessions/{sid}')
def discard_session(sid: str):
    with lock:
        session = session_for(sid); idle(session)
        del sessions[sid]
    return {'ok': True}


@app.post('/api/sessions/{sid}/close')
def close_session(sid: str):
    # Called by pagehide/sendBeacon. An in-flight worker retains its own reference
    # until it finishes, but abandoned sessions need not keep large meshes alive.
    with lock:
        sessions.pop(sid, None)
    return {'ok': True}


@app.post('/api/sessions/{sid}/parts')
async def import_parts(sid: str, files: list[UploadFile] = File(...)):
    with lock:
        session = session_for(sid); idle(session)
        session['busy'] = True
    imported, errors = [], []
    try:
        if len(files) + len(session['parts']) > 100:
            raise HTTPException(400, 'Prototyp obsługuje do 100 części w sesji.')
        for upload in files:
            name = Path((upload.filename or '').replace('\\', '/')).name
            try:
                if not name.lower().endswith('.stl'):
                    raise ValueError('Obsługiwane są wyłącznie pliki STL.')
                # Spill to a temporary file instead of retaining an extra 100 MB byte string.
                with tempfile.TemporaryFile() as source:
                    size = 0
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        if size > LIMIT:
                            raise ValueError('Przekroczono limit 100 MB na plik.')
                        source.write(chunk)
                    source.seek(0)
                    def load_part():
                        mesh = trimesh.Trimesh(**trimesh.exchange.stl.load_stl(source), process=False)
                        return add_part(session, mesh, name, size)
                    imported.append(await run_in_threadpool(load_part))
            except Exception as exc:
                message = str(exc) if isinstance(exc, ValueError) else 'Nie można odczytać siatki STL.'
                errors.append({'name': name, 'message': message})
            finally:
                await upload.close()
    finally:
        session['busy'] = False
    return {'parts': imported, 'errors': errors}


@app.post('/api/sessions/{sid}/demo')
def demo(sid: str):
    with lock:
        session = session_for(sid); idle(session)
        if session['parts']:
            raise HTTPException(409, 'Model demonstracyjny można wczytać do pustej sceny.')
        parts = []
        for name, center in [('A.stl', -8), ('B.stl', 0), ('C.stl', 7.5)]:
            mesh = trimesh.creation.box(extents=[8, 8, 8]); mesh.apply_translation([center, 0, 4])
            parts.append(add_part(session, mesh, name, 684))
        return {'parts': parts, 'errors': []}


@app.get('/api/sessions/{sid}/parts/{pid}/stl')
def part_stl(sid: str, pid: str):
    part = session_for(sid)['parts'].get(pid)
    if part is None:
        raise HTTPException(404, 'Brak części.')
    return Response(part['shape'].mesh.export(file_type='stl'), media_type='application/octet-stream')


@app.delete('/api/sessions/{sid}/parts/{pid}')
def delete_part(sid: str, pid: str):
    with lock:
        session = session_for(sid); idle(session)
        if pid not in session['parts']:
            raise HTTPException(404, 'Brak części.')
        del session['parts'][pid]
        session['tasks'] = {tid: task for tid, task in session['tasks'].items() if task['part_id'] != pid}
        invalidate_tasks(session)
        session['relations'] = {key: rel for key, rel in session['relations'].items() if pid not in rel['part_ids']}
    return {'ok': True}


def run_analysis(session, ids, job):
    pairs = list(combinations(ids, 2))
    results = {}
    try:
        for i, (a, b) in enumerate(pairs):
            shape_a, shape_b = session['parts'][a]['shape'], session['parts'][b]['shape']
            metadata, common = analyze_pair(shape_a, shape_b)
            rid = ':'.join(sorted([a, b]))
            results[rid] = {'id': rid, 'part_ids': [a, b], **metadata, '_mesh': common}
            job['completed'] = i + 1
        session['relations'].update(results)
        if job['check'] == 'INTERSECTIONS':
            tasks = {}
            for pid in ids:
                related = [row for row in results.values() if pid in row['part_ids']]
                intersections = sum(row['kind'] == 'INTERSECTION' for row in related)
                coincident = sum(row['coincident'] for row in related)
                uncertain = sum(row['kind'] == 'UNCERTAIN' for row in related)
                fits = sum(row['kind'] == 'WITHIN_TOLERANCE' for row in related)
                tid = f'INTERSECTIONS:{pid}'
                previous = session['tasks'].get(tid, {})
                tasks[tid] = {'id': tid, 'part_id': pid, 'check': 'INTERSECTIONS',
                              'done': previous.get('done', False) if not previous.get('stale') else False,
                              'note': previous.get('note', ''), 'stale': False,
                              'result': 'UNCERTAIN' if uncertain else 'INTERSECTION' if intersections else 'WITHIN_TOLERANCE' if fits else 'CLEAR',
                              'intersections': intersections, 'uncertain_pairs': uncertain,
                              'coincident_pairs': coincident, 'fit_pairs': fits}
            session['tasks'].update(tasks)
        job['state'] = 'done'
    except Exception:
        job['state'] = 'error'; job['error'] = 'Nie udało się zakończyć analizy. Spróbuj mniejszego zestawu części.'
    finally:
        job['seconds'] = round(time.monotonic() - job['_start'], 2)
        session['busy'] = False


@app.post('/api/sessions/{sid}/analysis')
def start_analysis(sid: str, request: AnalysisRequest):
    with lock:
        session = session_for(sid); idle(session)
        ids = sorted(session['parts'])
        if len(ids) < 2:
            raise HTTPException(400, 'Wczytaj co najmniej dwie części.')
        session['busy'] = True
        job = {'id': uuid4().hex, 'check': request.check, 'state': 'running', 'completed': 0, 'total': len(ids) * (len(ids)-1)//2,
               'seconds': 0, '_start': time.monotonic(), 'error': None, 'fit_tolerance': FIT_TOLERANCE}
        session['job'] = job
        executor.submit(run_analysis, session, ids, job)
        return {key: val for key, val in job.items() if not key.startswith('_')}


@app.get('/api/sessions/{sid}/analysis')
def analysis_state(sid: str):
    session = session_for(sid)
    job = session['job']
    return {'job': {k: v for k, v in job.items() if not k.startswith('_')} if job else None,
            'relations': [{k: v for k, v in row.items() if not k.startswith('_')} for row in session['relations'].values()],
            'tasks': list(session['tasks'].values())}


@app.patch('/api/sessions/{sid}/tasks/{tid}')
def update_task(sid: str, tid: str, review: TaskReview):
    with lock:
        session = session_for(sid); idle(session)
        task = session['tasks'].get(tid)
        if not task:
            raise HTTPException(404, 'Brak zadania. Najpierw uruchom kontrolę.')
        if task['stale']:
            raise HTTPException(409, 'Model zmieniony. Najpierw ponownie uruchom kontrolę intersekcji.')
        task.update(done=review.done, note=review.note)
    return {'ok': True}


@app.get('/api/sessions/{sid}/relations/{rid}/intersection')
def intersection(sid: str, rid: str):
    row = session_for(sid)['relations'].get(rid)
    if row is None or row['_mesh'] is None:
        raise HTTPException(404, 'Brak geometrii intersekcji.')
    return Response(row['_mesh'].export(file_type='stl'), media_type='application/octet-stream')


@app.post('/api/sessions/{sid}/report')
def export_report(sid: str, request: ReportRequest):
    with lock:
        session = session_for(sid); idle(session)
        if not session['parts']:
            raise HTTPException(400, 'Wczytaj model przed eksportem checklisty.')
        ids = request.part_ids or list(session['parts'])
        if len(ids) != len(session['parts']) or set(ids) != set(session['parts']):
            raise HTTPException(409, 'Model zmieniony. Ponów eksport checklisty.')
        parts = [session['parts'][pid]['meta'].copy() for pid in ids]
        tasks = {task['part_id']: task.copy() for task in session['tasks'].values()}
    data, filename = checklist_pdf(parts, tasks, request.language, request.utc_offset_minutes, app.version, FIT_TOLERANCE)
    return Response(data, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="{filename}"', 'Cache-Control': 'no-store'})


# A built frontend is served locally by the same process. Vite proxies /api in development.
dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if dist.exists():
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')

    @app.get('/')
    def index():
        return FileResponse(dist / 'index.html', headers={'Cache-Control': 'no-store'})
