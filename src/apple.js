import * as THREE from 'three';
import { xrayMaterial } from './xray.js';
import { mulberry32, noise2, canvasTexture, clamp } from './utils.js';

export const APPLE_R = 0.042;

function appleProfile() {
  const pts = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * Math.PI;
    let r = APPLE_R * Math.sin(phi) * (1 + 0.07 * Math.max(0, -Math.cos(phi)) + 0.04 * Math.sin(phi));
    let y = -APPLE_R * Math.cos(phi) * 0.9;
    y -= APPLE_R * 0.42 * Math.exp(-(((Math.PI - phi) / 0.42) ** 2));
    y += APPLE_R * 0.2 * Math.exp(-((phi / 0.36) ** 2));
    if (i === 0 || i === n) r = 0.00001;
    pts.push(new THREE.Vector2(r, y));
  }
  return pts;
}

function skinTexture() {
  return canvasTexture(1024, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#9c8a2c');
    grad.addColorStop(0.08, '#8f1e14');
    grad.addColorStop(0.5, '#8a0f12');
    grad.addColorStop(0.9, '#7d1412');
    grad.addColorStop(1, '#a08a30');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const r = mulberry32(17);
    // sun blush / yellow side
    for (let i = 0; i < 3; i++) {
      const cx = (0.15 + i * 0.33) * w;
      const bl = g.createRadialGradient(cx, h * 0.55, 10, cx, h * 0.55, w * 0.18);
      bl.addColorStop(0, i === 1 ? 'rgba(205,150,40,0.45)' : 'rgba(170,25,20,0.35)');
      bl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bl; g.fillRect(0, 0, w, h);
    }
    // vertical streaks
    for (let i = 0; i < 700; i++) {
      let x = r() * w;
      const dark = r() < 0.6;
      g.strokeStyle = dark ? `rgba(${70 + r() * 40},${5 + r() * 10},${10},${0.25 + r() * 0.35})` : `rgba(${190 + r() * 50},${60 + r() * 60},${30},${0.12 + r() * 0.18})`;
      g.lineWidth = 1 + r() * 3.5;
      g.beginPath();
      const y0 = h * (0.05 + r() * 0.2), y1 = h * (0.75 + r() * 0.2);
      g.moveTo(x, y0);
      for (let y = y0; y < y1; y += 12) { x += (r() - 0.5) * 3; g.lineTo(x, y); }
      g.stroke();
    }
    // lenticels
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(245,${200 + r() * 40},${150 + r() * 50},${0.25 + r() * 0.4})`;
      g.beginPath(); g.ellipse(r() * w, h * (0.08 + r() * 0.84), 0.7 + r() * 1.3, 0.6 + r() * 1.0, 0, 0, 7); g.fill();
    }
  });
}

function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 12, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) * 2;
    const w = Math.pow(Math.sin(Math.PI * Math.min(u * 1.05, 1)), 0.8) * 0.011;
    p.setXYZ(i, u * 0.05, -0.012 * u * u + Math.abs(v) * w * 0.35, v * w);
  }
  g.computeVertexNormals();
  return g;
}

export function buildApple(xray) {
  const group = new THREE.Group();
  group.name = 'apple';
  const lathe = new THREE.LatheGeometry(appleProfile(), 96);
  const p = lathe.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const lob = 1 + 0.028 * Math.cos(5 * a) * Math.max(0, -y / APPLE_R) + noise2(Math.cos(a) * 2.5, y * 40) * 0.018;
    p.setXYZ(i, x * lob, y, z * lob);
  }
  lathe.computeVertexNormals();
  const skin = new THREE.MeshPhysicalMaterial({ map: skinTexture(), roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const apple = new THREE.Mesh(lathe, skin);
  apple.castShadow = true; apple.receiveShadow = true;
  group.add(apple);
  let topY = -1e9;
  for (let i = 0; i < p.count; i++) if (Math.hypot(p.getX(i), p.getZ(i)) < 0.002) topY = Math.max(topY, p.getY(i));

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a321c, roughness: 0.8 });
  const stemCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, topY - 0.002, 0), new THREE.Vector3(0.001, topY + 0.012, 0), new THREE.Vector3(0.006, topY + 0.024, 0.001)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 12, 0.0019, 8), stemMat);
  stem.castShadow = true;
  group.add(stem);
  const leaf = new THREE.Mesh(leafGeometry(), new THREE.MeshStandardMaterial({ color: 0x3d6a1c, roughness: 0.5, side: THREE.DoubleSide }));
  leaf.position.set(0.004, topY + 0.018, 0.001);
  leaf.rotation.set(0.4, -0.6, 0.35);
  leaf.castShadow = true;
  group.add(leaf);

  // x-ray internals
  const xSkin = xrayMaterial({ color: 0xffb8a8, base: 0.02, rim: 0.65, power: 2.2 });
  const xCore = xrayMaterial({ color: 0xffe6c8, base: 0.06, rim: 0.8, power: 1.8 });
  const xSeed = xrayMaterial({ color: 0xffffff, base: 0.35, rim: 1.4, power: 1.4, intensity: 1.3 });
  const xVein = xrayMaterial({ color: 0xffd0b0, base: 0.2, rim: 0.6, power: 1.5 });
  apple.userData.xrayMat = xSkin;
  stem.userData.xrayMat = xCore;
  leaf.userData.xrayMat = xrayMaterial({ color: 0xc8ffb0, base: 0.02, rim: 0.4 });
  xray.register(group);
  const internals = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), xCore);
  core.scale.set(0.012, 0.024, 0.012); internals.add(core);
  const seeds = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), xSeed);
    s.scale.set(0.0026, 0.0055, 0.0019);
    s.position.set(Math.cos(a) * 0.0075, 0.002, Math.sin(a) * 0.0075);
    s.rotation.set(Math.sin(a) * 0.4, -a, Math.cos(a) * 0.4);
    internals.add(s); seeds.push(s);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, y = topY * 0.85 + (-0.033 - topY * 0.85) * t;
      const rad = 0.003 + Math.sin(Math.PI * t) * 0.017;
      pts.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
    internals.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.00045, 4), xVein));
  }
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), xrayMaterial({ color: 0xffffff, base: 0.0, rim: 1.0, power: 3.0, intensity: 1 }));
  shock.visible = false;
  internals.add(shock);
  group.add(internals);
  xray.internal(internals);

  // Bottom of the apple that stays on the stump after the burst (shown by AppleBurst.explode).
  const CUT = -0.009;
  const prof = appleProfile();
  const low = [];
  for (let i = 0; i < prof.length; i++) {
    if (prof[i].y < CUT) { low.push(prof[i].clone()); continue; }
    const a = prof[i - 1], b = prof[i], t = (CUT - a.y) / (b.y - a.y);
    low.push(new THREE.Vector2(a.x + (b.x - a.x) * t, CUT));
    break;
  }
  const lob = (x, y, z) => { const a = Math.atan2(z, x); return 1 + 0.028 * Math.cos(5 * a) * Math.max(0, -y / APPLE_R) + noise2(Math.cos(a) * 2.5, y * 40) * 0.018; };
  const remGeo = new THREE.LatheGeometry(low, 96);
  const rp = remGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i); const k = lob(x, y, z); rp.setXYZ(i, x * k, y, z * k); }
  remGeo.computeVertexNormals();
  const remnant = new THREE.Group();
  const remSkin = new THREE.Mesh(remGeo, skin);
  remSkin.castShadow = remSkin.receiveShadow = true;
  const capR = low[low.length - 1].x;
  const cap = new THREE.CircleGeometry(capR, 96, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  const cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), z = cp.getZ(i), d = Math.hypot(x, z) / capR;
    const k = lob(x, CUT, z) * (d > 0.99 ? 1 : 0.995);
    cp.setXYZ(i, x * k, CUT + 0.004 * noise2(x * 300, z * 300) * d + 0.002 * (1 - d), z * k);
  }
  cap.computeVertexNormals();
  const capMesh = new THREE.Mesh(cap, new THREE.MeshStandardMaterial({ color: 0xc4a866, roughness: 0.35, side: THREE.DoubleSide }));
  capMesh.receiveShadow = true;
  remnant.add(remSkin, capMesh);
  remnant.visible = false;
  group.add(remnant);

  return { group, apple, stem, leaf, internals, shock, seeds, skin, topY, remnant };
}

// --------------------------------------------------------------------------------------------
// Explosion: chunks of flesh/skin, juice droplets (instanced), seeds, stem and leaf. Sim-time physics.
export class AppleBurst {
  constructor(scene, appleParts, groundY, stump) {
    this.scene = scene;
    this.parts = appleParts;
    this.groundY = groundY;
    this.stump = stump; // { center: Vector3, top: number, radius }
    this.rng = mulberry32(2024);
    this.root = new THREE.Group();
    scene.add(this.root);
    this.items = [];
    this.active = false;
    this.onBounce = null;

    const flesh = new THREE.Color(0xb59858), skinC = new THREE.Color(0x8e1215);
    this.chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
    this.templates = [];
    for (let k = 0; k < 8; k++) {
      for (const outer of [false, true]) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        const pp = g.attributes.position;
        const col = new Float32Array(pp.count * 3);
        const sx = 0.7 + this.rng() * 0.6, sy = 0.6 + this.rng() * 0.7, sz = 0.5 + this.rng() * 0.6;
        for (let i = 0; i < pp.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pp, i);
          const n = 1 + noise2(v.x * 1.7 + k * 3, v.y * 1.7 + v.z * 1.3) * 0.55;
          const isSkin = outer && v.x > 0.25;
          if (outer && v.x > 0.25) v.x = 0.25 + (v.x - 0.25) * 0.4; // flattened skin face
          v.set(v.x * sx * n, v.y * sy * n, v.z * sz * n);
          pp.setXYZ(i, v.x, v.y, v.z);
          const c = isSkin ? skinC.clone().offsetHSL(0, 0, (this.rng() - 0.5) * 0.05) : flesh.clone().offsetHSL((this.rng() - 0.5) * 0.02, 0, (this.rng() - 0.5) * 0.06);
          col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        this.templates.push({ g, outer });
      }
    }

    this.dropMax = 600;
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xa8955a, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.6, envMapIntensity: 0.4 }), this.dropMax);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.root.add(this.drops);
    this.dropData = [];
    this.seedMat = new THREE.MeshStandardMaterial({ color: 0x3a1f0e, roughness: 0.4 });
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3();
  }

  reset() {
    for (const it of this.items) {
      if (it.own) { this.root.remove(it.mesh); }
    }
    this.items = [];
    this.dropData = [];
    this.drops.count = 0;
    this.active = false;
    const P = this.parts;
    for (const m of [P.stem, P.leaf]) {
      if (m.parent !== P.group) { m.parent && m.parent.remove(m); P.group.add(m); }
    }
    P.stem.position.set(0, 0, 0); P.stem.rotation.set(0, 0, 0); P.stem.scale.set(1, 1, 1);
    P.leaf.position.set(0.004, P.topY + 0.018, 0.001); P.leaf.rotation.set(0.4, -0.6, 0.35);
    P.apple.visible = true; P.remnant.visible = false;
    P.group.scale.set(1, 1, 1);
  }

  explode(center, dir, mistSystem) {
    const r = this.rng;
    const P = this.parts;
    this.active = true;
    P.apple.visible = false; P.remnant.visible = true;
    const up = new THREE.Vector3(0, 1, 0);
    const add = (mesh, pos, vel, ang, size, drag, own = true) => {
      mesh.position.copy(pos);
      this.items.push({ mesh, vel, ang, size, drag, own, rest: false });
      if (own) this.root.add(mesh);
    };
    const n = 64;
    for (let i = 0; i < n; i++) {
      const big = i < 12;
      const size = big ? 0.009 + r() * 0.008 : 0.003 + r() * 0.006;
      let rad = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (rad.lengthSq() > 1 || rad.lengthSq() < 0.01) { i--; continue; }
      const depth = Math.cbrt(r()) * 0.85;
      const outer = depth > 0.55;
      rad.normalize();
      const tpl = this.templates[(Math.floor(r() * 8) * 2) + (outer ? 1 : 0)];
      const mesh = new THREE.Mesh(tpl.g, this.chunkMat);
      mesh.castShadow = true;
      mesh.scale.setScalar(size);
      // orient the template's skin face (+X) outward
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), rad).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r() * 6.28));
      const pos = center.clone().addScaledVector(rad, APPLE_R * depth);
      const exitBias = 0.6 + Math.max(0, rad.dot(dir)) * 1.6;
      const vel = rad.clone().multiplyScalar((2.5 + r() * 5.5) * exitBias).addScaledVector(dir, 3.5 + r() * 7).addScaledVector(up, 1 + r() * 2.5);
      const ang = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(80 / (0.5 + size * 120));
      // a handful of pieces only slump off and land on or next to the stump
      if (i % 5 === 4) { vel.multiplyScalar(0.12); vel.y = Math.abs(vel.y); pos.y = Math.max(pos.y, center.y); }
      add(mesh, pos, vel, ang, size, 1.2 + 0.012 / size);
    }
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), this.seedMat);
      s.scale.set(0.0026, 0.0055, 0.0019);
      const rad = new THREE.Vector3(r() - 0.5, r() - 0.3, r() - 0.5).normalize();
      add(s, center.clone().addScaledVector(rad, 0.008), rad.multiplyScalar(5 + r() * 6).addScaledVector(dir, 8 + r() * 6), new THREE.Vector3(r() * 40, r() * 40, r() * 40), 0.004, 0.8);
    }
    // stem & leaf: detach, keep world transform
    for (const m of [P.stem, P.leaf]) {
      this.scene.attach(m);
      const v = new THREE.Vector3((r() - 0.5) * 3, 6 + r() * 3, 0).addScaledVector(dir, 5);
      add(m, m.position.clone(), v, new THREE.Vector3(r() * 25, r() * 25, r() * 25), m === P.leaf ? 0.01 : 0.006, m === P.leaf ? 3.5 : 0.8, false);
    }
    // juice
    for (let i = 0; i < this.dropMax; i++) {
      const rad = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      const back = r() < 0.12;
      const pos = center.clone().addScaledVector(rad, APPLE_R * (0.3 + r() * 0.65));
      let vel;
      if (back) vel = dir.clone().multiplyScalar(-(4 + r() * 10)).addScaledVector(rad, 2 + r() * 4);
      else vel = rad.clone().multiplyScalar((3 + r() * 8) * (0.6 + Math.max(0, rad.dot(dir)) * 1.5)).addScaledVector(dir, 4 + r() * 12).addScaledVector(up, r() * 2);
      this.dropData.push({ pos, vel, size: 0.0006 + Math.pow(r(), 2.5) * 0.0028, alive: true });
    }
    this.drops.count = this.dropData.length;
    // mist
    if (mistSystem) {
      for (let i = 0; i < 180; i++) {
        const rad = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
        mistSystem.spawn({
          pos: center.clone().addScaledVector(rad, APPLE_R * r()),
          vel: rad.multiplyScalar(3 + r() * 9).addScaledVector(dir, 3 + r() * 10),
          life: 0.8 + r() * 1.4, size0: 0.012 + r() * 0.02, size1: 0.1 + r() * 0.16, alpha: 0.05 + r() * 0.07,
          color: [0.55, 0.5, 0.38], drag: 4 + r() * 3, grav: -0.6, rotV: (r() - 0.5) * 2,
        });
      }
    }
    this.update(0);
  }

  _collide(pos, vel, size, bounce) {
    const st = this.stump;
    const dx = pos.x - st.center.x, dz = pos.z - st.center.z;
    let floor = this.groundY(pos.x, pos.z);
    if (dx * dx + dz * dz < st.radius * st.radius) floor = Math.max(floor, st.top);
    if (pos.y - size < floor && vel.y < 0) {
      pos.y = floor + size;
      const hard = -vel.y;
      vel.y = -vel.y * bounce;
      vel.x *= 0.55; vel.z *= 0.55;
      return hard;
    }
    return 0;
  }

  update(dt) {
    if (!this.active) return;
    const g = -9.81;
    for (const it of this.items) {
      if (it.rest) continue;
      const { mesh, vel, ang } = it;
      const k = Math.exp(-it.drag * dt);
      vel.multiplyScalar(k); vel.y += g * dt;
      mesh.position.addScaledVector(vel, dt);
      const a = ang.length();
      if (a > 0) mesh.quaternion.premultiply(this._q.setFromAxisAngle(this._v.copy(ang).multiplyScalar(1 / a), a * dt));
      const hit = this._collide(mesh.position, vel, it.size * 0.6, 0.25);
      if (hit > 0) {
        ang.multiplyScalar(0.5);
        if (this.onBounce && hit > 0.8) this.onBounce(hit, it.size);
        if (vel.lengthSq() < 0.04) { it.rest = true; }
      }
    }
    const m = this._m, q = this._q, s = this._s;
    const yAxis = new THREE.Vector3(0, 1, 0);
    let i = 0;
    for (const d of this.dropData) {
      if (d.alive) {
        const k = Math.exp(-4.5 * dt);
        d.vel.multiplyScalar(k); d.vel.y += g * dt;
        d.pos.addScaledVector(d.vel, dt);
        if (this._collide(d.pos, d.vel, d.size, 0) > 0) d.alive = false;
      }
      const sp = d.vel.length();
      if (sp > 1e-4) q.setFromUnitVectors(yAxis, this._v.copy(d.vel).multiplyScalar(1 / sp)); else q.identity();
      const stretch = 1 + clamp(sp / 12, 0, 2.2);
      const sz = d.size;
      if (d.alive) s.set(sz / Math.sqrt(stretch), sz * stretch, sz / Math.sqrt(stretch));
      else { s.set(sz * 1.5, sz * 0.3, sz * 1.5); q.identity(); }
      m.compose(d.pos, q, s);
      this.drops.setMatrixAt(i++, m);
    }
    this.drops.instanceMatrix.needsUpdate = true;
  }
}
