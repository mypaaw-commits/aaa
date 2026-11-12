# Build on the target platform. Windows executables are built on Windows x64.
from pathlib import Path
from importlib.metadata import distribution
from PyInstaller.utils.hooks import collect_all, copy_metadata

root = Path(SPECPATH).parent
datas = [(str(root / 'frontend' / 'dist'), 'frontend/dist'),
         (str(root / 'backend' / 'assets'), 'backend/assets')]
binaries = []
hiddenimports = ['uvicorn.loops.asyncio', 'uvicorn.protocols.http.h11_impl',
                 'uvicorn.lifespan.on']
for package in ('manifold3d', 'trimesh'):
    package_data, package_binaries, package_imports = collect_all(package)
    datas += package_data
    binaries += package_binaries
    hiddenimports += package_imports
# manifold3d is a standalone extension, not a Python package. The delvewheel
# package-directory helper fails on Windows for that layout. Its wheel puts
# the renamed MSVC DLL beside the .pyd; collect those DLLs from the wheel record.
manifold_distribution = distribution('manifold3d')
for entry in manifold_distribution.files or ():
    if str(entry).lower().endswith('.dll'):
        binaries.append((str(manifold_distribution.locate_file(entry)), '.'))

# Keep metadata and bundled license notices, including for packages imported
# dynamically by the geometry/PDF engines.
for package in ('fastapi', 'uvicorn', 'trimesh', 'manifold3d', 'reportlab', 'numpy', 'pillow'):
    datas += copy_metadata(package, recursive=True)

a = Analysis([str(root / 'run.py')], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=hiddenimports,
             excludes=['pytest', 'Cython', 'fcl', 'tkinter', 'IPython', 'matplotlib'],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ModelCheck3D',
          debug=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='ModelCheck3D')
