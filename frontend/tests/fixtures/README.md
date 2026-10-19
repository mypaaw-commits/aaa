# Fitted socket regression fixture

`key.stl` is a Trimesh icosphere with subdivision level 2, radius 2 mm, translated to (0, 0, 3). `socket.stl` is an icosphere of radius 4 mm at the origin minus that key, using Manifold3D / Mesh64. Both are exported as binary STL.

The fixture represents a curved fitted joint. STL float32 rounding creates small nonzero intersection regions alongside exact opposing contact faces. Tests require informational connections to leave the 3D view unchanged and intersection overlays to appear only when requested. Neither object is reviewed automatically.
