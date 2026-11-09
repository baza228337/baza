import * as THREE from 'three';
import { LOGDEPTH_VERT_PARS, LOGDEPTH_VERT, LOGDEPTH_FRAG_PARS, LOGDEPTH_FRAG } from './utils.js';

// Fresnel "x-ray film" material: additive, rim-weighted, so overlapping layers read as density.
export function xrayMaterial({ color = 0x9fd4ff, base = 0.04, rim = 0.9, power = 2.2, intensity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uBase: { value: base },
      uRim: { value: rim },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: LOGDEPTH_VERT_PARS + `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        ` + LOGDEPTH_VERT + `
      }`,
    fragmentShader: LOGDEPTH_FRAG_PARS + `
      uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uPower; uniform float uIntensity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        ` + LOGDEPTH_FRAG + `
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = uBase + uRim * pow(f, uPower);
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

export class XRay {
  constructor() {
    this.entries = [];
    this.xOnly = [];
    this.normalOnly = [];
    this.active = false;
  }
  // Swap every mesh under `root` to `mat` while x-ray is on.
  register(root, mat) {
    root.traverse((o) => {
      if (o.isMesh && !o.userData.noXray) this.entries.push({ mesh: o, normal: o.material, xray: o.userData.xrayMat || mat });
    });
  }
  internal(obj) { obj.visible = false; this.xOnly.push(obj); }
  hideInXray(obj) { this.normalOnly.push(obj); }
  set(on) {
    if (on === this.active) return;
    this.active = on;
    for (const e of this.entries) e.mesh.material = on ? e.xray : e.normal;
    for (const o of this.xOnly) o.visible = on;
    for (const o of this.normalOnly) o.visible = !on;
  }
}
