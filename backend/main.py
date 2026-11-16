from concurrent.futures import ThreadPoolExecutor
from itertools import combinations
from pathlib import Path
from threading import RLock
from uuid import uuid4
from typing import Literal, Annotated
import asyncio
import time
import gc
import logging

import trimesh
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict
from backend.geometry import prepare, analyze_pair, CONNECTION_EPS, FIT_TOLERANCE
from backend.reports import checklist_pdf
from backend.stl_stream import stl_chunks
from backend.folders import import_folders, register as register_folders
from backend.analysis_control import AnalysisCancelled, AnalysisControl, current_control
from backend.surface_maps import preview_mesh, fit_map, thickness_map, thickness_summary, map_chunks, contact_map, thickness_display

app = FastAPI(title='ModelCheck 3D', version='0.27.0')
executor = ThreadPoolExecutor(max_workers=1)
sessions = {}
lock = RLock()
LIMIT = 1024 * 1024 * 1024


class AnalysisRequest(BaseModel):
    check: Literal['ANALYSIS', 'INTERSECTIONS', 'THICKNESS'] = 'ANALYSIS'
    part_ids: list[str] | None = Field(default=None, min_length=1, max_length=100)
    fit_map: bool = False
    thickness: bool = False
    model_config = ConfigDict(extra='forbid')


class FitSettings(BaseModel):
    fit_tolerance: float = Field(ge=0, le=10, allow_inf_nan=False, strict=True)
    model_config = ConfigDict(extra='forbid')


class ThicknessSettings(BaseModel):
    minimum: float = Field(ge=.01, le=10, allow_inf_nan=False, strict=True)
    model_config = ConfigDict(extra='forbid')


class TaskReview(BaseModel):
    done: bool = Field(strict=True)
    note: str = Field(default='', max_length=5000)
    model_config = ConfigDict(extra='forbid')


class DeletePartsRequest(BaseModel):
    part_ids: list[str] = Field(min_length=1, max_length=100)
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


def invalidate_tasks(session, check=None):
    for task in session['tasks'].values():
        if check is None or task['check'] == check:
            task.update(stale=True, done=False)


def add_part(session, mesh, name, size, folder_id=None, indexed=False):
    shape = prepare(mesh, indexed=indexed)
    pid = uuid4().hex
    meta = {'id': pid, 'name': name, 'size': size, 'faces': len(shape.mesh.faces),
            'solid': shape.solid, 'bounds': shape.mesh.bounds.tolist(), 'folder_id': folder_id}
    if session.get('import_progress'): session['import_progress'].update(stage='preview',completed=0,total=0)
    preview, error = preview_mesh(shape)
    session['parts'][pid] = {'meta': meta, 'shape': shape, '_preview': preview, '_preview_error': error}
    invalidate_tasks(session)
    return meta


async def geometry_work(function):
    # Import and analysis share one worker: reuse native allocator arenas and
    # avoid two large geometry operations competing for RAM. Keep the upload
    # open until its worker finishes, including when a request is cancelled.
    future = asyncio.get_running_loop().run_in_executor(executor, function)
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        while not future.done():
            try:
                await asyncio.shield(future)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        raise


@app.get('/api/health')
def health():
    return {'status': 'ok', 'version': app.version, 'units': 'mm', 'connection_epsilon': CONNECTION_EPS, 'fit_tolerance': FIT_TOLERANCE, 'max_file_bytes': LIMIT}


@app.post('/api/sessions')
def create_session():
    sid = uuid4().hex
    with lock:
        sessions[sid] = {'parts': {}, 'relations': {}, 'tasks': {}, 'busy': False, 'job': None,
                         'fit_tolerance': FIT_TOLERANCE, 'minimum_thickness': .5, 'thickness_results': {}, 'folders': {}, 'import_progress': None}
    return {'id': sid, 'fit_tolerance': FIT_TOLERANCE}


@app.patch('/api/sessions/{sid}/settings')
def update_fit_settings(sid: str, settings: FitSettings):
    with lock:
        session = session_for(sid); idle(session)
        if session['fit_tolerance'] != settings.fit_tolerance:
            session['fit_tolerance'] = settings.fit_tolerance
            session['relations'].clear()
            for part in session['parts'].values():
                part['shape'].cores.clear()
            session['job'] = None
            invalidate_tasks(session, 'INTERSECTIONS')
        return {'fit_tolerance': session['fit_tolerance'], 'tasks': list(session['tasks'].values())}


@app.patch('/api/sessions/{sid}/thickness-settings')
def update_thickness_settings(sid: str, settings: ThicknessSettings):
    with lock:
        session = session_for(sid); idle(session)
        if session['minimum_thickness'] != settings.minimum:
            session['minimum_thickness'] = settings.minimum
            for pid, data in session['thickness_results'].items():
                for prefix in ('INTERSECTIONS', 'THICKNESS'):
                    task = session['tasks'].get(f'{prefix}:{pid}')
                    if task is not None and (prefix == 'THICKNESS' or task.get('thickness')):
                        task['thickness'] = thickness_summary(data, settings.minimum)
                        if prefix=='THICKNESS':
                            wall=task['thickness']
                            task['result']='UNCERTAIN' if wall['unknown_faces'] else 'INTERSECTION' if wall['thin_faces'] else 'CLEAR'
                        task['done'] = False
        return {'tasks': list(session['tasks'].values())}


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
        session = sessions.pop(sid, None)
        if session and session.get('job') and session['job'].get('_control'):
            session['job']['_control'].cancel()
        collect=session is not None
        session=None
    if collect: executor.submit(gc.collect)
    return {'ok': True}


@app.post('/api/sessions/{sid}/parts')
async def import_parts(sid: str, files: list[UploadFile] = File(...), parent_folder_id: Annotated[str | None, Form()] = None):
    with lock:
        session = session_for(sid); idle(session)
        if parent_folder_id is not None and parent_folder_id not in session['folders']: raise HTTPException(404, 'Folder not found.')
        session['busy'] = True
    imported, errors = [], []
    try:
        if len(files) + len(session['parts']) > 100:
            raise HTTPException(400, 'Prototyp obsługuje do 100 części w sesji.')
        for upload in files:
            relative = (upload.filename or '').replace('\\', '/')
            name = Path(relative).name
            try:
                if not name.lower().endswith('.stl'):
                    raise ValueError('Obsługiwane są wyłącznie pliki STL.')
                def load_part():
                    # UploadFile is already spooled to disk by the multipart parser.
                    # Check the actual file length and read it directly: no second 200 MB copy.
                    source = upload.file
                    source.seek(0, 2)
                    size = source.tell()
                    if size > LIMIT:
                        raise ValueError('Maximum STL size is 1 GiB.')
                    source.seek(0)
                    from backend.large_stl import DISK_THRESHOLD, load_indexed_binary, load_indexed_ascii
                    session['import_progress'] = {'name': name, 'stage': 'reading', 'completed': 0, 'total': size}
                    def progress(**values): session['import_progress'].update(values)
                    mesh = load_indexed_binary(source, progress) if size >= DISK_THRESHOLD else None
                    if size >= DISK_THRESHOLD and mesh is None: mesh = load_indexed_ascii(source,progress)
                    indexed = mesh is not None
                    if mesh is None:
                        source.seek(0)
                        mesh = trimesh.Trimesh(**trimesh.exchange.stl.load_stl(source), process=False)
                    progress(stage='building',completed=0,total=0)
                    folder_id = import_folders(session, relative, parent_folder_id)
                    return add_part(session, mesh, name, size, folder_id, indexed)
                imported.append(await geometry_work(load_part))
            except Exception as exc:
                message = 'Not enough memory to import this STL.' if isinstance(exc,MemoryError) else 'Not enough temporary disk space.' if isinstance(exc,OSError) and exc.errno==28 else str(exc) if isinstance(exc,ValueError) else 'Nie można odczytać siatki STL.'
                errors.append({'name': name, 'message': message})
            finally:
                await upload.close()
    finally:
        session['busy'] = False
    return {'parts': imported, 'errors': errors, 'folders': list(session['folders'].values())}


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


@app.get('/api/sessions/{sid}/parts')
def part_inventory(sid: str):
    return [part['meta'] for part in session_for(sid)['parts'].values()]


@app.get('/api/sessions/{sid}/parts/{pid}/stl')
def part_stl(sid: str, pid: str):
    part = session_for(sid)['parts'].get(pid)
    if part is None:
        raise HTTPException(404, 'Brak części.')
    return mesh_response(part['shape'].mesh)


@app.get('/api/sessions/{sid}/parts/{pid}/preview')
def part_preview(sid: str, pid: str):
    part = session_for(sid)['parts'].get(pid)
    if part is None:
        raise HTTPException(404, 'Brak części.')
    return mesh_response(part['_preview'])


def map_response(data):
    data = data.get('_display',data)
    return StreamingResponse(map_chunks(data), media_type='application/octet-stream',
                             headers={'Content-Length': str(8 + 48 * len(data['mesh'].faces))})


@app.get('/api/sessions/{sid}/parts/{pid}/thickness')
def part_thickness(sid: str, pid: str):
    data = session_for(sid)['thickness_results'].get(pid)
    if data is None:
        raise HTTPException(404, 'Run thickness analysis first.')
    return map_response(data)


def mesh_response(mesh):
    return StreamingResponse(stl_chunks(mesh), media_type='application/octet-stream',
                             headers={'Content-Length': str(84 + 50 * len(mesh.faces))})


@app.delete('/api/sessions/{sid}/parts/{pid}')
def delete_part(sid: str, pid: str):
    with lock:
        session = session_for(sid); idle(session)
        remove_parts(session, {pid})
    return {'ok': True}


def remove_parts(session, ids):
    # Validate the entire selection before mutating anything: a failed batch removes nothing.
    if not ids.issubset(session['parts']):
        raise HTTPException(404, 'Brak części.')
    session['parts'] = {pid: part for pid, part in session['parts'].items() if pid not in ids}
    session['tasks'] = {tid: task for tid, task in session['tasks'].items() if task['part_id'] not in ids}
    session['relations'] = {key: rel for key, rel in session['relations'].items() if not ids.intersection(rel['part_ids'])}
    session['thickness_results'] = {key: value for key, value in session['thickness_results'].items() if key not in ids}
    invalidate_tasks(session)
    executor.submit(gc.collect)


@app.delete('/api/sessions/{sid}/parts')
def delete_parts(sid: str, request: DeletePartsRequest):
    with lock:
        session = session_for(sid); idle(session)
        remove_parts(session, set(request.part_ids))
    return {'ok': True}


def run_analysis(session, ids, job):
    pairs = list(combinations(ids, 2))
    results = {}
    measured_thickness = {}
    tolerance = job.get('fit_tolerance', session.get('fit_tolerance', FIT_TOLERANCE))
    control = job.setdefault('_control', AnalysisControl(lambda name: job.update(stage=name)))
    token = current_control.set(control)
    try:
        for i, (a, b) in enumerate(pairs):
            control.check_cancelled()
            job['part_ids'] = [a, b]
            rid = ':'.join(sorted([a, b]))
            cached = session['relations'].get(rid)
            # Imported shapes are immutable. Importing/deleting other parts or reviewing
            # a checklist does not change this pair's geometry. Uncertain results retry.
            if cached and cached['kind'] != 'UNCERTAIN' and cached['fit_tolerance'] == tolerance:
                results[rid] = cached
                job['reused'] += 1
            else:
                shape_a, shape_b = session['parts'][a]['shape'], session['parts'][b]['shape']
                metadata, common = analyze_pair(shape_a, shape_b, tolerance)
                results[rid] = {'id': rid, 'part_ids': [a, b], **metadata, '_mesh': common}
                job['computed'] += 1
            row = results[rid]
            if job['check'] == 'INTERSECTIONS' and row['kind'] in ('CONNECTED', 'WITHIN_TOLERANCE', 'UNCERTAIN') and session['parts'][a]['shape'].solid and session['parts'][b]['shape'].solid and not row.get('_contact_checked'):
                job['stage'] = 'contact'
                row = dict(row)
                row['_contact_map'] = contact_map(session['parts'][a]['shape'], session['parts'][b]['shape'], tolerance)
                row['_contact_checked'] = True
                row['contact_ready'] = row['_contact_map'] is not None
                results[rid] = row
            if job.get('fit_map') and row['_mesh'] is not None and not row.get('coincident') and not row.get('_fit_map') and (job['check'] != 'INTERSECTIONS' or row['kind'] != 'WITHIN_TOLERANCE'):
                job['stage'] = 'fit_map'
                row = dict(row)
                row['_fit_map'] = fit_map(session['parts'][a]['shape'], session['parts'][b]['shape'], row['_mesh'])
                row['map_ready'] = True
                row['depth_max'] = float(row['_fit_map']['values'].max(initial=0))
                results[rid] = row
            if row['_mesh'] is not None: row['_mesh'].__dict__.pop('_analysis_solid',None)
            job['completed'] = i + 1
        if job.get('thickness'):
            for index, pid in enumerate(ids):
                control.check_cancelled()
                job.update(stage='thickness', measured_parts=index, part_ids=[pid])
                part = session['parts'][pid]
                if '_thickness' not in part:
                    data = thickness_map(part['shape'], part['shape'].mesh, 0,
                                         lambda done, total: job.update(surface_done=done, surface_total=total))
                    if data is not None:
                        part['_thickness'] = data
                if part.get('_thickness') is not None:
                    measured_thickness[pid] = part['_thickness']
                    job.update(surface_done=len(part['_thickness']['values']), surface_total=len(part['_thickness']['values']))
            job['measured_parts'] = len(ids)
        control.check_cancelled()
        job['stage'] = 'results'
        session['relations'].update(results)
        session['thickness_results'].update(measured_thickness)
        session['_analysis_ids'] = list(ids)
        for task in session['tasks'].values():
            if task['check'] == 'INTERSECTIONS' and task['part_id'] not in ids:
                task.update(stale=True, done=False)
        tasks = {}
        for pid in ids:
            related = [row for row in results.values() if pid in row['part_ids']]
            intersections = sum(row['kind'] == 'INTERSECTION' for row in related)
            coincident = sum(row['coincident'] for row in related)
            uncertain = sum(row['kind'] == 'UNCERTAIN' for row in related)
            fits = sum(row['kind'] == 'WITHIN_TOLERANCE' for row in related)
            tid = f'INTERSECTIONS:{pid}'
            previous = session['tasks'].get(tid, {})
            thickness_error = bool(job.get('thickness')) and pid not in measured_thickness
            same_checks = (bool(previous.get('thickness')) == (pid in measured_thickness)
                           and bool(previous.get('thickness_error')) == thickness_error)
            tasks[tid] = {'id': tid, 'part_id': pid, 'check': 'INTERSECTIONS',
                          'done': previous.get('done', False) if not previous.get('stale') and same_checks else False,
                          'note': previous.get('note', ''), 'stale': False,
                          'result': 'UNCERTAIN' if uncertain else 'INTERSECTION' if intersections else 'WITHIN_TOLERANCE' if fits else 'CLEAR',
                          'intersections': intersections, 'uncertain_pairs': uncertain,
                          'coincident_pairs': coincident, 'fit_pairs': fits}
            if pid in measured_thickness:
                tasks[tid]['thickness'] = thickness_summary(measured_thickness[pid], session['minimum_thickness'])
                if tasks[tid]['thickness']['unknown_faces']:
                    tasks[tid]['result'] = 'UNCERTAIN'
            elif job.get('thickness'):
                tasks[tid]['thickness_error'] = True
                tasks[tid]['result'] = 'UNCERTAIN'
        session['tasks'].update(tasks)
        job['state'] = 'done'
    except AnalysisCancelled:
        # Cancelled runs publish no partial checklist or findings. Previous
        # complete results and manual reviews remain intact.
        job['state'] = 'cancelled'
    except Exception:
        logging.getLogger(__name__).exception('Pair analysis failed')
        job['state'] = 'error'; job['error'] = 'Nie udało się zakończyć analizy. Spróbuj mniejszego zestawu części.'
    finally:
        job['seconds'] = round(time.monotonic() - job['_start'], 2)
        session['busy'] = False
        current_control.reset(token)


def run_thickness(session, ids, job):
    control = job['_control']
    token = current_control.set(control)
    measured = {}
    tasks = {}
    try:
        for index,pid in enumerate(ids):
            control.check_cancelled()
            job.update(stage='thickness', measured_parts=index, completed=index, part_ids=[pid])
            part = session['parts'][pid]
            data = part.get('_thickness')
            if data is None:
                data = thickness_map(part['shape'],part['shape'].mesh,0,lambda done,total: job.update(surface_done=done,surface_total=total))
                if data is not None: part['_thickness'] = data
            if data is not None and not data.get('_display_ready'):
                job['stage']='display'
                displayed=thickness_display(data,part['_preview'],part['_preview_error'])
                if displayed is not data: data['_display']=displayed
                data['_display_ready']=True
            tid = f'THICKNESS:{pid}'
            previous = session['tasks'].get(tid,{})
            wall = thickness_summary(data,session['minimum_thickness']) if data is not None else None
            tasks[tid] = {'id':tid,'part_id':pid,'check':'THICKNESS','stale':False,
                'done':previous.get('done',False) and not previous.get('stale',False), 'note':previous.get('note',''),
                'result':'UNCERTAIN' if wall is None or wall['unknown_faces'] else 'INTERSECTION' if wall['thin_faces'] else 'CLEAR',
                'intersections':0,'uncertain_pairs':0,'coincident_pairs':0,'fit_pairs':0}
            if wall is not None:
                measured[pid] = data
                tasks[tid]['thickness'] = wall
            else: tasks[tid]['thickness_error'] = True
            job.update(completed=index+1, measured_parts=index+1)
        control.check_cancelled()
        for task in session['tasks'].values():
            if task['check'] == 'THICKNESS' and task['part_id'] not in ids: task.update(stale=True,done=False)
        session['thickness_results'].update(measured)
        session['tasks'].update(tasks)
        job['state']='done'
    except AnalysisCancelled:
        job['state']='cancelled'
    except Exception:
        logging.getLogger(__name__).exception('Wall thickness measurement failed')
        job['state']='error';job['error']='Wall thickness measurement failed.'
    finally:
        job['seconds']=round(time.monotonic()-job['_start'],2)
        session['busy']=False
        current_control.reset(token)


@app.post('/api/sessions/{sid}/analysis/cancel')
def cancel_analysis(sid: str):
    with lock:
        job = session_for(sid)['job']
        if job and job['state'] == 'running':
            job['_control'].cancel()
            job['stage'] = 'stopping'
    return {'ok': True}


@app.post('/api/sessions/{sid}/analysis')
def start_analysis(sid: str, request: AnalysisRequest):
    with lock:
        session = session_for(sid); idle(session)
        ids = sorted(set(request.part_ids) if request.part_ids is not None else session['parts'])
        if not set(ids).issubset(session['parts']):
            raise HTTPException(404, 'Brak części.')
        if len(ids) < (1 if request.thickness or request.check == 'THICKNESS' else 2):
            raise HTTPException(400, 'Wczytaj co najmniej dwie części.')
        session['busy'] = True
        job = {'id': uuid4().hex, 'check': request.check, 'state': 'running', 'completed': 0, 'total': len(ids) * (len(ids)-1)//2,
               'seconds': 0, '_start': time.monotonic(), 'error': None, 'fit_tolerance': session['fit_tolerance'],
               'reused': 0, 'computed': 0}
        job.update(fit_map=request.fit_map or request.check == 'INTERSECTIONS', thickness=request.thickness or request.check == 'THICKNESS', measured_parts=0, total_parts=len(ids))
        if request.check == 'THICKNESS': job['total'] = len(ids)
        job['stage'] = 'bounds'
        job['_control'] = AnalysisControl(lambda name: job.update(stage=name))
        session['job'] = job
        executor.submit(run_thickness if request.check == 'THICKNESS' else run_analysis, session, ids, job)
        return {key: val for key, val in job.items() if not key.startswith('_')}


@app.get('/api/sessions/{sid}/analysis')
def analysis_state(sid: str):
    session = session_for(sid)
    job = session['job']
    public_job = {k: v for k, v in job.items() if not k.startswith('_')} if job else None
    if job and job['state'] == 'running':
        public_job['seconds'] = round(time.monotonic() - job['_start'], 1)
    scope = set(session.get('_analysis_ids', session['parts']))
    return {'job': public_job,
            'relations': [{k: v for k, v in row.items() if not k.startswith('_')} for row in session['relations'].values() if set(row['part_ids']).issubset(scope)],
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
    return mesh_response(row['_mesh'])


@app.get('/api/sessions/{sid}/relations/{rid}/fit-map')
def relation_fit_map(sid: str, rid: str):
    row = session_for(sid)['relations'].get(rid)
    if row is None or row.get('_fit_map') is None:
        raise HTTPException(404, 'Run fit-map analysis first.')
    return map_response(row['_fit_map'])


@app.get('/api/sessions/{sid}/relations/{rid}/contact-map')
def relation_contact_map(sid: str, rid: str):
    row = session_for(sid)['relations'].get(rid)
    if row is None or row.get('_contact_map') is None:
        raise HTTPException(404, 'No contact area for this pair.')
    return map_response(row['_contact_map'])


@app.get('/api/sessions/{sid}/import-status')
def import_status(sid: str):
    return session_for(sid).get('import_progress')


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
        tasks = {}
        expected_checks={task['check'] for task in session['tasks'].values()}
        for part in parts:
            checks = [task for task in session['tasks'].values() if task['part_id'] == part['id']]
            if not checks: continue
            merged = dict(next((task for task in checks if task['check']=='INTERSECTIONS'),checks[0]))
            merged.update(done=all(task['done'] for task in checks) and len(checks)==len(expected_checks), stale=any(task['stale'] for task in checks))
            merged['_pending_checks']=sorted(expected_checks-{task['check'] for task in checks})
            if len(checks)>1:
                merged['note'] = '\n'.join(task['check']+': '+task['note'] for task in checks if task['note'])
                for task in checks:
                    if task.get('thickness'): merged['thickness'] = task['thickness']
                    if task.get('thickness_error'): merged['thickness_error'] = True
            tasks[part['id']] = merged
        tolerance = session['fit_tolerance']
    data, filename = checklist_pdf(parts, tasks, request.language, request.utc_offset_minutes, app.version, tolerance)
    return Response(data, media_type='application/pdf', headers={'Content-Disposition': f'attachment; filename="{filename}"', 'Cache-Control': 'no-store'})


register_folders(app, session_for, idle, lock, remove_parts)


# A built frontend is served locally by the same process. Vite proxies /api in development.
dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if dist.exists():
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')

    @app.get('/')
    def index():
        return FileResponse(dist / 'index.html', headers={'Cache-Control': 'no-store'})
