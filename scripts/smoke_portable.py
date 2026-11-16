"""Exercise the actual ZIP away from the checkout, without Python/Node in PATH."""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from urllib.request import Request, urlopen
import zipfile


def box_stl(x):
    vertices = [(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0),
                (0, 0, 2), (2, 0, 2), (2, 2, 2), (0, 2, 2)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
             (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    lines = ['solid box']
    for face in faces:
        lines += ['facet normal 0 0 0', 'outer loop']
        lines += [f'vertex {vertices[i][0] + x} {vertices[i][1]} {vertices[i][2]}' for i in face]
        lines += ['endloop', 'endfacet']
    return ('\n'.join(lines + ['endsolid box']) + '\n').encode()


def api_request(base,path,data=None,content_type='application/json',method=None,headers=None):
    req=Request(base+path,data=data,headers={'Content-Type':content_type,**(headers or {})},method=method)
    with urlopen(req,timeout=180) as response:return response.read()


def wait_job(request,prefix):
    for _ in range(1200):
        result=json.loads(request(prefix+'/analysis'))
        if result['job']['state']!='running':
            assert result['job']['state']=='done',result
            return result
        time.sleep(.1)
    raise AssertionError('Portable analysis did not finish')


def check_map(request,path):
    content=request(path)
    assert content[:4]==b'MCM2','Measurement map missing'
    faces,=struct.unpack('<I',content[4:8])
    assert faces and len(content)==8+48*faces,'Measurement map truncated'
    return content


def check_workflow(base,offset,expected):
    request=lambda path,*args,**kw:api_request(base,path,*args,**kw)
    sid=json.loads(request('/api/sessions',b''))['id'];prefix=f'/api/sessions/{sid}'
    try:
        boundary='modelcheck-portable-boundary';body=b''
        for name,x in [('A.stl',0),('B.stl',offset)]:
            body+=(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="Set/{name}"\r\nContent-Type: model/stl\r\n\r\n').encode()+box_stl(x)+b'\r\n'
        body+=f'--{boundary}--\r\n'.encode()
        imported=json.loads(request(prefix+'/parts',body,f'multipart/form-data; boundary={boundary}'))
        assert not imported['errors'] and len(imported['parts'])==2,imported
        assert all(part['solid'] and part['folder_id'] for part in imported['parts']),imported
        assert [folder['name'] for folder in imported['folders']]==['Set'],imported
        first=imported['parts'][0]['id']
        assert len(request(prefix+f'/parts/{first}/stl'))==684,'Source STL missing'
        request(prefix+'/analysis',b'{"check":"INTERSECTIONS"}')
        result=wait_job(request,prefix);relation,=result['relations']
        assert relation['kind']==expected,result
        assert len(result['tasks'])==2 and all(not task['done'] for task in result['tasks']),result
        check_map(request,prefix+f"/relations/{relation['id']}/"+('contact-map' if expected=='WITHIN_TOLERANCE' else 'fit-map'))
        assert len(request(prefix+f"/relations/{relation['id']}/intersection"))>84
        request(prefix+'/analysis',b'{"check":"THICKNESS"}')
        measured=wait_job(request,prefix)
        assert measured['relations']==result['relations'],'Wall measurement changed pair findings'
        walls=[task for task in measured['tasks'] if task['check']=='THICKNESS']
        assert len(walls)==2 and all(abs(task['thickness']['minimum']-2)<1e-5 for task in walls),measured
        thickness=check_map(request,prefix+f'/parts/{first}/thickness')
        settings=json.loads(request(prefix+'/thickness-settings',b'{"minimum":3}',method='PATCH'))
        assert all(task['thickness']['thin_faces']==12 and task['result']=='INTERSECTION' for task in settings['tasks'] if task['check']=='THICKNESS'),settings
        assert check_map(request,prefix+f'/parts/{first}/thickness')==thickness
        folder=json.loads(request(prefix+'/folders',b'{"name":"Reviewed"}'))
        request(prefix+'/parts-folder',json.dumps({'part_ids':[first],'folder_id':folder['id']}).encode(),method='PATCH')
        for language in ('en','pl'):
            assert request(prefix+'/report',json.dumps({'language':language}).encode()).startswith(b'%PDF-')
        if expected=='WITHIN_TOLERANCE':
            settings=json.loads(request(prefix+'/settings',b'{"fit_tolerance":0}',method='PATCH'))
            assert all(task['stale'] for task in settings['tasks'] if task['check']=='INTERSECTIONS')
            assert all(not task['stale'] for task in settings['tasks'] if task['check']=='THICKNESS')
            request(prefix+'/analysis',b'{"check":"INTERSECTIONS"}')
            strict=wait_job(request,prefix)
            assert strict['relations'][0]['kind']=='INTERSECTION',strict
    finally:request(prefix+'/close',b'')


def check_disk_import(base,root,process_id):
    # Generate through the source harness; the extracted child cannot import
    # source modules or use the harness's installed Python packages.
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from backend.benchmark_import import generate_cube
    fixture=root/'dense fixture.stl';count=generate_cube(fixture,342)
    request=lambda path,*args,**kw:api_request(base,path,*args,**kw)
    sid=json.loads(request('/api/sessions',b''))['id'];prefix=f'/api/sessions/{sid}'
    try:
        boundary='modelcheck-large-spool'
        head=(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="Dense/model.stl"\r\nContent-Type: model/stl\r\n\r\n').encode()
        tail=f'\r\n--{boundary}--\r\n'.encode()
        def chunks():
            yield head
            with fixture.open('rb') as stream:
                while block:=stream.read(1024*1024):yield block
            yield tail
        imported=json.loads(request(prefix+'/parts',chunks(),f'multipart/form-data; boundary={boundary}',headers={'Content-Length':str(len(head)+fixture.stat().st_size+len(tail))}))
        assert not imported['errors'] and imported['parts'][0]['faces']==count and imported['parts'][0]['solid'],imported
        pid=imported['parts'][0]['id']
        preview=request(prefix+f'/parts/{pid}/preview')
        assert (len(preview)-84)//50<=300000,'Viewport received the full dense source'
        request(prefix+'/analysis',b'{"check":"THICKNESS"}')
        measured=wait_job(request,prefix);wall=measured['tasks'][0]['thickness']
        assert abs(wall['minimum']-32)<1e-5 and abs(wall['maximum']-32)<1e-5,wall
        assert len(check_map(request,prefix+f'/parts/{pid}/thickness'))<=8+300002*48
    finally:request(prefix+'/close',b'')
    for _ in range(100):
        if not list(Path(tempfile.gettempdir()).glob(f'ModelCheck mesh {process_id} *')):break
        time.sleep(.1)
    else:raise AssertionError('Disk-backed STL mappings were not cleaned up after session close')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='ModelCheck portable test ') as directory:
        root = Path(directory)
        with zipfile.ZipFile(args.archive) as archive:
            archive.extractall(root)
        executable_name = 'ModelCheck3D.exe' if os.name == 'nt' else 'ModelCheck3D'
        executable, = root.glob(f'*/{executable_name}')
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR)
        info = json.loads((executable.parent / 'BUILD-INFO.json').read_text())
        environment = os.environ.copy()
        for name in ('PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV'):
            environment.pop(name, None)
        environment['PYTHONNOUSERSITE'] = '1'
        environment['PATH'] = str(Path(environment.get('SystemRoot', 'C:/Windows')) / 'System32') if os.name == 'nt' else '/nonexistent'
        # Keep the process in a different working directory from both the source
        # checkout and its own executable: resources must come from the bundle.
        working = root / 'unrelated working directory'
        working.mkdir()
        lines = queue.Queue()
        process = subprocess.Popen([str(executable), '--no-browser', '--port', '0'],
                                   cwd=working, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        def read_output():
            for line in process.stdout:
                lines.put(line)
        threading.Thread(target=read_output, daemon=True).start()
        log = []
        try:
            deadline = time.monotonic() + 120
            base = None
            while time.monotonic() < deadline:
                try:
                    line = lines.get(timeout=.2)
                    log.append(line)
                    found = re.search(r'http://127\.0\.0\.1:\d+', line)
                    if found:
                        base = found.group()
                        break
                except queue.Empty:
                    if process.poll() is not None:
                        break
            assert base, 'Portable process did not start:\n' + ''.join(log)
            for _ in range(100):
                try:
                    with urlopen(base + '/api/health', timeout=2) as response:
                        health = json.load(response)
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError('Portable API did not become ready')
            assert health['version'] == info['version'], (health, info)
            with urlopen(base, timeout=10) as response:
                html = response.read().decode()
            assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html)
            assert assets, 'Compiled frontend missing'
            for asset in assets:
                with urlopen(base + asset, timeout=10) as response:
                    assert response.read(), f'Missing bundled frontend asset: {asset}'
            check_workflow(base, 1.5, 'INTERSECTION')
            check_workflow(base, 1.9995, 'WITHIN_TOLERANCE')
            check_disk_import(base,root,process.pid)
            print(f"PASS: portable {info['platform']} {info['version']}: frontend, STL import, native overlap/fit, contact/depth/thickness maps, independent reviews, folders, 70 MB disk-backed import with bounded preview/map and cleanup, cached thresholds, source STL and EN/PL PDF; no Python/Node in PATH")
        except BaseException:
            while not lines.empty():
                log.append(lines.get_nowait())
            print(''.join(log))
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                details = traceback.format_exc() + '\n' + ''.join(log[-80:])
                escaped = details.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
                print(f'::error title=Portable smoke test failed::{escaped}', flush=True)
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
