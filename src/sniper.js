import * as THREE from 'three';
import { xrayMaterial } from './xray.js';
import { addWind } from './world.js';
import { mulberry32 } from './utils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y_UP = V(0, 1, 0);

function unitRod(r0, r1, mat, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, seg);
  return new THREE.Mesh(g, mat);
}
function placeRod(m, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y_UP, d.multiplyScalar(1 / len));
  m.scale.set(1, len, 1);
}
function capsule(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CapsuleGeometry(r, d.length(), 6, 14);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(Y_UP, d.normalize());
  return m;
}

function strandGeometry() {
  const P = [], N = [], H = [], I = [];
  const rows = [0, 0.33, 0.66, 1];
  rows.forEach((t, i) => {
    const w = 0.5 * (1 - t * 0.6);
    P.push(-w, t, 0, w, t, 0); N.push(0, 0.3, 1, 0, 0.3, 1); H.push(t, t);
    if (i < rows.length - 1) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setIndex(I);
  return g;
}

// Prone sniper in a ghillie suit. `rig` is the shooter frame (X fwd, Y up, Z right, ground y=0);
// hand/finger live in the rifle frame so they follow the grip.
export function buildSniper(rig, rifle, xray) {
  const rng = mulberry32(99);
  const burlap = new THREE.MeshStandardMaterial({ color: 0x4a4630, roughness: 1 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x2f2b22, roughness: 0.85 });
  const xSkin = xrayMaterial({ color: 0x7fb4e6, base: 0.008, rim: 0.28, power: 2.0 });
  const xBone = xrayMaterial({ color: 0xeef6ff, base: 0.22, rim: 1.25, power: 1.5, intensity: 1.25 });

  const body = new THREE.Group();
  rig.add(body);
  const parts = [];
  const cap = (a, b, r) => { const m = capsule(a, b, r, burlap); m.castShadow = m.receiveShadow = true; body.add(m); parts.push({ a, b, r }); return m; };
  const sph = (c, r, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), burlap);
    m.position.copy(c); m.scale.set(sx, sy, sz); m.castShadow = m.receiveShadow = true; body.add(m);
    parts.push({ c, r: r * Math.max(sx, sy, sz), sphere: true });
    return m;
  };
  const headC = V(-0.41, 0.355, -0.04);
  sph(headC, 0.1, 1.05, 1, 1);
  sph(V(-0.45, 0.39, -0.045), 0.12, 1.2, 0.9, 1.05); // hood
  cap(V(-0.46, 0.32, -0.05), V(-0.58, 0.24, -0.07), 0.065);
  cap(V(-0.62, 0.2, -0.07), V(-1.12, 0.15, -0.2), 0.16);
  sph(V(-1.16, 0.13, -0.2), 0.165, 1.1, 0.75, 1.15);
  cap(V(-1.2, 0.11, -0.32), V(-1.62, 0.09, -0.46), 0.085);
  cap(V(-1.62, 0.09, -0.46), V(-2.02, 0.075, -0.56), 0.068);
  cap(V(-1.2, 0.11, -0.08), V(-1.56, 0.1, 0.12), 0.085);
  cap(V(-1.56, 0.1, 0.12), V(-1.98, 0.075, 0.2), 0.068);
  // arms (rig frame). Right hand reaches the grip, left hand squeezes the rear bag.
  const rShoulder = V(-0.62, 0.22, 0.1), rElbow = V(-0.43, 0.06, 0.25), rWrist = V(-0.245, 0.225, 0.035);
  cap(rShoulder, rElbow, 0.062);
  cap(rElbow, rWrist, 0.05);
  const lShoulder = V(-0.6, 0.21, -0.23), lElbow = V(-0.36, 0.06, -0.3), lHand = V(-0.43, 0.13, -0.065);
  cap(lShoulder, lElbow, 0.062);
  cap(lElbow, lHand, 0.05);
  const lGlove = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), glove);
  lGlove.position.copy(lHand); lGlove.scale.set(1.2, 0.8, 1); lGlove.castShadow = true;
  body.add(lGlove);
  // rear bag
  const bag = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), new THREE.MeshStandardMaterial({ color: 0x5a5038, roughness: 1 }));
  bag.position.set(-0.42, 0.085, 0); bag.scale.set(0.11, 0.1, 0.085); bag.castShadow = bag.receiveShadow = true;
  rig.add(bag);
  xray.register(body, xSkin);

  // ---- ghillie strands ----
  const strands = [];
  for (const p of parts) {
    const area = p.sphere ? 4 * Math.PI * p.r * p.r : 2 * Math.PI * p.r * p.a.distanceTo(p.b);
    const n = Math.floor(area * 9000);
    for (let i = 0; i < n; i++) {
      let pos, nrm;
      if (p.sphere) {
        nrm = V(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
        pos = p.c.clone().addScaledVector(nrm, p.r * 0.92);
      } else {
        const ax = new THREE.Vector3().subVectors(p.b, p.a).normalize();
        const u = new THREE.Vector3().crossVectors(ax, Y_UP).normalize();
        const v = new THREE.Vector3().crossVectors(u, ax).normalize();
        const th = rng() * Math.PI * 2;
        nrm = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
        pos = p.a.clone().lerp(p.b, rng()).addScaledVector(nrm, p.r * 0.9);
      }
      if (nrm.y < -0.35) continue;
      strands.push({ pos, nrm });
    }
  }
  const sMat = addWind(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.95 }), 0.04, [0.45, 1.05]);
  const sMesh = new THREE.InstancedMesh(strandGeometry(), sMat, strands.length);
  const pal = [0x3f4226, 0x55522f, 0x3a4222, 0x625a38, 0x2e2f1d, 0x6b6340, 0x4b5a28].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  strands.forEach((st, i) => {
    const dir = st.nrm.clone().multiplyScalar(0.4).add(V((rng() - 0.5) * 0.8, -0.75 + rng() * 0.45, (rng() - 0.5) * 0.8)).normalize();
    q.setFromUnitVectors(Y_UP, dir);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Y_UP, rng() * Math.PI));
    const len = 0.05 + rng() * 0.1;
    const sw = 0.012 + rng() * 0.014;
    s.set(sw, len, sw);
    m4.compose(st.pos, q, s);
    sMesh.setMatrixAt(i, m4);
    sMesh.setColorAt(i, pal[Math.floor(rng() * pal.length)].clone().multiplyScalar(0.75 + rng() * 0.5));
  });
  sMesh.castShadow = true;
  sMesh.receiveShadow = true;
  sMesh.computeBoundingSphere();
  rig.add(sMesh);
  xray.hideInXray(sMesh);

  // ---- right hand on the grip (rifle frame) ----
  const R = rifle.group;
  const hand = new THREE.Group();
  R.add(hand);
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), glove);
  palm.position.set(-0.2, -0.098, 0.016); palm.scale.set(0.034, 0.055, 0.03); palm.rotation.z = -0.25;
  palm.castShadow = true; hand.add(palm);
  for (let i = 0; i < 3; i++) {
    const y = -0.085 - i * 0.022;
    const a = V(-0.188 + i * 0.006, y, 0.03), b = V(-0.152 + i * 0.006, y - 0.004, 0.012), c = V(-0.158 + i * 0.006, y - 0.006, -0.024);
    for (const [p0, p1] of [[a, b], [b, c]]) {
      const f = unitRod(0.0085, 0.0078, glove); placeRod(f, p0, p1); f.castShadow = true; hand.add(f);
    }
  }
  const thumb = unitRod(0.009, 0.008, glove); placeRod(thumb, V(-0.215, -0.055, 0.02), V(-0.168, -0.034, -0.021)); hand.add(thumb);
  const wristCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.036, 0.04, 18), glove);
  placeRod(wristCuff, V(-0.27, -0.105, 0.035), V(-0.23, -0.1, 0.03)); wristCuff.scale.y = 0.05; hand.add(wristCuff);
  // index finger: MCP -> PIP -> DIP -> tip on the trigger
  const idxGlove = [unitRod(0.0082, 0.0078, glove), unitRod(0.0078, 0.0072, glove), unitRod(0.0072, 0.0064, glove)];
  idxGlove.forEach((m) => { m.castShadow = true; hand.add(m); });
  xray.register(hand, xSkin);

  const bones = new THREE.Group();
  R.add(bones);
  const bone = (r0, r1) => { const m = unitRod(r0, r1, xBone, 10); m.userData.xrayMat = xBone; bones.add(m); return m; };
  const idxBones = [bone(0.0042, 0.0034), bone(0.0034, 0.003), bone(0.003, 0.0022)];
  const joints = [];
  for (let i = 0; i < 4; i++) {
    const j = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 10, 8), xBone); bones.add(j); joints.push(j);
  }
  // metacarpals, other fingers, wrist, forearm, upper arm (rifle frame = rig - bore height)
  const rigToRifle = (v) => v.clone().sub(V(0, 0.33, 0));
  const wristR = V(-0.238, -0.1, 0.03);
  const mcps = [V(-0.168, -0.06, 0.026), V(-0.18, -0.083, 0.03), V(-0.186, -0.105, 0.03), V(-0.19, -0.126, 0.028)];
  mcps.forEach((m) => placeRod(bone(0.0045, 0.0038), wristR, m));
  for (let i = 1; i < 4; i++) {
    const y = mcps[i].y;
    const a = mcps[i], b = V(-0.152 + i * 0.006, y - 0.004, 0.012), c = V(-0.158 + i * 0.006, y - 0.006, -0.022);
    placeRod(bone(0.0036, 0.003), a, b); placeRod(bone(0.003, 0.0024), b, c);
  }
  placeRod(bone(0.0045, 0.0035), V(-0.225, -0.075, 0.03), V(-0.19, -0.05, 0.0));
  placeRod(bone(0.0035, 0.003), V(-0.19, -0.05, 0.0), V(-0.166, -0.036, -0.02));
  const elbowR = rigToRifle(rElbow), shoulderR = rigToRifle(rShoulder);
  placeRod(bone(0.0075, 0.0065), elbowR, wristR.clone().add(V(-0.004, 0.006, 0.004)));
  placeRod(bone(0.0068, 0.006), elbowR.clone().add(V(0.0, -0.012, -0.008)), wristR.clone().add(V(0.002, -0.01, -0.006)));
  placeRod(bone(0.011, 0.009), shoulderR, elbowR);
  const carpal = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), xBone);
  carpal.position.copy(wristR); carpal.scale.set(1, 0.7, 0.9); bones.add(carpal);
  // skull + cervical spine (rig frame -> rifle frame)
  const skullC = rigToRifle(headC);
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.078, 28, 20), xBone);
  cranium.position.copy(skullC).add(V(-0.012, 0.012, 0)); cranium.scale.set(1.12, 0.95, 0.88); bones.add(cranium);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), xBone);
  face.position.copy(skullC).add(V(0.06, -0.035, 0)); face.scale.set(0.8, 1, 1.05); bones.add(face);
  for (const z of [-0.022, 0.022]) {
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.003, 8, 20), xBone);
    orbit.position.copy(skullC).add(V(0.072, 0.0, z)); orbit.rotation.y = Math.PI / 2; bones.add(orbit);
  }
  placeRod(bone(0.006, 0.006), skullC.clone().add(V(0.05, -0.075, -0.03)), skullC.clone().add(V(0.0, -0.09, 0.0)));
  placeRod(bone(0.006, 0.006), skullC.clone().add(V(0.05, -0.075, 0.03)), skullC.clone().add(V(0.0, -0.09, 0.0)));
  for (let i = 0; i < 6; i++) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), xBone);
    v.position.copy(skullC).add(V(-0.05 - i * 0.022, -0.06 - i * 0.012, -0.01));
    v.rotation.z = Math.PI / 2 - 0.5; bones.add(v);
  }
  bones.traverse((o) => { if (o.isMesh) o.userData.xrayMat = xBone; });
  xray.internal(bones);

  const base = [V(-0.168, -0.06, 0.026), V(-0.13, -0.064, 0.018), V(-0.108, -0.066, 0.008), V(-0.094, -0.071, 0.001)];
  function setFinger(p) {
    const pts = base.map((b) => b.clone());
    pts[1].y -= 0.0015 * p; pts[1].x -= 0.001 * p;
    pts[2].x -= 0.0035 * p; pts[2].y -= 0.0015 * p;
    pts[3].x -= 0.0062 * p; pts[3].y += 0.0005 * p;
    for (let i = 0; i < 3; i++) { placeRod(idxGlove[i], pts[i], pts[i + 1]); placeRod(idxBones[i], pts[i], pts[i + 1]); }
    joints.forEach((j, i) => j.position.copy(pts[i]));
  }
  setFinger(0);

  return { body, strands: sMesh, hand, bones, bag, setFinger, headC };
}
