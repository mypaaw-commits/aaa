import * as THREE from 'three';

export type ColourMode = 'solid' | 'fit' | 'thickness';
export const mapScale = (threshold: number) => threshold > 0 ? Math.max(threshold, 1e-9) : .001;

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
    uniforms: { scale: { value: mapScale(threshold) }, reverse: { value: thickness ? 1 : 0 }, alpha: { value: thickness ? 1 : .96 }, margin: { value: 0 } },
    vertexShader: `attribute float measurement; varying float value; varying vec3 n;
      void main(){ value=measurement; n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float scale; uniform float reverse; uniform float alpha; uniform float margin; varying float value; varying vec3 n;
      void main(){
        float t=clamp(value/max(scale,.0000001),0.,1.);
        vec3 c;
        if(value<0.)c=vec3(.45);
        else if(reverse>.5)c=mix(vec3(.94,.12,.10),vec3(1.),t);
        else {t=clamp((value-margin)/max(scale-margin,.0000001),0.,1.);c=t<.5?mix(vec3(.10,.71,.63),vec3(1.,.65,.25),t*2.):mix(vec3(1.,.65,.25),vec3(.94,.12,.10),(t-.5)*2.);}
        gl_FragColor=vec4(c*(.94+.06*abs(normalize(n).z)),alpha);
      }`,
    transparent: !thickness, depthTest: thickness, depthWrite: thickness, side: THREE.DoubleSide,
    toneMapped: false, forceSinglePass: true,
  });
}
