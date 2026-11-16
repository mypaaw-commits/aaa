import io
from io import BytesIO
import numpy as np
import trimesh
from pypdf import PdfReader

import backend.main as main
import backend.large_stl as large
from backend.tests.test_api import client,session,analyze
from backend.tests.test_geometry import box
from backend.geometry import prepare
from backend.surface_maps import contact_map,nearest_surface,thickness_map,preview_mesh,thickness_display,thickness_summary


def test_thickness_is_independent_preserves_intersection_reviews_and_uses_mm(monkeypatch):
    sid=session()
    client.post(f'/api/sessions/{sid}/demo')
    first=analyze(sid,{'check':'INTERSECTIONS'})
    task=first['tasks'][0]
    client.patch(f"/api/sessions/{sid}/tasks/{task['id']}",json={'done':True,'note':'Keep pair review'})
    def forbidden(*a,**kw):raise AssertionError('Thickness must not analyze pairs')
    monkeypatch.setattr(main,'analyze_pair',forbidden)
    measured=analyze(sid,{'check':'THICKNESS','part_ids':[task['part_id']]})
    assert measured['relations']==first['relations']
    assert next(t for t in measured['tasks'] if t['id']==task['id'])['done']
    wall=next(t for t in measured['tasks'] if t['check']=='THICKNESS')
    assert wall['thickness']['minimum']==wall['thickness']['maximum']==8
    assert wall['thickness']['deficit']==0
    assert len(wall['thickness']['minimum_location'])==3
    changed=client.patch(f'/api/sessions/{sid}/thickness-settings',json={'minimum':9}).json()
    assert next(t for t in changed['tasks'] if t['check']=='THICKNESS')['thickness']['deficit']==1
    assert next(t for t in changed['tasks'] if t['check']=='THICKNESS')['result']=='INTERSECTION'
    safe=client.patch(f'/api/sessions/{sid}/thickness-settings',json={'minimum':.2}).json()
    assert next(t for t in safe['tasks'] if t['check']=='THICKNESS')['result']=='CLEAR'
    assert next(t for t in changed['tasks'] if t['id']==task['id'])['done']
    client.patch(f'/api/sessions/{sid}/thickness-settings',json={'minimum':9})
    pdf=client.post(f'/api/sessions/{sid}/report',json={}).content
    text='\n'.join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    assert 'Maximum thickness: 8 mm' in text and 'Maximum shortfall: 1 mm' in text


def test_thickness_only_creates_no_pair_results_and_reports_extrema_locations():
    sid=session()
    data=box(size=(2,2,.4)).export(file_type='stl')
    part=client.post(f'/api/sessions/{sid}/parts',files=[('files',('thin.stl',data))]).json()['parts'][0]
    result=analyze(sid,{'check':'THICKNESS'})
    assert result['relations']==[] and result['job']['total']==1
    wall=result['tasks'][0]['thickness']
    assert np.isclose(wall['minimum'],.4) and np.isclose(wall['maximum'],2)
    assert np.isclose(wall['deficit'],.1)
    for field in ('minimum_location','maximum_location'):
        point=np.asarray(wall[field]); assert np.all(point>=np.asarray(part['bounds'][0])-1e-6) and np.all(point<=np.asarray(part['bounds'][1])+1e-6)


def test_boolean_socket_has_continuous_contact_patches_on_the_original_surfaces():
    sphere=prepare(trimesh.creation.icosphere(subdivisions=2,radius=4))
    raw=trimesh.creation.icosphere(subdivisions=2,radius=2);raw.apply_translation([3,0,0]);key=prepare(raw)
    result=(sphere.manifold-key.manifold).to_mesh64()
    cut=trimesh.Trimesh(vertices=result.vert_properties[:,:3],faces=result.tri_verts,process=False)
    # Exercise the float32 STL round trip used by Blender files.
    cut=prepare(trimesh.load(io.BytesIO(cut.export(file_type='stl')),file_type='stl'))
    data=contact_map(cut,key,.001)
    assert data is not None and len(data['mesh'].faces)>100
    points=data['mesh'].triangles_center
    assert nearest_surface(cut.mesh,points).max()<.001
    assert nearest_surface(key.mesh,points).max()<.001
    assert np.all(data['values']==0)
    sid=session()
    client.post(f'/api/sessions/{sid}/parts',files=[('files',('socket.stl',cut.mesh.export(file_type='stl'))),('files',('key.stl',key.mesh.export(file_type='stl')))])
    analysis=analyze(sid,{'check':'INTERSECTIONS'})
    relation=analysis['relations'][0]
    assert relation['contact_ready']
    assert client.get(f"/api/sessions/{sid}/relations/{relation['id']}/contact-map").content[:4]==b'MCM2'


def test_folder_tree_import_move_cycle_validation_and_recursive_delete_preserve_geometry_reviews():
    sid=session();prefix=f'/api/sessions/{sid}'
    imported=client.post(prefix+'/parts',files=[('files',('Set/Head/top.stl',box().export(file_type='stl'))),('files',('Set/body.stl',box((1,0,0)).export(file_type='stl')))]).json()
    assert {f['name'] for f in imported['folders']}=={'Set','Head'}
    root=next(f for f in imported['folders'] if f['name']=='Set');child=next(f for f in imported['folders'] if f['name']=='Head')
    assert child['parent_id']==root['id']
    result=analyze(sid)
    task=result['tasks'][0]
    client.patch(prefix+f"/tasks/{task['id']}",json={'done':True,'note':'Retain'})
    assert client.patch(prefix+f"/folders/{root['id']}",json={'name':'Set','parent_id':child['id']}).status_code==409
    folder=client.post(prefix+'/folders',json={'name':'Other'}).json()
    assert client.patch(prefix+'/parts-folder',json={'part_ids':[imported['parts'][0]['id']],'folder_id':folder['id']}).status_code==200
    assert client.get(prefix+'/analysis').json()['tasks'][0]['done']
    assert client.post(prefix+'/folders',json={'name':'other'}).status_code==409
    assert client.patch(prefix+f"/folders/{child['id']}",json={'name':'Face','parent_id':folder['id']}).status_code==200
    deleted=client.delete(prefix+f"/folders/{folder['id']}").json()
    assert imported['parts'][0]['id'] in deleted['removed_parts']
    assert len(main.sessions[sid]['parts'])==1
    assert client.post(prefix+'/folders',json={'name':'../invalid'}).status_code==400


def test_disk_indexer_reads_bounded_chunks_and_preserves_original_coordinates(monkeypatch):
    monkeypatch.setattr(large,'CHUNK',2)
    mesh=box((1.2,-3.5,8));raw=mesh.export(file_type='stl')
    class Bounded(io.BytesIO):
        def read(self,size=-1):
            assert size>=0,'Whole-file reads are forbidden'
            return super().read(size)
    indexed=large.load_indexed_binary(Bounded(raw))
    assert len(indexed.vertices)==8 and len(indexed.faces)==12
    assert np.array_equal(indexed.triangles,mesh.triangles.astype(np.float32))
    assert prepare(indexed,indexed=True).solid
    ascii_mesh=large.load_indexed_ascii(io.BytesIO(mesh.export(file_type='stl_ascii').encode()))
    assert np.array_equal(ascii_mesh.triangles,mesh.triangles)
    assert main.LIMIT==1024**3 and client.get('/api/health').json()['max_file_bytes']==1024**3


def test_large_thickness_display_keeps_source_extrema_and_bounds_geometry_size():
    shape=prepare(trimesh.creation.icosphere(subdivisions=7,radius=4))
    data=thickness_map(shape,shape.mesh,0)
    original=data['values'].copy();preview,error=preview_mesh(shape)
    shown=thickness_display(data,preview,error)
    assert len(shown['mesh'].faces)<=len(preview.faces)+2
    assert len(shown['mesh'].faces)<len(shape.mesh.faces)
    assert np.array_equal(data['values'],original)
    assert shown['values'].max()==original.max()
    assert shown['values'][shown['values']>=0].min()==original.min()


def test_import_into_an_existing_folder_preserves_the_directory_root():
    sid=session();prefix=f'/api/sessions/{sid}'
    parent=client.post(prefix+'/folders',json={'name':'Project'}).json()
    imported=client.post(prefix+'/parts',data={'parent_folder_id':parent['id']},files=[('files',('Set/Key/key.stl',box().export(file_type='stl')))]).json()
    folders={folder['name']:folder for folder in imported['folders']}
    assert folders['Set']['parent_id']==parent['id']
    assert folders['Key']['parent_id']==folders['Set']['id']
    assert imported['parts'][0]['folder_id']==folders['Key']['id']
    inventory=client.get(prefix+'/parts').json()
    assert inventory[0]['folder_id']==folders['Key']['id']


def test_pdf_remains_pending_when_a_started_check_does_not_cover_every_part():
    sid=session();prefix=f'/api/sessions/{sid}'
    client.post(prefix+'/demo')
    initial=analyze(sid,{'check':'INTERSECTIONS'})
    for task in initial['tasks']:client.patch(prefix+f"/tasks/{task['id']}",json={'done':True,'note':''})
    measured=analyze(sid,{'check':'THICKNESS','part_ids':[initial['tasks'][0]['part_id']]})
    wall=next(task for task in measured['tasks'] if task['check']=='THICKNESS')
    client.patch(prefix+f"/tasks/{wall['id']}",json={'done':True,'note':'Wall only on first part'})
    text='\n'.join(page.extract_text() for page in PdfReader(BytesIO(client.post(prefix+'/report',json={}).content)).pages)
    assert 'MANUAL REVIEW INCOMPLETE' in text and 'Wall thickness: Not checked' in text
    assert 'Wall only on first part' in text


def test_known_contact_can_be_shown_without_claiming_an_uncertain_pair_is_clear(monkeypatch):
    sid=session();prefix=f'/api/sessions/{sid}'
    client.post(prefix+'/parts',files=[('files',('a.stl',box().export(file_type='stl'))),('files',('b.stl',box((2,0,0)).export(file_type='stl')))])
    def unresolved(a,b,tolerance):
        return {'kind':'UNCERTAIN','volume':None,'message':'Unresolved','coincident':False,'fit_tolerance':tolerance,'reason':'COMPUTATION_LIMIT'},None
    monkeypatch.setattr(main,'analyze_pair',unresolved)
    result=analyze(sid,{'check':'INTERSECTIONS'})
    assert result['relations'][0]['contact_ready']
    assert result['relations'][0]['kind']=='UNCERTAIN'
    assert all(task['result']=='UNCERTAIN' and not task['done'] for task in result['tasks'])
