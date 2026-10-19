import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { Part, Relation } from './types';

export type ViewerHandle = { fit: (ids?: string[]) => void; view: (axis: 'x' | 'y' | 'z' | 'perspective') => void };
type Props = { session: string; parts: Part[]; relations: Relation[]; selected: string[]; isolated: string[] | null; intersections: boolean; onSelect: (id: string | null, multi: boolean) => void; onError: (message: string) => void; onLoaded: (count: number) => void };
type Engine = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer; meshes: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>; overlays: THREE.Group; grid: THREE.GridHelper; fit: (ids?: string[]) => void; invalidate: () => void };
const loader = new STLLoader();
function dispose(object: THREE.Object3D) {
  object.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material.dispose());
    }
  });
}

export const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef(props); latest.current = props;
  const fitNext = useRef(true);
  useImperativeHandle(ref, () => ({
    fit: ids => engine.current?.fit(ids),
    view: axis => {
      const e = engine.current; if (!e) return;
      const distance = e.camera.position.distanceTo(e.controls.target);
      const dir = axis === 'x' ? new THREE.Vector3(1, 0, 0.001) : axis === 'y' ? new THREE.Vector3(0, -1, .001) : axis === 'z' ? new THREE.Vector3(0, -.001, 1) : new THREE.Vector3(1, -1.5, 1);
      e.camera.position.copy(e.controls.target).addScaledVector(dir.normalize(), distance);
      e.controls.update();
    },
  }), []);

  useEffect(() => {
    const container = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#484848');
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 100000);
    camera.up.set(0, 0, 1); camera.position.set(35, -55, 35);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
    catch { latest.current.onError('Nie można uruchomić WebGL. Włącz akcelerację sprzętową w przeglądarce.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    let dirty = true;
    const invalidate = () => { dirty = true; };
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', invalidate);
    controls.enableDamping = true; controls.dampingFactor = .12;
    controls.mouseButtons.LEFT = null;
    controls.mouseButtons.RIGHT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xddeaff, 0x494139, 2.5));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(20, -30, 60); scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d7ff, 1); fill.position.set(-30, 10, 10); scene.add(fill);
    const grid = new THREE.GridHelper(80, 40, 0x727272, 0x565656);
    grid.rotateX(Math.PI / 2); scene.add(grid);
    const axes = new THREE.AxesHelper(12); scene.add(axes);
    const meshes: Engine['meshes'] = new Map();
    const overlays = new THREE.Group(); scene.add(overlays);
    const fit = (ids?: string[]) => {
      const box = new THREE.Box3();
      meshes.forEach((mesh, id) => { if (ids ? ids.includes(id) : mesh.visible) box.expandByObject(mesh); });
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
      const max = Math.max(size.x, size.y, size.z, .01);
      const distance = max / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov/2))) * 1.5 / Math.min(camera.aspect, 1);
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = Math.max(max / 10000, .00001); camera.far = Math.max(distance * 100, 1000);
      camera.updateProjectionMatrix(); controls.update(); invalidate();
      grid.position.set(center.x, center.y, box.min.z - max * .001);
      grid.scale.setScalar(Math.max(max * 2 / 80, .001));
      axes.position.copy(grid.position); axes.scale.setScalar(max / 60);
    };
    engine.current = { scene, camera, controls, renderer, meshes, overlays, grid, fit, invalidate };
    const resize = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); invalidate();
    }); resize.observe(container);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate); controls.update();
      // Render only on changes; large STL scenes should not keep an idle GPU busy.
      if (dirty) { renderer.render(scene, camera); dirty = false; }
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
      const hits = ray.intersectObjects([...meshes.values()].filter(mesh => mesh.visible));
      latest.current.onSelect(hits[0]?.object.userData.id ?? null, event.shiftKey || event.ctrlKey || event.metaKey);
    };
    const prevent = (event: Event) => event.preventDefault();
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('contextmenu', prevent);
    renderer.domElement.addEventListener('dblclick', () => fit());
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.removeEventListener('change', invalidate); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down, true);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('contextmenu', prevent);
      dispose(scene); renderer.dispose(); container.removeChild(renderer.domElement); engine.current = null;
    };
  }, []);

  useEffect(() => {
    const e = engine.current; if (!e || !props.session) return;
    let cancelled = false;
    const abort = new AbortController();
    const ids = new Set(props.parts.map(part => part.id));
    e.meshes.forEach((mesh, id) => { if (!ids.has(id)) { e.scene.remove(mesh); dispose(mesh); e.meshes.delete(id); } });
    if (!props.parts.length || props.parts.some(part => !e.meshes.has(part.id))) fitNext.current = true;
    e.invalidate();
    const load = async () => {
      for (const part of props.parts) {
        if (e.meshes.has(part.id)) continue;
        try {
          const response = await fetch(`/api/sessions/${props.session}/parts/${part.id}/stl`, { signal: abort.signal });
          if (!response.ok) throw new Error('Nie można pobrać geometrii.');
          const geometry = loader.parse(await response.arrayBuffer());
          if (cancelled) { geometry.dispose(); return; }
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: part.color, roughness: .6, metalness: .1, side: THREE.DoubleSide }));
          mesh.userData.id = part.id; e.meshes.set(part.id, mesh); e.scene.add(mesh);
          applyMaterials();
          latest.current.onLoaded(e.meshes.size);
        } catch (error) { if (!cancelled) latest.current.onError(`Nie udało się wyświetlić ${part.name}: ${String(error)}`); }
      }
      if (!cancelled && fitNext.current && e.meshes.size) { e.fit(); fitNext.current = false; }
    };
    void load();
    return () => { cancelled = true; abort.abort(); };
  }, [props.parts.map(part => part.id).join(','), props.session]);

  function applyMaterials() {
    const e = engine.current; if (!e) return;
    const current = latest.current;
    const ghost = current.intersections;
    for (const part of current.parts) {
      const mesh = e.meshes.get(part.id); if (!mesh) continue;
      mesh.visible = part.visible && (!current.isolated || current.isolated.includes(part.id));
      mesh.material.color.set(part.color);
      mesh.material.emissive.set(current.selected.includes(part.id) ? '#245963' : '#000000');
      mesh.material.emissiveIntensity = .35;
      mesh.material.transparent = ghost; mesh.material.opacity = ghost ? .25 : 1;
      mesh.material.depthWrite = !ghost; mesh.material.wireframe = false;
    }
    e.invalidate();
  }
  useEffect(() => { applyMaterials(); }, [props.parts, props.selected, props.isolated, props.intersections]);

  useEffect(() => {
    const e = engine.current; if (!e) return;
    let cancelled = false; const abort = new AbortController();
    const clear = () => { [...e.overlays.children].forEach(child => { e.overlays.remove(child); dispose(child); }); e.invalidate(); };
    clear();
    const visible = new Set(props.parts.filter(part => part.visible && (!props.isolated || props.isolated.includes(part.id))).map(part => part.id));
    const load = async () => {
      for (const relation of props.relations) {
        if (!relation.part_ids.every(id => visible.has(id))) continue;
        if (relation.kind === 'INTERSECTION' && props.intersections) {
          try {
            const response = await fetch(`/api/sessions/${props.session}/relations/${relation.id}/intersection`, { signal: abort.signal });
            if (!response.ok) throw new Error('Nie można pobrać obszaru przecięcia.');
            const geometry = loader.parse(await response.arrayBuffer());
            if (cancelled) { geometry.dispose(); return; }
            const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#ff4949', emissive: '#b51e27', emissiveIntensity: .6, roughness: .45, side: THREE.DoubleSide }));
            mesh.renderOrder = 5; e.overlays.add(mesh); e.invalidate();
          } catch (error) { if (!cancelled) latest.current.onError(`Nie udało się wyświetlić przecięcia: ${String(error)}`); }
        }
      }
    };
    void load();
    return () => { cancelled = true; abort.abort(); clear(); };
  }, [props.relations, props.parts, props.isolated, props.intersections, props.session]);

  return <div className="canvas-host" ref={host} aria-label="Interaktywny widok modelu 3D" />;
});
