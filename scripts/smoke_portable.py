"""Exercise the actual ZIP away from the checkout, without Python/Node in PATH."""
import argparse
import json
import os
from pathlib import Path
import queue
import re
import stat
import subprocess
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


def check_workflow(base, offset, expected):
    def request(path, data=None, content_type='application/json', method=None):
        req = Request(base + path, data=data, headers={'Content-Type': content_type}, method=method)
        with urlopen(req, timeout=30) as response:
            return response.read()

    sid = json.loads(request('/api/sessions', b''))['id']
    prefix = f'/api/sessions/{sid}'
    try:
        boundary = 'modelcheck-portable-smoke-boundary'
        body = b''
        for name, x in [('A.stl', 0), ('B.stl', offset)]:
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n'
                     'Content-Type: model/stl\r\n\r\n').encode() + box_stl(x) + b'\r\n'
        body += f'--{boundary}--\r\n'.encode()
        imported = json.loads(request(prefix + '/parts', body, f'multipart/form-data; boundary={boundary}'))
        assert not imported['errors'] and len(imported['parts']) == 2, imported
        assert all(part['solid'] for part in imported['parts']), imported
        source = request(prefix + f"/parts/{imported['parts'][0]['id']}/stl")
        assert len(source) == 684, 'Source STL export is missing or invalid'
        json.loads(request(prefix + '/analysis', b'{}'))
        for _ in range(300):
            result = json.loads(request(prefix + '/analysis'))
            if result['job']['state'] != 'running':
                break
            time.sleep(.1)
        assert result['job']['state'] == 'done', result
        relation, = result['relations']
        assert relation['kind'] == expected, result
        assert len(result['tasks']) == 2 and all(not row['done'] for row in result['tasks']), result
        overlay = request(prefix + f"/relations/{relation['id']}/intersection")
        assert len(overlay) > 84, 'Native intersection geometry is missing'
        for language in ('en', 'pl'):
            report = request(prefix + '/report', json.dumps({'language': language}).encode())
            assert report.startswith(b'%PDF-'), 'PDF generation or embedded fonts failed'
        if expected == 'WITHIN_TOLERANCE':
            settings = json.loads(request(prefix + '/settings', b'{"fit_tolerance":0}', method='PATCH'))
            assert settings['fit_tolerance'] == 0 and all(task['stale'] for task in settings['tasks'])
            request(prefix + '/analysis', b'{}')
            for _ in range(300):
                strict_result = json.loads(request(prefix + '/analysis'))
                if strict_result['job']['state'] != 'running':
                    break
                time.sleep(.1)
            assert strict_result['job']['state'] == 'done' and strict_result['relations'][0]['kind'] == 'INTERSECTION', strict_result
    finally:
        request(prefix + '/close', b'')


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
            print(f"PASS: portable {info['platform']} {info['version']}: frontend, STL import, native overlap/fit, source/overlay STL and EN/PL PDF; no Python/Node in PATH")
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
