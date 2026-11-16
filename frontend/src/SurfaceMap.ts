import * as THREE from 'three';

export type ColourMode = 'solid' | 'fit' | 'thickness';
export const mapScale = (threshold: number) => threshold > 0 ? Math.max(threshold * 2, 1e-9) : .001;

export function readSurfaceMap(buffer: ArrayBuffer) {
  const header = new DataView(buffer);
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, 4)) !== 'MCM2' || buffer.byteLength !== 8 + header.getUint32(4, true) * 48) throw new Error('Invalid surface map');
  const geometry = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Float32Array(buffer, 8), 4);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
  geometry.setAttribute('measurement', new THREE.InterleavedBufferAttribute(data, 1, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function mapMaterial(threshold: number, thickness: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { scale: { value: mapScale(threshold) }, reverse: { value: thickness ? 1 : 0 }, alpha: { value: thickness ? 1 : .96 } },
    vertexShader: `attribute float measurement; varying float value; varying vec3 n;
      void main(){ value=measurement; n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float scale; uniform float reverse; uniform float alpha; varying float value; varying vec3 n;
      vec3 rainbow(float t){
        if(t<.25)return mix(vec3(0.,.2,1.),vec3(0.,1.,1.),t*4.);
        if(t<.5)return mix(vec3(0.,1.,1.),vec3(.1,.85,.1),(t-.25)*4.);
        if(t<.75)return mix(vec3(.1,.85,.1),vec3(1.,.9,0.),(t-.5)*4.);
        return mix(vec3(1.,.9,0.),vec3(1.,.08,.02),(t-.75)*4.);
      }
      void main(){ float t=clamp(value/scale,0.,1.); if(reverse>.5)t=1.-t;
        vec3 c=value<0.?vec3(.45):rainbow(t);
        gl_FragColor=vec4(c*(.82+.18*abs(normalize(n).z)),alpha); }`,
    transparent: !thickness, depthTest: thickness, depthWrite: thickness, side: THREE.DoubleSide,
    toneMapped: false, forceSinglePass: true,
  });
}
