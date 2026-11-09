import * as THREE from 'three';
import { xrayMaterial } from './xray.js';
import { canvasTexture, mulberry32 } from './utils.js';

// Rifle-local frame: +X toward the muzzle, +Y up, +Z to the shooter's right. Units are meters.
export const RIFLE = {
  muzzleX: 0.755,
  scopeY: 0.058,
  eye: new THREE.Vector3(-0.33, 0.058, 0),
  caseBaseX: -0.04,
  bulletBaseX: -0.001,
  boreHeight: 0.33,
};

const X_AXIS_ROT = (g) => g.rotateZ(-Math.PI / 2);

function cylX(r0, r1, x0, x1, mat, seg = 32, open = false) {
  const g = X_AXIS_ROT(new THREE.CylinderGeometry(r1, r0, x1 - x0, seg, 1, open));
  g.translate((x0 + x1) / 2, 0, 0);
  return new THREE.Mesh(g, mat);
}
function latheX(points, mat, seg = 40) {
  const g = X_AXIS_ROT(new THREE.LatheGeometry(points.map(([r, x]) => new THREE.Vector2(r, x)), seg));
  return new THREE.Mesh(g, mat);
}
function box(x0, x1, y0, y1, z0, z1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return m;
}
export function rod(a, b, r0, r1, mat, seg = 16) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
function extrude(points, depth, mat, bevel = 0.004) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function bulletProfile() {
  const R = 0.0039, pts = [[0, 0], [0.0031, 0], [0.0036, 0.0006], [R, 0.0045], [R, 0.0135]];
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    pts.push([Math.max(R * Math.pow(1 - Math.pow(t, 1.9), 0.72), 0.0004), 0.0135 + t * 0.0175]);
  }
  pts.push([0, 0.031]);
  return pts;
}
export function caseProfile() {
  return [[0, 0], [0.0060, 0], [0.0060, 0.0013], [0.0051, 0.0017], [0.0051, 0.0029], [0.0059, 0.0036],
    [0.0057, 0.039], [0.0043, 0.0436], [0.0043, 0.0512], [0.0039, 0.0512], [0.0039, 0.046], [0.0052, 0.040], [0.0052, 0.004], [0, 0.004]];
}

export function makeGlowTexture(inner = [255, 255, 240], outer = [255, 120, 20]) {
  return canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, `rgba(${inner},1)`);
    grd.addColorStop(0.25, `rgba(${outer},0.75)`);
    grd.addColorStop(0.6, `rgba(${outer},0.18)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

export function buildRifle() {
  const group = new THREE.Group();
  group.name = 'rifle';

  const metal = new THREE.MeshStandardMaterial({ color: 0x1d1e20, metalness: 0.85, roughness: 0.36 });
  const metalSatin = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.9, roughness: 0.28 });
  const steelBright = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.18 });
  const black = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.2, roughness: 0.9 });
  const stockTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#6b5d44'; g.fillRect(0, 0, w, h);
    const r = mulberry32(21);
    for (let i = 0; i < 5000; i++) { const v = r() * 30 - 15; g.fillStyle = `rgba(${107 + v},${93 + v},${68 + v},0.6)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  }, { repeat: true });
  stockTex.repeat.set(12, 12);
  const stockMat = new THREE.MeshStandardMaterial({ map: stockTex, roughness: 0.78, metalness: 0.02 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    iridescence: 1, iridescenceIOR: 1.7, envMapIntensity: 2.2,
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8ad55, metalness: 1, roughness: 0.22 });
  const white = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, emissive: 0x222222 });

  const X = {
    metal: xrayMaterial({ color: 0x8cc8ff, base: 0.015, rim: 0.42, power: 2.4 }),
    stock: xrayMaterial({ color: 0x6aa0d8, base: 0.006, rim: 0.2, power: 2.2 }),
    glass: xrayMaterial({ color: 0xa6d2ff, base: 0.0, rim: 0.12, power: 2 }),
    inner: xrayMaterial({ color: 0xd8f0ff, base: 0.12, rim: 1.1, power: 1.6, intensity: 1.3 }),
    brass: xrayMaterial({ color: 0xffd79a, base: 0.1, rim: 1.0, power: 1.7, intensity: 1.2 }),
    bore: xrayMaterial({ color: 0x9fd8ff, base: 0.02, rim: 0.5, power: 3 }),
  };
  const tagX = (m, mat) => { m.userData.xrayMat = mat; return m; };
  const add = (m, xmat = X.metal, parent = group) => { tagX(m, xmat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // ---- barrel + brake ----
  add(cylX(0.0125, 0.0098, 0.06, 0.68, metal, 40));
  add(cylX(0.0135, 0.0135, 0.68, 0.755, metalSatin, 32));
  for (const z of [-1, 1]) for (let i = 0; i < 3; i++) {
    add(box(0.688 + i * 0.022, 0.698 + i * 0.022, -0.009, 0.009, -0.0014, 0.0014, black)).position.z = z * 0.0127;
  }
  add(cylX(0.006, 0.006, 0.754, 0.7562, black, 24));

  // ---- receiver, rail, bottom metal ----
  add(cylX(0.0175, 0.0175, -0.165, 0.06, metal, 40));
  add(box(-0.155, 0.055, -0.024, -0.01, -0.0165, 0.0165, metal));
  add(box(-0.05, 0.022, -0.007, 0.009, 0.0170, 0.0182, black));
  add(box(-0.175, 0.075, 0.0168, 0.0262, -0.0105, 0.0105, metal));
  for (let i = 0; i < 22; i++) add(box(-0.17 + i * 0.0112, -0.164 + i * 0.0112, 0.026, 0.0298, -0.0105, 0.0105, metal));

  // ---- bolt (lift about X, slide along -X) ----
  const bolt = new THREE.Group();
  group.add(bolt);
  add(cylX(0.0095, 0.0095, -0.165, -0.04, steelBright, 28), X.inner, bolt);
  add(cylX(0.0125, 0.0118, -0.218, -0.165, metal, 28), X.metal, bolt);
  add(cylX(0.006, 0.006, -0.226, -0.218, metalSatin, 20), X.metal, bolt);
  const hA = new THREE.Vector3(-0.152, 0, 0.008), hB = new THREE.Vector3(-0.166, -0.032, 0.062);
  add(rod(hA, hB, 0.0042, 0.0036, metal), X.metal, bolt);
  const knob = add(new THREE.Mesh(new THREE.SphereGeometry(0.0115, 24, 16), metalSatin), X.metal, bolt);
  knob.position.copy(hB); knob.scale.set(1, 0.92, 1.12);

  // ---- scope ----
  const sy = RIFLE.scopeY;
  const scope = new THREE.Group();
  scope.position.y = sy;
  group.add(scope);
  const sAdd = (m, xm = X.metal) => add(m, xm, scope);
  sAdd(cylX(0.017, 0.017, -0.15, 0.17, metal, 40));
  sAdd(cylX(0.017, 0.028, 0.17, 0.215, metal, 40));
  sAdd(cylX(0.028, 0.028, 0.215, 0.272, metal, 40));
  sAdd(cylX(0.0292, 0.0292, 0.266, 0.279, metalSatin, 40));
  sAdd(cylX(0.017, 0.021, -0.175, -0.15, metal, 40));
  sAdd(cylX(0.0215, 0.0215, -0.17, -0.153, metalSatin, 36));
  sAdd(box(-0.166, -0.158, 0.019, 0.03, -0.003, 0.003, metal));
  sAdd(cylX(0.021, 0.022, -0.245, -0.175, metal, 40));
  sAdd(cylX(0.0228, 0.0228, -0.245, -0.232, rubber, 40));
  const lensO = new THREE.Mesh(new THREE.CircleGeometry(0.026, 48).rotateY(Math.PI / 2), glass);
  lensO.position.x = 0.273; sAdd(lensO, X.glass);
  const lensE = new THREE.Mesh(new THREE.CircleGeometry(0.019, 48).rotateY(-Math.PI / 2), glass);
  lensE.position.x = -0.243; sAdd(lensE, X.glass);
  sAdd(cylX(0.0198, 0.0198, -0.028, 0.048, metal, 40));
  // elevation turret
  const turret = new THREE.Group();
  turret.position.set(0.01, 0.0195, 0);
  scope.add(turret);
  const tCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.024, 36), metalSatin);
  tCyl.position.y = 0.012; add(tCyl, X.metal, turret);
  const tCap = new THREE.Mesh(new THREE.CylinderGeometry(0.0168, 0.0168, 0.006, 36), metal);
  tCap.position.y = 0.0255; add(tCap, X.metal, turret);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const mk = new THREE.Mesh(new THREE.BoxGeometry(0.0008, i % 5 === 0 ? 0.008 : 0.004, 0.0008), white);
    mk.position.set(Math.cos(a) * 0.0167, 0.008 + (i % 5 === 0 ? 0.004 : 0.002), Math.sin(a) * 0.0167);
    add(mk, X.metal, turret);
  }
  const wind = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.022, 32).rotateX(Math.PI / 2), metalSatin);
  wind.position.set(0.01, 0, 0.03); sAdd(wind);
  const para = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 36).rotateX(Math.PI / 2), metalSatin);
  para.position.set(0.01, 0, -0.026); sAdd(para);
  // rings + bases
  for (const x of [-0.085, 0.11]) {
    add(cylX(0.0208, 0.0208, x - 0.008, x + 0.008, metal, 36));
    add(box(x - 0.008, x + 0.008, 0.026, sy - 0.012, -0.0115, 0.0115, metal));
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.05, 12).rotateX(Math.PI / 2), metalSatin);
    screw.position.set(x, sy - 0.019, 0); add(screw);
  }

  // ---- stock ----
  const stock = add(extrude([
    [0.06, -0.016], [-0.17, -0.016], [-0.28, -0.009], [-0.30, 0.026], [-0.47, 0.03], [-0.497, 0.034],
    [-0.5, -0.135], [-0.46, -0.14], [-0.31, -0.086], [-0.24, -0.077], [-0.222, -0.156], [-0.175, -0.162],
    [-0.148, -0.062], [-0.135, -0.05], [0.02, -0.05], [0.06, -0.04],
  ], 0.042, stockMat, 0.005), X.stock);
  stock.name = 'stock';
  add(extrude([[-0.497, 0.036], [-0.512, 0.036], [-0.516, -0.138], [-0.501, -0.138]], 0.046, rubber, 0.003), X.stock);
  add(extrude([[0.055, -0.013], [0.405, -0.013], [0.414, -0.028], [0.405, -0.06], [0.055, -0.06]], 0.052, stockMat, 0.005), X.stock);
  for (const z of [-1, 1]) for (let i = 0; i < 4; i++) {
    add(box(0.12 + i * 0.065, 0.152 + i * 0.065, -0.044, -0.034, -0.0012, 0.0012, black)).position.z = z * 0.0315;
  }
  const knurl = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 18).rotateX(Math.PI / 2), metalSatin);
  knurl.position.set(-0.38, 0.0, -0.031); add(knurl);

  // ---- magazine, trigger guard, trigger ----
  add(box(-0.046, 0.03, -0.112, -0.03, -0.0155, 0.0155, metal));
  add(box(-0.05, 0.034, -0.12, -0.11, -0.017, 0.017, metalSatin));
  const guardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.142, -0.056, 0), new THREE.Vector3(-0.134, -0.086, 0), new THREE.Vector3(-0.09, -0.092, 0),
    new THREE.Vector3(-0.058, -0.078, 0), new THREE.Vector3(-0.052, -0.052, 0),
  ]);
  const guard = add(new THREE.Mesh(new THREE.TubeGeometry(guardCurve, 40, 0.0034, 10), metal));
  guard.scale.z = 2.2;
  const trigger = new THREE.Group();
  trigger.position.set(-0.086, -0.05, 0);
  group.add(trigger);
  const tCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.002, -0.013, 0), new THREE.Vector3(-0.009, -0.026, 0)]);
  const tBlade = add(new THREE.Mesh(new THREE.TubeGeometry(tCurve, 16, 0.0026, 8), steelBright), X.inner, trigger);
  tBlade.scale.z = 1.6;

  // ---- bipod ----
  add(box(0.33, 0.36, -0.076, -0.058, -0.016, 0.016, metal));
  const legs = [];
  for (const z of [-1, 1]) {
    const top = new THREE.Vector3(0.345, -0.07, z * 0.012), foot = new THREE.Vector3(0.39, -RIFLE.boreHeight + 0.008, z * 0.088);
    const mid = top.clone().lerp(foot, 0.55);
    legs.push(add(rod(top, mid, 0.0068, 0.0068, metal)));
    legs.push(add(rod(mid, foot, 0.0052, 0.0052, metalSatin)));
    const ft = add(new THREE.Mesh(new THREE.SphereGeometry(0.0095, 16, 12), rubber));
    ft.position.copy(foot);
  }

  // ---- anchors ----
  const muzzle = new THREE.Object3D(); muzzle.position.set(RIFLE.muzzleX, 0, 0); group.add(muzzle);
  const port = new THREE.Object3D(); port.position.set(-0.012, 0.004, 0.02); group.add(port);
  const eye = new THREE.Object3D(); eye.position.copy(RIFLE.eye); group.add(eye);

  // ---- internals (x-ray only) ----
  const internals = new THREE.Group();
  group.add(internals);
  const caseMesh = latheX(caseProfile(), brass, 40);
  caseMesh.position.x = RIFLE.caseBaseX;
  tagX(caseMesh, X.brass);
  internals.add(caseMesh);
  const primer = cylX(0.0027, 0.0027, RIFLE.caseBaseX - 0.0002, RIFLE.caseBaseX + 0.0012, brass, 20);
  tagX(primer, X.inner); internals.add(primer);
  const bore = cylX(0.0040, 0.0040, 0.011, RIFLE.muzzleX, metal, 24, true);
  tagX(bore, X.bore); internals.add(bore);
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, x = 0.02 + t * (RIFLE.muzzleX - 0.02);
      const a = (x / 0.254) * Math.PI * 2 + (k * Math.PI) / 2;
      pts.push(new THREE.Vector3(x, Math.sin(a) * 0.0041, Math.cos(a) * 0.0041));
    }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.00035, 4), metal);
    tagX(m, X.inner); internals.add(m);
  }
  const pin = new THREE.Group();
  internals.add(pin);
  const pinRod = cylX(0.0021, 0.0016, -0.2, RIFLE.caseBaseX - 0.0006, steelBright, 12);
  tagX(pinRod, X.inner); pin.add(pinRod);
  const pinHead = cylX(0.0055, 0.0055, -0.205, -0.196, steelBright, 16);
  tagX(pinHead, X.inner); pin.add(pinHead);
  const pinCollar = cylX(0.0058, 0.0058, -0.073, -0.07, steelBright, 16);
  tagX(pinCollar, X.inner); pin.add(pinCollar);
  const springPts = [];
  for (let i = 0; i <= 600; i++) {
    const t = i / 600, a = t * Math.PI * 2 * 16;
    springPts.push(new THREE.Vector3(t, Math.sin(a) * 0.0058, Math.cos(a) * 0.0058));
  }
  const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPts), 1200, 0.0007, 5), steelBright);
  tagX(spring, X.inner);
  spring.position.x = -0.192;
  internals.add(spring);
  const sear = box(-0.115, -0.09, -0.03, -0.018, -0.004, 0.004, steelBright);
  tagX(sear, X.inner); internals.add(sear);
  const searY = sear.position.y;
  const searLink = box(-0.095, -0.084, -0.05, -0.028, -0.003, 0.003, steelBright);
  tagX(searLink, X.inner); internals.add(searLink);

  const grains = new THREE.Points(
    (() => {
      const g = new THREE.BufferGeometry(); const arr = []; const r = mulberry32(8);
      for (let i = 0; i < 220; i++) {
        const a = r() * 6.28, rad = Math.sqrt(r()) * 0.0048;
        arr.push(RIFLE.caseBaseX + 0.005 + r() * 0.034, Math.sin(a) * rad, Math.cos(a) * rad);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return g;
    })(),
    new THREE.PointsMaterial({ color: 0xffc070, size: 2.2, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  grains.userData.noXray = true;
  internals.add(grains);

  // gas glow (crossed planes along X, anchored at x=0)
  const glowTex = makeGlowTexture([255, 250, 220], [255, 140, 40]);
  const gasMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(3, 2, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const gas = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), gasMat);
    pl.rotation.x = (i / 3) * Math.PI;
    pl.userData.noXray = true;
    gas.add(pl);
  }
  gas.visible = false;
  internals.add(gas);
  const primerFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(6, 5, 4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  primerFlash.position.x = RIFLE.caseBaseX + 0.002;
  primerFlash.scale.setScalar(0.0001);
  primerFlash.userData.noXray = true;
  internals.add(primerFlash);

  const api = {
    group, bolt, trigger, turret, muzzle, port, eye, internals, caseMesh, legs, materials: { brass, metal },
    setTrigger(p) { trigger.rotation.z = -0.32 * p; sear.position.y = searY - 0.006 * p; searLink.rotation.z = 0.1 * p; },
    // Mainspring runs from the fixed shroud seat (x=-0.19) to the moving pin collar.
    setPin(p) {
      const off = -0.0065 * (1 - p);
      pin.position.x = off;
      spring.position.x = -0.19;
      spring.scale.set(0.117 + off, 1, 1);
    },
    setPowder(burn, flash) {
      grains.material.opacity = Math.max(0, 1 - burn * 1.4);
      grains.material.color.setRGB(1, 0.75 + burn * 0.5, 0.45 + burn);
      grains.material.size = 2.2 + burn * 3;
      primerFlash.scale.setScalar(0.004 + flash * 0.03);
      primerFlash.visible = flash > 0.001;
    },
    setGas(x0, x1, intensity) {
      gas.visible = intensity > 0.001;
      gas.position.x = x0;
      gas.scale.set(Math.max(x1 - x0, 0.001) * 1.25, 0.012 + intensity * 0.004, 0.012 + intensity * 0.004);
      gasMat.color.setRGB(3 * intensity, 1.9 * intensity, 1.0 * intensity);
    },
    setBolt(lift, slide) { bolt.rotation.x = -lift * Math.PI * 0.46; bolt.position.x = -slide * 0.105; },
    setTurret(a) { turret.rotation.y = a; },
    xrayMats: X,
  };
  api.setPin(0);
  api.setPowder(0, 0);
  return api;
}
