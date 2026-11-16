import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { Part, Relation } from './types';
import { partColors } from './types';
import { useI18n } from './i18n';
import { readSurfaceMap, mapMaterial, mapScale } from './SurfaceMap';
import type { ColourMode } from './SurfaceMap';

export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type ViewerHandle = { focusPoint:(point:number[],radius:number)=>void; fit: (ids?: string[]) => void; view: (view: CameraView) => void; orbit: (horizontal: number, vertical: number) => void; capture: (format: ImageFormat) => Promise<Blob> };
export type Projection = 'perspective' | 'orthographic';
type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type Props = { session: string; parts: Part[]; relations: Relation[]; selected: string[]; transparent: boolean; isolated: string[] | null; intersections: boolean; floor: boolean; projection: Projection; colourMode: ColourMode; fitTolerance: number; minimumThickness: number; thicknessIds: string[]; onViewChange: (view: CameraView | null) => void; onSelect: (id: string | null, multi: boolean) => void; onError: (message: string) => void; onLoaded: (count: number) => void };
type Engine = { scene: THREE.Scene; camera: Camera; controls: OrbitControls; renderer: THREE.WebGLRenderer; meshes: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>; overlays: THREE.Group; grid: THREE.GridHelper; fit: (ids?: string[]) => void; setView: (view: CameraView) => void; orbit: ViewerHandle['orbit']; setProjection: (mode: Projection) => void; invalidate: () => void; draw: () => void };
// Z is up in imported STL coordinates. A small pole offset keeps OrbitControls stable.
const viewDirections: Record<CameraView, [number, number, number]> = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, -.000001, 1], bottom: [0, -.000001, -1], isometric: [1, -1.5, 1],
};
const loader = new STLLoader();
function dispose(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      if (!geometries.has(child.geometry)) { child.geometry.dispose(); geometries.add(child.geometry); }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (!disposedMaterials.has(material)) { material.dispose(); disposedMaterials.add(material); }
      });
    }
  });
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, ref) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef(props); latest.current = props;
  const fitNext = useRef(true);
  const overlayReady = useRef<Promise<boolean>>(Promise.resolve(true));
  const cachedOverlays = useRef(new Map<string, THREE.Group>());
  useImperativeHandle(ref, () => ({
    focusPoint:(point,radius)=>{
      const e=engine.current;if(!e)return;
      const position=new THREE.Vector3().fromArray(point);
      const direction=e.camera.position.clone().sub(e.controls.target).normalize();
      e.controls.target.copy(position);e.camera.position.copy(position).addScaledVector(direction,radius*4);
      e.camera.zoom=1;
      if(e.camera instanceof THREE.OrthographicCamera){const aspect=e.renderer.domElement.clientWidth/Math.max(e.renderer.domElement.clientHeight,1);e.camera.top=radius*1.3;e.camera.bottom=-radius*1.3;e.camera.left=-radius*1.3*aspect;e.camera.right=radius*1.3*aspect;}
      e.camera.near=Math.max(radius/10000,.00001);e.camera.updateProjectionMatrix();e.controls.update();
      const previous=e.scene.getObjectByName('measurement-location');if(previous){e.scene.remove(previous);dispose(previous);}
      const vertices=[];for(let axis=0;axis<3;axis++){const a=position.clone(),b=position.clone();a.setComponent(axis,a.getComponent(axis)-radius*.08);b.setComponent(axis,b.getComponent(axis)+radius*.08);vertices.push(...a.toArray(),...b.toArray());}
      const marker=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)),new THREE.LineBasicMaterial({color:0x161b20,depthTest:false}));marker.name='measurement-location';marker.renderOrder=50;e.scene.add(marker);e.invalidate();
    },
    fit: ids => engine.current?.fit(ids),
    view: view => engine.current?.setView(view),
    orbit: (horizontal, vertical) => engine.current?.orbit(horizontal, vertical),
    capture: async format => {
      // Wait for the current overlay, including a replacement triggered by
      // isolation/visibility changes. Never export an unfinished result image.
      for (;;) {
        const pending = overlayReady.current;
        if (!await pending) throw new Error('Screenshot unavailable: result geometry did not load.');
        if (pending === overlayReady.current) break;
      }
      const e = engine.current;
      if (!e) throw new Error('Screenshot unavailable: 3D view is not ready.');
      e.draw();
      const source = e.renderer.domElement;
      const canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Screenshot unavailable: image encoder is not ready.');
      // Copy immediately after drawing: no permanent preserveDrawingBuffer
      // flag and no additional cost for ordinary viewport rendering.
      context.drawImage(source, 0, 0);
      const mime = `image/${format}`;
      return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
        if (blob?.type === mime) resolve(blob);
        else reject(new Error('Screenshot format is not supported by this browser.'));
      }, mime, .95));
    },
  }), []);

  useEffect(() => {
    const container = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce2e7');
    let camera: Camera = new THREE.PerspectiveCamera(40, 1, .01, 100000);
    let aspect = 1;
    camera.up.set(0, 0, 1); camera.position.set(35, -52.5, 35);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { latest.current.onError('Nie można uruchomić WebGL. Włącz akcelerację sprzętową w przeglądarce.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .9;
    container.appendChild(renderer.domElement);
    let dirty = true;
    const invalidate = () => { dirty = true; };
    const controls = new OrbitControls(camera, renderer.domElement);
    let namedDirection: THREE.Vector3 | null = new THREE.Vector3(...viewDirections.isometric).normalize();
    const changed = () => {
      invalidate();
      if (namedDirection && camera.position.clone().sub(controls.target).normalize().dot(namedDirection) < .999999) {
        namedDirection = null; latest.current.onViewChange(null);
      }
    };
    controls.addEventListener('change', changed);
    controls.enableDamping = true; controls.dampingFactor = .12;
    controls.mouseButtons.LEFT = null;
    controls.mouseButtons.RIGHT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.screenSpacePanning = true;
    // Diffuse lights follow the viewing direction; every side stays readable. No costly shadow passes.
    const lightRig = new THREE.Group(); scene.add(lightRig);
    const ambient = new THREE.AmbientLight(0xffffff, .7); lightRig.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d98a3, 1.3); lightRig.add(hemi);
    const lightPositions = [[-3, 4, 5], [4, 1, 3], [0, -4, 2], [-3, 0, -3]];
    lightPositions.forEach((position, index) => {
      const light = new THREE.DirectionalLight(0xffffff, [1.1, .8, .5, .4][index]);
      light.position.set(position[0], position[1], position[2]);
      lightRig.add(light, light.target);
    });
    const grid = new THREE.GridHelper(80, 24, 0xa8b5bf, 0xb8c4cd);
    grid.material.transparent = true; grid.material.opacity = .4; grid.material.depthWrite = false;
    grid.rotateX(Math.PI / 2); scene.add(grid);
    const meshes: Engine['meshes'] = new Map();
    const overlays = new THREE.Group(); scene.add(overlays);
    const fit = (ids?: string[]) => {
      const box = new THREE.Box3();
      latest.current.parts.forEach(part => { if (ids ? ids.includes(part.id) : part.visible && (!latest.current.isolated || latest.current.isolated.includes(part.id))) box.union(new THREE.Box3(new THREE.Vector3().fromArray(part.bounds[0]), new THREE.Vector3().fromArray(part.bounds[1]))); });
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z, .01);
      const halfVertical = THREE.MathUtils.degToRad(20);
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
      const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, .005);
      const distance = radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.12;
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance);
      camera.zoom = 1;
      if (camera instanceof THREE.OrthographicCamera) {
        const halfHeight = radius * 1.12 / Math.min(1, aspect);
        camera.top = halfHeight; camera.bottom = -halfHeight;
        camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      }
      camera.near = Math.max(max / 10000, .00001); camera.far = Math.max(distance * 100, 1000);
      camera.updateProjectionMatrix(); controls.update(); invalidate();
    };
    const settleControls = () => {
      // Flush pending mouse inertia before assigning an exact view or a keyboard orbit step.
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damping;
    };
    const setView = (view: CameraView) => {
      settleControls();
      const distance = camera.position.distanceTo(controls.target);
      const direction = new THREE.Vector3(...viewDirections[view]).normalize();
      camera.position.copy(controls.target).addScaledVector(direction, distance);
      controls.update(); namedDirection = direction; latest.current.onViewChange(view); invalidate();
    };
    const orbit: ViewerHandle['orbit'] = (horizontal, vertical) => {
      settleControls();
      const toYUp = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target).applyQuaternion(toYUp));
      spherical.theta += THREE.MathUtils.degToRad(horizontal);
      spherical.phi += THREE.MathUtils.degToRad(vertical); spherical.makeSafe();
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical).applyQuaternion(toYUp.invert()));
      controls.update(); invalidate();
    };
    const setProjection = (mode: Projection) => {
      if ((camera instanceof THREE.OrthographicCamera) === (mode === 'orthographic')) return;
      controls.update();
      const previous = camera;
      const distance = previous.position.distanceTo(controls.target);
      const halfHeight = previous instanceof THREE.PerspectiveCamera
        ? distance * Math.tan(THREE.MathUtils.degToRad(previous.fov / 2)) / previous.zoom
        : (previous.top - previous.bottom) / (2 * previous.zoom);
      camera = mode === 'orthographic'
        ? new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, previous.near, previous.far)
        : new THREE.PerspectiveCamera(40, aspect, previous.near, previous.far);
      camera.up.copy(previous.up); camera.quaternion.copy(previous.quaternion); camera.position.copy(previous.position);
      if (camera instanceof THREE.PerspectiveCamera) {
        const direction = previous.position.clone().sub(controls.target).normalize();
        const newDistance = halfHeight / Math.tan(THREE.MathUtils.degToRad(20));
        camera.position.copy(controls.target).addScaledVector(direction, newDistance);
        camera.far = Math.max(camera.far, newDistance * 100);
      }
      camera.updateProjectionMatrix(); controls.object = camera;
      if (engine.current) engine.current.camera = camera;
      controls.update(); invalidate();
    };
    const draw = () => { lightRig.quaternion.copy(camera.quaternion); renderer.render(scene, camera); dirty = false; };
    engine.current = { scene, camera, controls, renderer, meshes, overlays, grid, fit, setView, orbit, setProjection, invalidate, draw };
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height); aspect = Math.max(width, 1) / Math.max(height, 1);
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
      else { camera.right = camera.top * aspect; camera.left = -camera.right; }
      camera.updateProjectionMatrix(); invalidate();
    }); resize.observe(container);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate); controls.update();
      // Render only on changes; large STL scenes should not keep an idle GPU busy.
      if (dirty) draw();
    }; animate();
    let start: [number, number] = [0, 0];
    const down = (event: PointerEvent) => {
      start = [event.clientX, event.clientY];
      // OrbitControls maps Shift + ROTATE to pan automatically.
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
      const current = latest.current;
      const hits = ray.intersectObjects([...meshes.values()].filter(mesh => { const part = current.parts.find(part => part.id === mesh.userData.id); return part?.visible && (!current.isolated || current.isolated.includes(part.id)); }));
      latest.current.onSelect(hits[0]?.object.userData.id ?? null, event.shiftKey || event.ctrlKey || event.metaKey);
    };
    const prevent = (event: Event) => event.preventDefault();
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('contextmenu', prevent);
    renderer.domElement.addEventListener('dblclick', () => fit());
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.removeEventListener('change', changed); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('contextmenu', prevent);
      dispose(scene); cachedOverlays.current.clear(); renderer.dispose(); container.removeChild(renderer.domElement); engine.current = null;
    };
  }, []);

  useEffect(() => { engine.current?.setProjection(props.projection); }, [props.projection]);

  useEffect(() => {
    const e = engine.current; if (!e) return;
    e.grid.visible = props.floor;
    // The floor belongs to the full imported model, never to the camera's current framing.
    const bounds = new THREE.Box3();
    props.parts.forEach(part => bounds.union(new THREE.Box3(
      new THREE.Vector3().fromArray(part.bounds[0]), new THREE.Vector3().fromArray(part.bounds[1]),
    )));
    if (bounds.isEmpty()) { e.grid.position.set(0, 0, 0); e.grid.scale.setScalar(1); }
    else {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z, .01);
      e.grid.position.set(center.x, center.y, bounds.min.z - Math.max(max * .00001, .000001));
      e.grid.scale.setScalar(Math.max(max * 2 / 80, .001));
    }
    e.invalidate();
  }, [props.floor, props.parts]);

  useEffect(() => {
    const e = engine.current; if (!e || !props.session) return;
    let cancelled = false;
    const abort = new AbortController();
    const ids = new Set(props.parts.map(part => part.id));
    e.meshes.forEach((mesh, id) => { if (!ids.has(id)) { e.scene.remove(mesh); dispose(mesh); e.meshes.delete(id); } });
    latest.current.onLoaded(e.meshes.size);
    if (!props.parts.length || props.parts.some(part => !e.meshes.has(part.id))) fitNext.current = true;
    e.invalidate();
    const load = async () => {
      for (const part of props.parts) {
        if (e.meshes.has(part.id)) continue;
        try {
          const response = await fetch(`/api/sessions/${props.session}/parts/${part.id}/preview`, { signal: abort.signal });
          if (!response.ok) throw new Error('Nie można pobrać geometrii.');
          const geometry = loader.parse(await response.arrayBuffer());
          if (cancelled) { geometry.dispose(); return; }
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: partColors.idle, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
          mesh.userData.id = part.id; e.meshes.set(part.id, mesh); e.scene.add(mesh);
          applyMaterials();
          latest.current.onLoaded(e.meshes.size);
        } catch (error) { if (!cancelled) latest.current.onError(`${part.name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!cancelled && fitNext.current && e.meshes.size) { e.fit(); fitNext.current = false; }
    };
    void load();
    return () => { cancelled = true; abort.abort(); };
  }, [props.parts.map(part => part.id).sort().join(','), props.session]);

  function applyMaterials() {
    const e = engine.current; if (!e) return;
    const current = latest.current;
    const ghost = current.transparent;
    for (const part of current.parts) {
      const mesh = e.meshes.get(part.id); if (!mesh) continue;
      mesh.visible = part.visible && (!current.isolated || current.isolated.includes(part.id));
      mesh.material.color.set(current.selected.includes(part.id)?'#a2acb4':partColors.idle);
      mesh.material.emissive.set('#000000');
      mesh.material.emissiveIntensity = 0;
      mesh.material.transparent = ghost; mesh.material.opacity = ghost ? .2 : 1;
      mesh.material.depthWrite = !ghost; mesh.material.wireframe = false;
    }
    updateOverlayVisibility();
    e.invalidate();
  }
  useEffect(() => { applyMaterials(); }, [props.parts, props.selected, props.isolated, props.transparent]);

  function updateOverlayVisibility() {
    const e = engine.current; if (!e) return;
    const current = latest.current;
    const visible = new Set(current.parts.filter(part => part.visible && (!current.isolated || current.isolated.includes(part.id))).map(part => part.id));
    const rowsById=new Map(current.relations.map(row=>[row.id,row]));
    for (const group of cachedOverlays.current.values()) {
      const row = rowsById.get(group.userData.relation);
      const thickness = group.userData.thickness as string | undefined;
      group.visible = thickness
        ? current.colourMode === 'thickness' && current.thicknessIds.includes(thickness) && visible.has(thickness)
        : !!row && current.intersections && current.colourMode !== 'thickness' && row.part_ids.every(id => visible.has(id)) && (group.userData.mode === 'contact' || group.userData.mode === (current.colourMode === 'fit' && row.map_ready ? 'fit' : 'solid'));
      group.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.material instanceof THREE.ShaderMaterial) {
          child.material.uniforms.scale.value = mapScale(thickness ? current.minimumThickness : Math.max(current.fitTolerance,.001,row?.depth_max??0));
          child.material.uniforms.margin.value = thickness ? 0 : current.fitTolerance;
          if(!thickness)child.material.uniforms.alpha.value=group.userData.mode==='contact'?1:.96;
          if (thickness) {
            child.material.uniforms.alpha.value = current.transparent ? .2 : 1;
            child.material.transparent = current.transparent;
            child.material.depthWrite = !current.transparent;
          }
        } else if (child.material instanceof THREE.MeshBasicMaterial && row) {
          child.material.color.set(row.kind === 'WITHIN_TOLERANCE' ? partColors.fit : partColors.intersection);
        }
      });
    }
    // Source geometry remains available for picking and framing. In thickness
    // view its measured surface is drawn by the cached colour-map mesh.
    for (const [id, mesh] of e.meshes) {
      mesh.visible = visible.has(id) && !(current.colourMode === 'thickness' && current.thicknessIds.includes(id) && cachedOverlays.current.has(`${current.session}:thickness:${id}`));
    }
    e.invalidate();
  }

  const overlaySignature = props.relations.map(row => `${row.id}:${row.kind}:${!!row.map_ready}:${!!row.contact_ready}`).sort().join('|');
  useEffect(() => {
    const e = engine.current; if (!e) return;
    let cancelled = false;
    const abort = new AbortController();
    const load = async () => {
      let success = true;
      const current = latest.current;
      const desired: {key:string;url:string;thickness:string|undefined;mode:string;relation:string|undefined;row:Relation|undefined}[] = current.colourMode === 'thickness'
        ? current.thicknessIds.map(id => ({ key: `${current.session}:thickness:${id}`, url: `/api/sessions/${current.session}/parts/${id}/thickness`, thickness: id, mode: 'thickness', relation: undefined as string | undefined, row: undefined as Relation | undefined }))
        : current.relations.filter(row => ['INTERSECTION', 'WITHIN_TOLERANCE'].includes(row.kind)).map(row => {
          const mode = current.colourMode === 'fit' && row.map_ready ? 'fit' : 'solid';
          return { key: `${current.session}:${row.id}:${mode}`, url: `/api/sessions/${current.session}/relations/${row.id}/${mode === 'fit' ? 'fit-map' : 'intersection'}`, thickness: undefined as string | undefined, mode, relation: row.id, row };
        });
      if(current.colourMode!=='thickness')desired.push(...current.relations.filter(row=>row.contact_ready).map(row=>({key:`${current.session}:${row.id}:contact:${current.fitTolerance}`,url:`/api/sessions/${current.session}/relations/${row.id}/contact-map`,thickness:undefined,mode:'contact',relation:row.id,row})));
      const ids = new Set(current.parts.map(part => part.id));
      for (const [key, group] of cachedOverlays.current) {
        if ((group.userData.ids as string[]).some(id => !ids.has(id)) || group.userData.mode==='contact'&&group.userData.tolerance!==current.fitTolerance) {
          e.overlays.remove(group); dispose(group); cachedOverlays.current.delete(key);
        }
      }
      for (const item of desired) {
        if (cachedOverlays.current.has(item.key)) continue;
        // Solid overlays stay lazy until requested. Visibility and camera moves
        // never enter this effect or refetch/rebuild any cached geometry.
        if (item.mode !== 'thickness' && !current.intersections) continue;
        try {
          const response = await fetch(item.url, { signal: abort.signal });
          if (!response.ok) throw new Error('Nie można pobrać obszaru przecięcia.');
          const buffer = await response.arrayBuffer();
          if (cancelled) return true;
          const geometry = item.mode === 'solid' ? loader.parse(buffer) : readSurfaceMap(buffer);
          const colour = item.row?.kind === 'WITHIN_TOLERANCE' ? partColors.fit : partColors.intersection;
          const material = item.mode === 'solid'
            ? new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: .94, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false, forceSinglePass: true })
            : mapMaterial(item.thickness ? current.minimumThickness : Math.max(current.fitTolerance,.001,item.row?.depth_max??0), !!item.thickness);
          const group = new THREE.Group();
          group.userData = { relation: item.relation, thickness: item.thickness, mode: item.mode, tolerance:current.fitTolerance, ids: item.row?.part_ids ?? [item.thickness!] };
          const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = 10; group.add(mesh);
          cachedOverlays.current.set(item.key, group); e.overlays.add(group);
          updateOverlayVisibility();
        } catch (error) {
          if (!cancelled) { success = false; latest.current.onError(error instanceof Error ? error.message : String(error)); }
        }
      }
      updateOverlayVisibility();
      return success;
    };
    overlayReady.current = load();
    return () => { cancelled = true; abort.abort(); };
  }, [overlaySignature, props.session, props.colourMode, props.thicknessIds.join('|'), props.intersections]);

  useEffect(() => { updateOverlayVisibility(); }, [props.parts, props.isolated, props.transparent, props.selected, props.colourMode, props.minimumThickness, props.fitTolerance, props.thicknessIds.join('|')]);

  return <div className="canvas-host" ref={host} aria-label={t('view3d')} />;
});
