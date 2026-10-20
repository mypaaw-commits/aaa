import numpy as np
import pytest
import trimesh
from backend.geometry import prepare, analyze_pair


def box(center=(0, 0, 0), size=(2, 2, 2)):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(center)
    return mesh


@pytest.mark.parametrize('x,expected', [(2, 'CONNECTED'), (2.05, 'DISCONNECTED'), (2.2, 'DISCONNECTED'), (1.5, 'INTERSECTION')])
def test_relations(x, expected):
    result, region = analyze_pair(prepare(box()), prepare(box((x, 0, 0))))
    assert result['kind'] == expected, result
    if expected == 'INTERSECTION':
        assert region.volume == pytest.approx(2)
        assert result['volume'] == pytest.approx(2)
    else:
        assert region is None


def test_containment():
    result, region = analyze_pair(prepare(box(size=(8, 8, 8))), prepare(box()))
    assert result['kind'] == 'INTERSECTION'
    assert region.volume == pytest.approx(8)
    assert result['coincident'] is False


@pytest.mark.parametrize('subdivide', [False, True])
def test_coincident_solids_independent_of_triangulation(subdivide):
    original = box((150, -30, 12))
    other = original.subdivide() if subdivide else original.copy()
    result, region = analyze_pair(prepare(original), prepare(other))
    assert result['kind'] == 'INTERSECTION'
    assert result['coincident'] is True
    assert region.volume == pytest.approx(8)


@pytest.mark.parametrize('offset', [1e-7, 1e-5, .1])
def test_near_copies_are_not_coincident(offset):
    result, _ = analyze_pair(prepare(box()), prepare(box((offset, 0, 0))))
    assert result['kind'] == 'INTERSECTION'
    assert result['coincident'] is False


def test_same_bounds_with_different_volume_is_not_coincident():
    solid = box()
    hollow = (prepare(solid).manifold - prepare(box(size=(1, 1, 1))).manifold).to_mesh64()
    other = trimesh.Trimesh(vertices=hollow.vert_properties[:, :3], faces=hollow.tri_verts, process=False)
    assert np.array_equal(solid.bounds, other.bounds)
    result, _ = analyze_pair(prepare(solid), prepare(other))
    assert result['kind'] == 'INTERSECTION'
    assert result['coincident'] is False


def test_multiple_regions():
    pair = trimesh.util.concatenate([box((-3, 0, 0)), box((3, 0, 0))])
    bar = box(size=(10, 1, 1))
    result, common = analyze_pair(prepare(pair), prepare(bar))
    assert result['kind'] == 'INTERSECTION'
    assert common.volume == pytest.approx(4)
    assert len(common.split()) == 2


def test_bad_mesh_uncertain():
    broken = box(); broken.update_faces(np.arange(11))
    result, _ = analyze_pair(prepare(broken), prepare(box()))
    assert result['kind'] == 'UNCERTAIN'


@pytest.mark.parametrize('center', [(2, 2, 0), (2, 2, 2)])
def test_edge_and_point_contact(center):
    result, _ = analyze_pair(prepare(box()), prepare(box(center)))
    assert result['kind'] == 'CONNECTED', result


def test_aabb_overlap_does_not_mean_contact():
    a = box(size=(10, .5, .5)); a.apply_transform(trimesh.transformations.rotation_matrix(np.pi/4, [0, 0, 1]))
    b = a.copy(); b.apply_translation([0, 3, 0])
    result, common = analyze_pair(prepare(a), prepare(b))
    assert result['kind'] == 'DISCONNECTED'
    assert common is None


def test_separated_parts_are_not_related_and_coordinates_preserved():
    a = box((1000, 3000, -50)); original = a.vertices.copy()
    prepared = prepare(a)
    assert np.array_equal(a.vertices, original)
    assert np.allclose(prepared.mesh.bounds, a.bounds)
    result, _ = analyze_pair(prepared, prepare(box((1002.2, 3000, -50))))
    assert result['kind'] == 'DISCONNECTED'


@pytest.mark.parametrize('depth,expected', [(.0001, 'WITHIN_TOLERANCE'), (.0009, 'WITHIN_TOLERANCE'), (.0011, 'INTERSECTION'), (.02, 'INTERSECTION')])
@pytest.mark.parametrize('rotation', [0, .417])
def test_fit_margin_uses_depth_and_is_symmetric(depth, expected, rotation):
    a, b = box(), box((2 - depth, 0, 0))
    transform = trimesh.transformations.rotation_matrix(rotation, [1, 2, 3])
    transform[:3, 3] = [120, -40, 13]
    a.apply_transform(transform); b.apply_transform(transform)
    original_a, original_b = a.vertices.copy(), b.vertices.copy()
    first, second = prepare(a), prepare(b)
    for x, y in [(first, second), (second, first)]:
        result, region = analyze_pair(x, y)
        assert result['kind'] == expected, result
        assert result['fit_tolerance'] == .001
        assert region.volume == pytest.approx(4 * depth)
    assert np.array_equal(a.vertices, original_a)
    assert np.array_equal(b.vertices, original_b)


def test_large_shallow_overlap_is_fit_even_with_large_volume():
    a = prepare(box(size=(100, 100, 2)))
    b = prepare(box((0, 0, 1.9995), size=(100, 100, 2)))
    result, region = analyze_pair(a, b)
    assert result['kind'] == 'WITHIN_TOLERANCE'
    assert region.volume == pytest.approx(5)


def test_small_volume_deep_needle_is_still_intersection():
    needle = prepare(box((0, 0, 1.5), size=(.0002, .0002, 4)))
    solid = prepare(box())
    result, _ = analyze_pair(needle, solid)
    assert result['kind'] == 'INTERSECTION'
    assert result['volume'] < 1e-6


def test_tiny_contained_object_is_not_a_fit():
    result, _ = analyze_pair(prepare(box()), prepare(box(size=(.0002,) * 3)))
    assert result['kind'] == 'INTERSECTION'


def test_large_fitted_region_cannot_hide_deep_small_region():
    a = trimesh.util.concatenate([box(size=(10, 10, 2)), box((20, 0, 1.5), size=(.0002, .0002, 4))])
    b = trimesh.util.concatenate([box((0, 0, 1.9995), size=(10, 10, 2)), box((20, 0, 0))])
    result, _ = analyze_pair(prepare(a), prepare(b))
    assert result['kind'] == 'INTERSECTION'


@pytest.mark.parametrize('export_stl', [False, True])
def test_boolean_sphere_socket_roundoff_is_within_tolerance(export_stl):
    import io
    outer = prepare(trimesh.creation.icosphere(subdivisions=2, radius=4))
    key = trimesh.creation.icosphere(subdivisions=2, radius=2)
    key.apply_translation([0, 0, 3]); key_shape = prepare(key)
    output = (outer.manifold - key_shape.manifold).to_mesh64()
    socket = trimesh.Trimesh(vertices=output.vert_properties[:, :3], faces=output.tri_verts)
    if export_stl:
        socket, key = [trimesh.load(io.BytesIO(mesh.export(file_type='stl')), file_type='stl') for mesh in [socket, key]]
    result, region = analyze_pair(prepare(socket), prepare(key))
    assert result['kind'] == 'WITHIN_TOLERANCE'
    assert result['coincident'] is False
    assert region is not None
    assert 0 < result['volume'] < 1e-6


def test_fit_analysis_failure_remains_uncertain(monkeypatch):
    def fail(*args):
        raise ValueError('Cannot certify tolerance')
    monkeypatch.setattr('backend.geometry.within_tolerance', fail)
    result, _ = analyze_pair(prepare(box()), prepare(box((1.9995, 0, 0))))
    assert result['kind'] == 'UNCERTAIN'
