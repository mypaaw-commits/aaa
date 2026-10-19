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


@pytest.mark.parametrize('offset,expected_area', [(0, 4), (.5, 3), (1, 2)])
@pytest.mark.parametrize('rotation', [0, .417])
def test_exact_contact_surface_area_and_original_coordinates(offset, expected_area, rotation):
    from backend.geometry import contact_surface
    a, b = box(), box((2, offset, 0))
    transform = trimesh.transformations.rotation_matrix(rotation, [1, 2, 3])
    transform[:3, 3] = [120, -40, 13]
    a.apply_transform(transform); b.apply_transform(transform)
    original_a, original_b = a.vertices.copy(), b.vertices.copy()
    surface = contact_surface(prepare(a), prepare(b.subdivide()))
    assert surface is not None
    assert surface.area == pytest.approx(expected_area)
    # The patch stays on x=1 in the original local coordinate system.
    points = trimesh.transformations.transform_points(surface.vertices, np.linalg.inv(transform))
    assert np.allclose(points[:, 0], 1)
    assert np.all(points[:, 1] >= offset - 1 - 1e-8)
    assert np.all(points[:, 1] <= 1 + 1e-8)
    assert np.array_equal(a.vertices, original_a)
    assert np.array_equal(b.vertices, original_b)


@pytest.mark.parametrize('center', [(2, 2, 0), (2, 2, 2), (2 + 1e-7, 0, 0)])
def test_contact_surface_does_not_invent_area_for_edges_points_or_small_gaps(center):
    from backend.geometry import contact_surface
    assert contact_surface(prepare(box()), prepare(box(center))) is None


def test_contact_surface_preserves_separate_patches():
    from backend.geometry import contact_surface
    islands = trimesh.util.concatenate([box((0, -3, 0)), box((0, 3, 0))])
    surface = contact_surface(prepare(islands), prepare(box((2, 0, 0), size=(2, 10, 2))))
    assert surface.area == pytest.approx(8)
    assert not np.any(np.abs(surface.vertices[:, 1]) < 2 - 1e-8)


@pytest.mark.parametrize('translation', [1000, 1000000])
def test_contact_roundoff_tolerance_does_not_turn_remote_small_gaps_into_area(translation):
    from backend.geometry import contact_surface
    a, touching, separated = box(), box((2, 0, 0)), box((2 + 1e-7, 0, 0))
    for mesh in [a, touching, separated]:
        mesh.apply_translation([translation, 0, 0])
    assert contact_surface(prepare(a), prepare(touching)).area == pytest.approx(4)
    assert contact_surface(prepare(a), prepare(separated)) is None
