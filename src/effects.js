import * as THREE from 'three';
import { LOGDEPTH_VERT_PARS, LOGDEPTH_VERT, LOGDEPTH_FRAG_PARS, LOGDEPTH_FRAG, mulberry32, noise2, canvasTexture, clamp, easeOut } from './utils.js';
import { xrayMaterial } from './xray.js';
import { makeGlowTexture } from './rifle.js';

export const TEX = {};
export function initTextures() {
  TEX.puff = canvasTexture(128, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      let n = 0, a = 1, f = 3;
      for (let o = 0; o < 4; o++) { n += noise2(x / w * f + 7, y / h * f + 3) * a; a *= 0.5; f *= 2; }
      const fall = Math.max(0, 1 - d);
      const v = clamp(fall * fall * (0.65 + n * 0.9));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = v * 255;
    }
    g.putImageData(img, 0, 0);
  });
  TEX.dot = canvasTexture(64, 64, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
  TEX.glow = makeGlowTexture([255, 255, 235], [255, 150, 40]);
  TEX.flame = canvasTexture(256, 64, (g, w, h) => {
    const r = mulberry32(31);
    for (let i = 0; i < 90; i++) {
      const y = h / 2 + (r() - 0.5) * h * 0.5 * r();
      const len = w * (0.3 + r() * 0.7);
      const grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, 'rgba(255,250,220,0.0)');
      grd.addColorStop(0.08, 'rgba(255,240,190,0.35)');
      grd.addColorStop(0.5, 'rgba(255,150,50,0.18)');
      grd.addColorStop(1, 'rgba(255,80,10,0)');
      g.strokeStyle = grd; g.lineWidth = 1 + r() * 5;
      g.beginPath(); g.moveTo(0, h / 2); g.quadraticCurveTo(len * 0.5, y, len, y + (r() - 0.5) * 20); g.stroke();
    }
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  });
}

// Camera-facing instanced quads with CPU simulation in sim-time.
export class Particles {
  constructor({ max = 500, map, additive = false, intensity = 1 }) {
    this.max = max;
    this.additive = additive;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aRot, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iAlpha', this.aAlpha);
    g.setAttribute('iRot', this.aRot); g.setAttribute('iColor', this.aCol);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uIntensity: { value: intensity } },
      vertexShader: LOGDEPTH_VERT_PARS + `
        attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iRot; attribute vec3 iColor;
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main() {
          vUv = uv; vAlpha = iAlpha; vColor = iColor;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iRot), s = sin(iRot);
          vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSize;
          vec3 wp = iPos + right * p.x + up * p.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          ` + LOGDEPTH_VERT + `
        }`,
      fragmentShader: LOGDEPTH_FRAG_PARS + `
        uniform sampler2D map; uniform float uIntensity;
        varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
        void main() {
          ` + LOGDEPTH_FRAG + `
          vec4 t = texture2D(map, vUv);
          float a = t.a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * t.rgb * uIntensity, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    this.p = [];
    this.rng = mulberry32(max * 7 + 1);
  }
  clear() { this.p.length = 0; this.mesh.geometry.instanceCount = 0; }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      pos: o.pos.clone(), vel: o.vel ? o.vel.clone() : new THREE.Vector3(), age: 0, life: o.life ?? 1,
      size0: o.size0 ?? 0.05, size1: o.size1 ?? o.size0 ?? 0.05, alpha: o.alpha ?? 1, color: o.color ?? [1, 1, 1],
      drag: o.drag ?? 0, grav: o.grav ?? 0, rot: o.rot ?? this.rng() * 6.28, rotV: o.rotV ?? 0, fadeIn: o.fadeIn ?? 0.08,
      grow: o.grow ?? 0.5, tau: o.tau ?? 0, sizeMid: o.sizeMid ?? 0,
    });
  }
  update(dt, camera) {
    const P = this.p;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      q.age += dt;
      if (q.age >= q.life) { P.splice(i, 1); continue; }
      const k = Math.exp(-q.drag * dt);
      q.vel.multiplyScalar(k);
      q.vel.y -= q.grav * dt;
      q.pos.addScaledVector(q.vel, dt);
      q.rot += q.rotV * dt;
    }
    if (!this.additive && camera) {
      const c = camera.position;
      P.sort((a, b) => b.pos.distanceToSquared(c) - a.pos.distanceToSquared(c));
    }
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      const t = q.age / q.life;
      let grow = 1 - Math.pow(1 - t, 1 / Math.max(q.grow, 0.05));
      // optional fast initial expansion (gas bursts) with time constant tau in sim seconds
      const fast = q.tau > 0 ? q.sizeMid * (1 - Math.exp(-q.age / q.tau)) : 0;
      this.aPos.setXYZ(i, q.pos.x, q.pos.y, q.pos.z);
      this.aSize.setX(i, q.size0 + fast + (q.size1 - q.size0) * grow);
      const fin = Math.min(1, t / q.fadeIn);
      this.aAlpha.setX(i, q.alpha * fin * Math.pow(1 - t, 1.4));
      this.aRot.setX(i, q.rot);
      this.aCol.setXYZ(i, q.color[0], q.color[1], q.color[2]);
    }
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aRot, this.aCol]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, P.length) * a.itemSize); }
    this.mesh.geometry.instanceCount = P.length;
  }
}

// Muzzle flash, brake side-jets, blast smoke, shock bubble and ground dust.
export class MuzzleBlast {
  constructor(scene, smoke, fire, dust) {
    this.smoke = smoke; this.sparks = fire; this.dust = dust;
    this.group = new THREE.Group();
    scene.add(this.group);
    const mk = (tex, color) => new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.coneMat = mk(TEX.flame, new THREE.Color(2.4, 1.4, 0.6));
    this.jetMat = mk(TEX.flame, new THREE.Color(2.0, 1.05, 0.4));
    const cross = (mat) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), mat);
        pl.rotation.x = (i / 3) * Math.PI; g.add(pl);
      }
      return g;
    };
    this.cone = cross(this.coneMat);
    this.jets = [cross(this.jetMat), cross(this.jetMat)];
    this.jets[0].rotation.y = Math.PI / 2; this.jets[1].rotation.y = -Math.PI / 2;
    this.ball = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: new THREE.Color(2.2, 1.5, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.group.add(this.cone, ...this.jets, this.ball);
    this.light = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.group.add(this.light);
    this.shock = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), xrayMaterial({ color: 0xfff4e0, base: 0, rim: 0.5, power: 4, intensity: 1 }));
    this.group.add(this.shock);
    this.group.visible = false;
    this.age = -1;
    this.rng = mulberry32(77);
    this.emitted = 0;
  }
  // frame: { pos, dir, right, up } in world space; groundY below muzzle
  fire(frame, groundY) {
    this.frame = frame; this.groundY = groundY;
    this.group.position.copy(frame.pos);
    const m = new THREE.Matrix4().makeBasis(frame.dir, frame.up, frame.right);
    this.group.quaternion.setFromRotationMatrix(m);
    this.age = 0; this.emitted = 0; this.dustDone = false;
    this.group.visible = true;
  }
  reset() { this.age = -1; this.group.visible = false; }
  update(dt) {
    if (this.age < 0) return;
    this.age += dt;
    const t = this.age;
    const p = t / 0.0019;
    const I = p < 0.12 ? p / 0.12 : Math.max(0, Math.pow(1 - (p - 0.12) / 0.88, 1.6));
    const show = p < 1;
    this.cone.visible = this.ball.visible = this.jets[0].visible = this.jets[1].visible = show;
    if (show) {
      const L = 0.06 + 0.3 * easeOut(Math.min(p * 1.6, 1));
      const W = 0.03 + 0.17 * easeOut(Math.min(p * 1.3, 1));
      this.cone.scale.set(L, W, W);
      this.coneMat.opacity = I;
      for (const j of this.jets) j.scale.set(0.05 + 0.22 * easeOut(Math.min(p * 2, 1)), 0.05 + 0.09 * easeOut(Math.min(p * 1.5, 1)), 0.05 + 0.06 * easeOut(Math.min(p * 1.5, 1)));
      this.jets[0].position.set(-0.04, 0, 0); this.jets[1].position.set(-0.04, 0, 0);
      this.jetMat.opacity = I;
      this.ball.position.set(0.06 + 0.12 * easeOut(Math.min(p, 1)), 0, 0);
      this.ball.scale.setScalar(0.05 + 0.22 * easeOut(Math.min(p * 1.5, 1)));
      this.ball.material.opacity = I;
    }
    this.light.intensity = show ? 18 * I : 0;
    const sr = 343 * t;
    this.shock.visible = sr < 4;
    this.shock.scale.setScalar(Math.max(sr, 0.001));
    this.shock.material.uniforms.uIntensity.value = 0.6 * Math.max(0, 1 - sr / 4);

    // emission over the first ~3 ms of sim time
    const target = Math.floor(Math.min(t / 0.0016, 1) * 240);
    const f = this.frame, r = this.rng;
    while (this.emitted < target) {
      this.emitted++;
      const side = r() < 0.45 ? (r() < 0.5 ? -1 : 1) : 0;
      const jitter = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5);
      let vel;
      if (side) vel = f.right.clone().multiplyScalar(side * (60 + r() * 120)).addScaledVector(f.dir, -10 + r() * 40).addScaledVector(jitter, 60);
      else vel = f.dir.clone().multiplyScalar(40 + r() * 170).addScaledVector(jitter, 70);
      const gray = 0.62 + r() * 0.2;
      this.smoke.spawn({
        pos: f.pos.clone().addScaledVector(f.dir, -0.04 + r() * 0.03), vel, life: 1.6 + r() * 2.2,
        size0: 0.02 + r() * 0.02, size1: 0.3 + r() * 0.35, tau: 0.0012 + r() * 0.002, sizeMid: 0.07 + r() * 0.12, alpha: 0.3 + r() * 0.25, color: [gray * 1.05, gray, gray * 0.92],
        drag: 260 + r() * 200, grav: -0.25, rotV: (r() - 0.5) * 0.8, grow: 0.25, fadeIn: 0.002,
      });
      if (r() < 0.35) {
        this.sparks.spawn({
          pos: f.pos.clone(), vel: f.dir.clone().multiplyScalar(80 + r() * 250).addScaledVector(jitter, 90), life: 0.004 + r() * 0.006,
          size0: 0.006 + r() * 0.01, size1: 0.002, alpha: 1, color: [3, 1.7, 0.6], drag: 150, fadeIn: 0.01,
        });
      }
    }
    if (!this.dustDone && t > 0.0002) {
      this.dustDone = true;
      for (let i = 0; i < 90; i++) {
        const a = r() * Math.PI * 2;
        const dirG = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).addScaledVector(f.dir, 0.8).normalize();
        const pos = f.pos.clone().addScaledVector(dirG, r() * 0.3);
        pos.y = this.groundY + 0.02;
        const c = 0.45 + r() * 0.15;
        this.dust.spawn({
          pos, vel: dirG.multiplyScalar(6 + r() * 18).add(new THREE.Vector3(0, 1 + r() * 4, 0)), life: 2 + r() * 2.5,
          size0: 0.03, size1: 0.25 + r() * 0.35, alpha: 0.3 + r() * 0.2, color: [c * 1.1, c * 0.95, c * 0.75], drag: 9 + r() * 6, grav: 0.4, grow: 0.3,
        });
      }
    }
  }
}

// Ejected brass with simple rigid-body tumble and bounces.
export class Casing {
  constructor(scene, geometry, material) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.vel = new THREE.Vector3(); this.ang = new THREE.Vector3();
    this.active = false;
    this.onBounce = null;
  }
  launch(pos, quat, vel, ang, groundY) {
    this.mesh.position.copy(pos); this.mesh.quaternion.copy(quat);
    this.vel.copy(vel); this.ang.copy(ang);
    this.groundY = groundY; this.active = true; this.mesh.visible = true; this.rest = false;
  }
  reset() { this.active = false; this.mesh.visible = false; }
  update(dt) {
    if (!this.active || this.rest) return;
    this.vel.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.vel, dt);
    const a = this.ang.length();
    if (a > 0) this.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.ang.clone().multiplyScalar(1 / a), a * dt));
    const gy = this.groundY(this.mesh.position.x, this.mesh.position.z) + 0.01;
    if (this.mesh.position.y < gy && this.vel.y < 0) {
      const hard = -this.vel.y;
      this.mesh.position.y = gy;
      this.vel.y = -this.vel.y * 0.35; this.vel.x *= 0.5; this.vel.z *= 0.5;
      this.ang.multiplyScalar(0.6);
      if (this.onBounce && hard > 0.4) this.onBounce(hard);
      if (hard < 0.4) this.rest = true;
    }
  }
}

// Sunlit dust motes kept around the camera.
export class Motes {
  constructor(scene) {
    this.sys = new Particles({ max: 260, map: TEX.dot, additive: true, intensity: 1 });
    scene.add(this.sys.mesh);
    this.rng = mulberry32(5);
  }
  update(dt, camera) {
    const r = this.rng;
    while (this.sys.p.length < 220) {
      const d = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(3.0);
      const s = 0.0015 + r() * 0.003;
      this.sys.spawn({
        pos: camera.position.clone().add(d), vel: new THREE.Vector3((r() - 0.3) * 0.08, (r() - 0.5) * 0.03, (r() - 0.5) * 0.08),
        life: 4 + r() * 6, size0: s, size1: s, alpha: 0.5 + r() * 0.5, color: [1.6, 1.25, 0.8], fadeIn: 0.2,
      });
    }
    const c = camera.position;
    this.sys.p = this.sys.p.filter((q) => q.pos.distanceToSquared(c) < 9);
    this.sys.update(dt, camera);
  }
  clear() { this.sys.clear(); }
}
