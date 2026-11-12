"""Build the portable ZIP on its target OS; no installation is done at runtime."""
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    if sys.maxsize <= 2**32:
        raise SystemExit('Use a 64-bit Python interpreter to build ModelCheck 3D.')
    if not (ROOT / 'frontend/dist/index.html').is_file():
        raise SystemExit('Build the frontend first: npm run build --prefix frontend')
    system = {'Windows': 'Windows', 'Linux': 'Linux'}.get(platform.system())
    if system is None:
        raise SystemExit('This build supports Windows x64 and Linux x64.')
    if platform.machine().lower() not in ('amd64', 'x86_64'):
        raise SystemExit('Build on an x64 machine.')
    version = json.loads((ROOT / 'frontend/package.json').read_text())['version']
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
                    '--distpath', str(ROOT / 'build/portable-dist'),
                    '--workpath', str(ROOT / 'build/portable-work'),
                    str(ROOT / 'packaging/ModelCheck3D.spec')], cwd=ROOT, check=True)
    name = f'ModelCheck3D-{system}-x64'
    destination = ROOT / 'release' / name
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(ROOT / 'build/portable-dist/ModelCheck3D', destination)
    if system == 'Windows':
        shutil.copyfile(ROOT / 'packaging/START-HERE.txt', destination / 'START-HERE.txt')
    else:
        (destination / 'START-HERE.txt').write_text('Run ./ModelCheck3D. Keep the _internal directory beside it.\n')
    license_paths = [Path(sys.base_prefix) / 'LICENSE.txt',
                     Path(sys.base_prefix) / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'LICENSE.txt']
    python_license = next((path for path in license_paths if path.is_file()), None)
    if python_license is None:
        raise SystemExit('Python LICENSE.txt is required for redistribution.')
    shutil.copyfile(python_license, destination / 'PYTHON-LICENSE.txt')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    (destination / 'BUILD-INFO.json').write_text(json.dumps({
        'version': version, 'platform': f'{system}-x64', 'source_commit': commit,
        'source_dirty': dirty,
    }, indent=2) + '\n')
    archive = Path(shutil.make_archive(str(ROOT / 'release' / name), 'zip',
                                       root_dir=destination.parent, base_dir=name))
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
    print(f'Portable ZIP: {archive}', flush=True)


if __name__ == '__main__':
    main()
