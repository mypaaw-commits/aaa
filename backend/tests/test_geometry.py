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
