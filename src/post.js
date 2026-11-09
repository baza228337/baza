import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final display-space grade: x-ray film look, zoom blur, chromatic aberration, vignette, grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uXray: { value: 0 },
    uCA: { value: 0.0012 },
    uZoom: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.045 },
    uSat: { value: 1.05 },
    uContrast: { value: 1.06 },
    uFade: { value: 1 },
    uWarm: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uXray; uniform float uCA;
    uniform float uZoom; uniform vec2 uCenter; uniform float uVignette; uniform float uGrain; uniform float uSat;
    uniform float uContrast; uniform float uFade; uniform float uWarm;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec3 sampleCA(vec2 uv, vec2 dc) {
      float k = uCA * (0.4 + dot(dc, dc) * 4.0);
      return vec3(texture2D(tDiffuse, uv - dc * k).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + dc * k).b);
    }
    void main() {
      vec2 dc = vUv - uCenter;
      vec3 col = sampleCA(vUv, dc);
      if (uZoom > 0.0005) {
        vec3 acc = col; float wsum = 1.0;
        for (int i = 1; i < 12; i++) {
          float s = 1.0 - uZoom * float(i) / 11.0 * length(dc) * 2.2;
          float w = 1.0 - float(i) / 13.0;
          acc += sampleCA(uCenter + dc * s, dc) * w; wsum += w;
        }
        col = acc / wsum;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col += uWarm * (vec3(0.035, 0.012, -0.03) * smoothstep(0.35, 1.0, l) + vec3(-0.015, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.35, l)));
      // x-ray film: crush mid-tones to deep blue, keep bright density, keep strongly saturated glows
      float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
      vec3 xr = vec3(pow(clamp(l, 0.0, 1.0), 2.1)) * vec3(0.62, 0.86, 1.15) * 1.35 + vec3(0.0, 0.012, 0.035);
      xr = mix(xr, col * 1.1, smoothstep(0.3, 0.65, mx - mn) * smoothstep(0.35, 0.8, mx));
      xr *= 0.94 + 0.06 * sin(gl_FragCoord.y * 1.7 + uTime * 30.0);
      col = mix(col, xr, uXray);
      vec2 vc = dc * vec2(uRes.x / uRes.y, 1.0);
      float v = smoothstep(1.05, 0.25, length(vc));
      col *= mix(1.0, v, uVignette + uXray * 0.25);
      col += (hash(vUv * uRes + fract(uTime * 7.13)) - 0.5) * (uGrain + uXray * 0.03);
      gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
    }`,
};

export function buildPost(renderer, scene, camera, { quality }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.55, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return {
    composer, bloom, grade, u: grade.uniforms,
    setSize(w, h) { composer.setSize(w, h); grade.uniforms.uRes.value.set(w, h); },
    render(dt) { grade.uniforms.uTime.value += dt; composer.render(dt); },
  };
}
