"""Session-local assembly folders. No filesystem paths are created from names."""
from uuid import uuid4
from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict

class FolderEdit(BaseModel):
    name: str = Field(min_length=1,max_length=120)
    parent_id: str | None = None
    model_config=ConfigDict(extra='forbid')
class MoveParts(BaseModel):
    part_ids: list[str] = Field(min_length=1,max_length=100)
    folder_id: str | None = None
    model_config=ConfigDict(extra='forbid')

def validate_name(name):
    name=name.strip()
    if not name or name in ('.','..') or '/' in name or '\\' in name or any(ord(c)<32 for c in name):
        raise HTTPException(400,'Invalid folder name.')
    return name

def descendants(session,fid):
    result={fid}
    while True:
        children={row['id'] for row in session['folders'].values() if row['parent_id'] in result}
        if children.issubset(result):return result
        result.update(children)

def import_folders(session,path,base=None):
    segments=path.split('/')[:-1]
    parent=base
    for segment in segments:
        name=validate_name(segment)
        existing=next((f for f in session['folders'].values() if f['parent_id']==parent and f['name'].casefold()==name.casefold()),None)
        if existing:parent=existing['id'];continue
        if len(session['folders'])>=1000:raise HTTPException(400,'Maximum 1000 folders per session.')
        parent_id=parent;parent=uuid4().hex
        session['folders'][parent]={'id':parent,'name':name,'parent_id':parent_id}
    return parent

def register(app,session_for,idle,lock,remove_parts):
    @app.get('/api/sessions/{sid}/folders')
    def folders(sid:str):return list(session_for(sid)['folders'].values())

    def edit(session,fid,body):
        name=validate_name(body.name)
        if body.parent_id is not None and body.parent_id not in session['folders']:raise HTTPException(404,'Folder not found.')
        if fid and body.parent_id in descendants(session,fid):raise HTTPException(409,'A folder cannot contain itself.')
        if any(f['id']!=fid and f['parent_id']==body.parent_id and f['name'].casefold()==name.casefold() for f in session['folders'].values()):
            raise HTTPException(409,'A folder with this name already exists here.')
        key=fid or uuid4().hex
        session['folders'][key]={'id':key,'name':name,'parent_id':body.parent_id}
        return session['folders'][key]

    @app.post('/api/sessions/{sid}/folders')
    def create(sid:str,body:FolderEdit):
        with lock:
            session=session_for(sid);idle(session)
            if len(session['folders'])>=1000:raise HTTPException(400,'Maximum 1000 folders per session.')
            return edit(session,None,body)

    @app.patch('/api/sessions/{sid}/folders/{fid}')
    def update(sid:str,fid:str,body:FolderEdit):
        with lock:
            session=session_for(sid);idle(session)
            if fid not in session['folders']:raise HTTPException(404,'Folder not found.')
            return edit(session,fid,body)

    @app.patch('/api/sessions/{sid}/parts-folder')
    def move(sid:str,body:MoveParts):
        with lock:
            session=session_for(sid);idle(session)
            if body.folder_id is not None and body.folder_id not in session['folders']:raise HTTPException(404,'Folder not found.')
            if not set(body.part_ids).issubset(session['parts']):raise HTTPException(404,'Part not found.')
            for pid in body.part_ids:session['parts'][pid]['meta']['folder_id']=body.folder_id
            return {'ok':True}

    @app.delete('/api/sessions/{sid}/folders/{fid}')
    def delete(sid:str,fid:str):
        with lock:
            session=session_for(sid);idle(session)
            if fid not in session['folders']:raise HTTPException(404,'Folder not found.')
            ids=descendants(session,fid)
            parts={pid for pid,part in session['parts'].items() if part['meta'].get('folder_id') in ids}
            if parts:remove_parts(session,parts)
            session['folders']={key:value for key,value in session['folders'].items() if key not in ids}
            return {'folders':list(session['folders'].values()),'removed_parts':list(parts)}
