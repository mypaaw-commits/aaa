from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from pathlib import Path
from threading import RLock
from uuid import uuid4
import tempfile
import time

import trimesh
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from backend.geometry import prepare, analyze_pair, CONTACT_EPS

app = FastAPI(title='ModelCheck 3D', version='0.1.0')
executor = ThreadPoolExecutor(max_workers=1)
sessions = {}
lock = RLock()
LIMIT = 100 * 1024 * 1024


class AnalysisRequest(BaseModel):
    part_ids: list[str] | None = None
    gap: float = Field(default=0.1, ge=0, le=10)


class Review(BaseModel):
    status: str = 'TODO'
    note: str = Field(default='', max_length=5000)


def session_for(sid):
    if sid not in sessions:
        raise HTTPException(404, 'Sesja wygasła. Odśwież stronę i wczytaj pliki ponownie.')
    return sessions[sid]


def idle(session):
    if session['busy']:
        raise HTTPException(409, 'Poczekaj na zakończenie bieżącej operacji.')


def add_part(session, mesh, name, size):
    shape = prepare(mesh)
    pid = uuid4().hex
    meta = {'id': pid, 'name': name, 'size': size, 'faces': len(shape.mesh.faces),
            'solid': shape.solid, 'bounds': shape.mesh.bounds.tolist()}
    session['parts'][pid] = {'meta': meta, 'shape': shape}
    return meta


@app.get('/api/health')
def health():
    return {'status': 'ok', 'units': 'mm', 'contact_epsilon': CONTACT_EPS}


@app.post('/api/sessions')
def create_session():
    sid = uuid4().hex
    with lock:
        sessions[sid] = {'parts': {}, 'relations': {}, 'busy': False, 'job': None}
    return {'id': sid}


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
        session['relations'] = {key: rel for key, rel in session['relations'].items() if pid not in rel['part_ids']}
    return {'ok': True}


def run_analysis(session, ids, gap, job):
    pairs = list(combinations(ids, 2))
    results = {}
    try:
        for i, (a, b) in enumerate(pairs):
            metadata, common = analyze_pair(session['parts'][a]['shape'], session['parts'][b]['shape'], gap)
            rid = ':'.join(sorted([a, b]))
            previous = session['relations'].get(rid, {})
            results[rid] = {'id': rid, 'part_ids': [a, b], **metadata,
                            'status': previous.get('status', 'TODO'), 'note': previous.get('note', ''),
                            'gap_threshold': gap, '_mesh': common}
            job['completed'] = i + 1
        session['relations'].update(results)
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
        ids = sorted(session['parts']) if request.part_ids is None else sorted(set(request.part_ids))
        if len(ids) < 2:
            raise HTTPException(400, 'Wybierz co najmniej dwie części.')
        if any(pid not in session['parts'] for pid in ids):
            raise HTTPException(404, 'Jedna z części nie istnieje.')
        session['busy'] = True
        job = {'id': uuid4().hex, 'state': 'running', 'completed': 0, 'total': len(ids) * (len(ids)-1)//2,
               'seconds': 0, '_start': time.monotonic(), 'error': None}
        session['job'] = job
        executor.submit(run_analysis, session, ids, request.gap, job)
        return {key: val for key, val in job.items() if not key.startswith('_')}


@app.get('/api/sessions/{sid}/analysis')
def analysis_state(sid: str):
    session = session_for(sid)
    job = session['job']
    return {'job': {k: v for k, v in job.items() if not k.startswith('_')} if job else None,
            'relations': [{k: v for k, v in row.items() if not k.startswith('_')} for row in session['relations'].values()]}


@app.patch('/api/sessions/{sid}/relations/{rid}')
def update_review(sid: str, rid: str, review: Review):
    with lock:
        session = session_for(sid); idle(session)
        row = session['relations'].get(rid)
        if not row:
            raise HTTPException(404, 'Brak pary.')
        if review.status not in ['TODO', 'OK', 'FIX']:
            raise HTTPException(400, 'Nieprawidłowy status.')
        row.update(status=review.status, note=review.note)
    return {'ok': True}


@app.get('/api/sessions/{sid}/relations/{rid}/intersection')
def intersection(sid: str, rid: str):
    row = session_for(sid)['relations'].get(rid)
    if row is None or row['_mesh'] is None:
        raise HTTPException(404, 'Brak geometrii intersekcji.')
    return Response(row['_mesh'].export(file_type='stl'), media_type='application/octet-stream')


# A built frontend is served locally by the same process. Vite proxies /api in development.
dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if dist.exists():
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')

    @app.get('/')
    def index():
        return FileResponse(dist / 'index.html')
