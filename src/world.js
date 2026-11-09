import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm, noise2, clamp, smoothstep, lerp, canvasTexture } from './utils.js';

export const WIND = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
};

// Injects coherent world-space wind sway into an instanced MeshStandardMaterial.
// Geometry must provide an `aH` attribute (0 at root, 1 at tip).
export function addWind(material, amp = 0.12, darken = [0.35, 1.1]) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
        attribute float aH; varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vH = aH;
        #ifdef USE_INSTANCING
          mat3 wIm = mat3(instanceMatrix);
          vec3 ip = instanceMatrix[3].xyz;
        #else
          mat3 wIm = mat3(1.0);
          vec3 ip = vec3(0.0);
        #endif
        vec4 wp = modelMatrix * vec4(ip, 1.0);
        float ph = uTime * 1.9 + dot(wp.xz, vec2(0.21, 0.17));
        float gust = 0.5 + 0.5 * sin(uTime * 0.55 + wp.x * 0.045 + wp.z * 0.06);
        float sway = (sin(ph) * 0.45 + sin(ph * 2.63 + 1.3) * 0.18 + 0.35) * uWind * (0.35 + gust);
        vec3 wdir = vec3(uWindDir.x, 0.0, uWindDir.y);
        vec3 wl = inverse(wIm) * wdir;
        float k = aH * aH;
        transformed += wl * sway * k * ${amp.toFixed(3)};
        transformed.y -= k * sway * sway * ${(amp * 0.25).toFixed(3)} / max(length(wIm[1]), 1e-4);
      `);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(${darken[0].toFixed(2)}, ${darken[1].toFixed(2)}, vH);`);
  };
  material.customProgramCacheKey = () => 'wind' + amp + darken.join(',');
  return material;
}

const SIZE = 3000, SEGS = 500;
const CELL = SIZE / SEGS;

function corridorProfile(z) {
  const ridge = 4.0 * Math.exp(-(((z - 4) / 38) ** 2));
  const meadow = 2.4 * Math.exp(-(((z + 300) / 55) ** 2));
  const back = 20 * smoothstep(-330, -560, z);
  const behind = 10 * smoothstep(40, 220, z);
  return ridge + meadow + back + behind;
}

export function terrainHeight(x, z) {
  const cx = Math.abs(x + z * 0.02);
  const w = 1 - smoothstep(35, 150, cx);
  const big = fbm(x * 0.0032 + 3.1, z * 0.0032 - 1.7, 5) * 34 + 6 + smoothstep(50, 320, cx) * 22;
  const small = fbm(x * 0.035, z * 0.035, 3) * 0.5 + fbm(x * 0.008, z * 0.008, 2) * 1.5;
  return lerp(big, corridorProfile(z) + small, w);
}

export function buildWorld(scene, renderer, { quality = 'high' } = {}) {
  const rng = mulberry32(42);
  const lowQ = quality === 'low';

  // ---------- sun / sky ----------
  const sunDir = new THREE.Vector3(0.78, 0.15, 0.42).normalize();
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const su = sky.material.uniforms;
  su.turbidity.value = 7.5;
  su.rayleigh.value = 2.2;
  su.mieCoefficient.value = 0.006;
  su.mieDirectionalG.value = 0.86;
  su.cloudCoverage.value = 0.32;
  su.cloudDensity.value = 0.5;
  su.cloudElevation.value = 0.55;
  su.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  scene.add(sky);

  // environment map from the sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envSky.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
  envSky.material.uniforms.cloudCoverage.value = 0.0;
  envScene.add(envSky);
  const envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  envSky.geometry.dispose();

  const fogColor = new THREE.Color().setRGB(0.42, 0.36, 0.33);
  scene.fog = new THREE.FogExp2(fogColor, 0.0016);

  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.72, 0.46), 4.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowQ ? 1024 : 2048, lowQ ? 1024 : 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.45, 0.55, 0.8), new THREE.Color().setRGB(0.3, 0.22, 0.13), 1.0);
  scene.add(hemi);

  function setShadowFocus(center, size = 6) {
    const s = size;
    sun.position.copy(center).addScaledVector(sunDir, 200);
    sun.target.position.copy(center);
    const c = sun.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 100; c.far = 300;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.00005 * s;
    sun.shadow.normalBias = 0.002 * s;
  }

  // ---------- terrain ----------
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const heights = new Float32Array(pos.count);
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color().setRGB(0.36, 0.33, 0.13);
  const cB = new THREE.Color().setRGB(0.52, 0.42, 0.2);
  const cC = new THREE.Color().setRGB(0.2, 0.24, 0.08);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    heights[i] = h;
    pos.setY(i, h);
    const n = fbm(x * 0.012 + 11, z * 0.012 - 4, 3) * 0.5 + 0.5;
    const m = fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
    tmp.copy(cA).lerp(cB, clamp(n * 1.3 - 0.15)).lerp(cC, clamp((m - 0.6) * 2.5) * 0.6);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const groundTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#8a8a7a'; g.fillRect(0, 0, w, h);
    const r = mulberry32(7);
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, l = 4 + r() * 14, a = r() * Math.PI;
      const v = 90 + r() * 110;
      g.strokeStyle = `rgba(${v + 20},${v + 10},${v * 0.6},${0.25 + r() * 0.35})`;
      g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 1400; i++) {
      const v = 40 + r() * 60;
      g.fillStyle = `rgba(${v},${v * 0.85},${v * 0.6},0.5)`;
      g.beginPath(); g.arc(r() * w, r() * h, 0.5 + r() * 2, 0, 7); g.fill();
    }
  }, { repeat: true });
  groundTex.repeat.set(SIZE / 3, SIZE / 3);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Height exactly matching the rendered triangles (PlaneGeometry diagonal b-d).
  function groundY(x, z) {
    const gx = (x + SIZE / 2) / CELL, gz = (z + SIZE / 2) / CELL;
    const ix = clamp(Math.floor(gx), 0, SEGS - 1), iz = clamp(Math.floor(gz), 0, SEGS - 1);
    const fx = gx - ix, fz = gz - iz;
    const W = SEGS + 1;
    const ha = heights[ix + W * iz], hb = heights[ix + W * (iz + 1)];
    const hc = heights[ix + 1 + W * (iz + 1)], hd = heights[ix + 1 + W * iz];
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  // ---------- key positions ----------
  const shooterPos = new THREE.Vector3(0, groundY(0, 0), 0);
  const stumpPos = new THREE.Vector3(6, 0, -300);
  stumpPos.y = groundY(stumpPos.x, stumpPos.z);
  const yaw = Math.atan2(-(stumpPos.x - shooterPos.x), -(stumpPos.z - shooterPos.z)); // rotation about Y so local -Z faces target
  const fwd2 = new THREE.Vector2(stumpPos.x - shooterPos.x, stumpPos.z - shooterPos.z).normalize();

  // ---------- grass ----------
  const grassMat = addWind(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, metalness: 0 }), 0.11);
  const clumpGeo = grassClump(mulberry32(3), 5);
  const grassPalette = [
    new THREE.Color().setRGB(0.42, 0.42, 0.13), new THREE.Color().setRGB(0.62, 0.5, 0.22),
    new THREE.Color().setRGB(0.55, 0.45, 0.24), new THREE.Color().setRGB(0.3, 0.36, 0.1),
    new THREE.Color().setRGB(0.7, 0.58, 0.3),
  ];
  const toLocal = (x, z) => {
    const dx = x - shooterPos.x, dz = z - shooterPos.z;
    return [dx * fwd2.x + dz * fwd2.y, dx * -fwd2.y + dz * fwd2.x]; // [forward, right]
  };
  function grassPatch(count, sampler, heightFn) {
    const mesh = new THREE.InstancedMesh(clumpGeo, grassMat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0, guard = 0;
    while (n < count && guard++ < count * 6) {
      const [x, z] = sampler();
      const hgt = heightFn(x, z);
      if (hgt <= 0) continue;
      p.set(x, groundY(x, z) - 0.02, z);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      const w = 0.8 + rng() * 0.6;
      s.set(w, hgt * (0.7 + rng() * 0.6), w);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      const c = grassPalette[Math.floor(rng() * grassPalette.length)].clone();
      const v = fbm(x * 0.08, z * 0.08, 2);
      c.lerp(grassPalette[1], clamp(v + 0.3)).multiplyScalar(0.8 + rng() * 0.35);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
  const q = lowQ ? 0.45 : 1;
  const disc = (cx, cz, r) => () => { const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r; return [cx + Math.cos(a) * d, cz + Math.sin(a) * d]; };
  // shooter hill
  grassPatch(Math.floor(26000 * q), disc(0, 0, 26), (x, z) => {
    const [f, r] = toLocal(x, z);
    if (f > -2.1 && f < 0.6 && r > -0.75 && r < 0.55) return 0; // under the sniper
    if (f > 0.3 && f < 9 && Math.abs(r) < 0.45 + f * 0.04) return 0; // muzzle lane
    const d = Math.hypot(f, r);
    return lerp(0.18, 0.55, smoothstep(1.5, 6, d));
  });
  // target meadow
  grassPatch(Math.floor(20000 * q), disc(stumpPos.x, stumpPos.z, 22), (x, z) => {
    const d = Math.hypot(x - stumpPos.x, z - stumpPos.z);
    if (d < 0.22) return 0;
    return lerp(0.22, 0.5, smoothstep(0.4, 4, d));
  });
  // corridor between
  grassPatch(Math.floor(26000 * q), () => { const z = -rng() * 300; return [lerp(-16, 16, rng()) - z * 0.02, z]; }, (x, z) => (z < -20 && z > -282 ? 0.5 : 0));
  // behind the target: backdrop for the scope view
  grassPatch(Math.floor(14000 * q), () => { const z = lerp(-322, -400, rng()); return [lerp(-14, 14, rng()) - z * 0.02, z]; }, () => 0.62);

  // ---------- trees ----------
  const trees = buildTrees(rng);
  const treesHi = buildTrees(mulberry32(4), 3);
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const placeTrees = (geoT, count, sampler) => {
    const mesh = new THREE.InstancedMesh(geoT, treeMat, count);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0, guard = 0;
    while (n < count && guard++ < count * 20) {
      const pt = sampler();
      if (!pt) continue;
      const [x, z, sc] = pt;
      p.set(x, groundY(x, z) - 0.3, z);
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      const k = sc * (0.75 + rng() * 0.5);
      s.set(k, k * (0.85 + rng() * 0.35), k);
      m.compose(p, qq, s);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  };
  const treeSampler = () => {
    const pick = rng();
    let x, z;
    if (pick < 0.45) { // tree line behind the target
      x = lerp(-320, 320, rng()); z = lerp(-370, -470, rng()) - Math.abs(x) * 0.15;
    } else if (pick < 0.8) { // valley flanks
      const side = rng() < 0.5 ? -1 : 1;
      z = lerp(-340, 120, rng()); x = side * lerp(55, 300, Math.pow(rng(), 0.7)) - z * 0.02;
    } else { // far scatter
      const a = rng() * Math.PI * 2, d = lerp(250, 900, rng());
      x = Math.cos(a) * d; z = Math.sin(a) * d - 150;
    }
    const cx = Math.abs(x + z * 0.02);
    if (cx < 45 && z > -360) return null;
    if (Math.hypot(x, z) < 40) return null;
    return [x, z, 1];
  };
  placeTrees(trees.broad, lowQ ? 350 : 700, treeSampler);
  placeTrees(trees.pine, lowQ ? 250 : 500, treeSampler);
  // a few close trees framing the target
  placeTrees(treesHi.broad, 6, (() => {
    const pts = [[-14, -318], [22, -326], [-28, -306], [35, -296], [12, -340], [-6, -336]];
    let i = 0; return () => { const p = pts[i++ % pts.length]; return [p[0] + stumpPos.x, p[1], 1.05]; };
  })());

  // ---------- target stump ----------
  const stump = buildStump(rng);
  stump.group.position.copy(stumpPos).y -= 0.05;
  scene.add(stump.group);
  const stumpTop = stumpPos.y - 0.05 + stump.height;

  // ---------- rocks ----------
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c5850, roughness: 0.95, flatShading: false });
  const rockSpots = [[-2.4, -1.6, 0.35], [3.1, 1.2, 0.5], [1.6, -6.5, 0.28], [-4, 3.5, 0.6]];
  for (const [x, z, r] of rockSpots) {
    const g = new THREE.IcosahedronGeometry(r, 4);
    const pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pp, i);
      const k = 1 + noise2(v.x * 3 / r * 0.3 + x, v.y * 3 / r * 0.3 + v.z * 2) * 0.35 + noise2(v.x * 9 / r * 0.3, v.z * 9 / r * 0.3 + v.y) * 0.08;
      v.multiplyScalar(k); v.y *= 0.55;
      pp.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const rock = new THREE.Mesh(g, rockMat);
    rock.position.set(x, groundY(x, z) - r * 0.18, z);
    rock.rotation.y = rng() * 6;
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
  }

  return {
    sky, sun, hemi, sunDir, groundY, setShadowFocus, shooterPos, stumpPos, stumpTop, yaw, fwd2, stump,
    update(simDt) {
      WIND.uTime.value += simDt;
      su.time.value += simDt;
    },
  };
}

function grassClump(r, blades) {
  const P = [], N = [], H = [], I = [];
  let base = 0;
  for (let b = 0; b < blades; b++) {
    const ang = r() * Math.PI * 2;
    const ox = (r() - 0.5) * 0.14, oz = (r() - 0.5) * 0.14;
    const wdt = 0.012 + r() * 0.012;
    const hgt = 0.7 + r() * 0.3;
    const lean = (r() - 0.3) * 0.35;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rows = [0, 0.35, 0.7];
    for (const t of rows) {
      const half = wdt * (1 - t * 0.75) * 0.5;
      const bend = lean * t * t;
      for (const sd of [-1, 1]) {
        const lx = sd * half, lz = bend;
        P.push(ox + lx * ca - lz * sa, t * hgt, oz + lx * sa + lz * ca);
        N.push(-sa * 0.35, 0.94, ca * 0.35);
        H.push(t);
      }
    }
    P.push(ox - lean * sa, hgt, oz + lean * ca); N.push(0, 1, 0); H.push(1);
    for (let k = 0; k < 2; k++) {
      const a = base + k * 2;
      I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    I.push(base + 4, base + 5, base + 6);
    base += 7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setIndex(I);
  return g;
}

function colorize(g, color) {
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) { c[i] = color.r; c[i + 1] = color.g; c[i + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function blob(r, radius, detail, cx, cy, cz, color, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + noise2(v.x * 0.9 + seed, v.z * 0.9 + v.y * 0.7) * 0.45 + noise2(v.x * 3.1 - seed, v.y * 3.1 + v.z * 2.3) * 0.12;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
    const shade = 0.6 + 0.5 * clamp((v.y / radius) * 0.5 + 0.5);
    c[i * 3] = color.r * shade; c[i * 3 + 1] = color.g * shade; c[i * 3 + 2] = color.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}

function buildTrees(r, detail = 1) {
  const trunkC = new THREE.Color().setRGB(0.16, 0.11, 0.07);
  const leaf = new THREE.Color().setRGB(0.12, 0.17, 0.05);
  const trunk = colorize(new THREE.CylinderGeometry(0.22, 0.38, 6, 6).translate(0, 3, 0).toNonIndexed(), trunkC);
  trunk.deleteAttribute('uv');
  const parts = [trunk];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(blob(r, 2.2 + r() * 1.2, detail, Math.cos(a) * 1.6, 6.5 + r() * 2.5, Math.sin(a) * 1.6, leaf.clone().offsetHSL(0, 0, (r() - 0.5) * 0.04), i * 3.7));
  }
  parts.push(blob(r, 2.6, detail, 0, 9.2, 0, leaf, 9));
  const broad = mergeGeometries(parts.map((g) => { g.computeVertexNormals(); return g; }));

  const pineC = new THREE.Color().setRGB(0.07, 0.11, 0.06);
  const pparts = [colorize(new THREE.CylinderGeometry(0.15, 0.3, 4, 6).translate(0, 2, 0).toNonIndexed(), trunkC)];
  pparts[0].deleteAttribute('uv');
  for (let i = 0; i < 5; i++) {
    const h = 2.4 + i * 2.1, rad = 3.0 - i * 0.5;
    const cone = colorize(new THREE.ConeGeometry(rad, 3.6, 8).translate(0, h + 1.5, 0).toNonIndexed(), pineC.clone().offsetHSL(0, 0, i * 0.008));
    cone.deleteAttribute('uv');
    pparts.push(cone);
  }
  const pine = mergeGeometries(pparts.map((g) => { g.computeVertexNormals(); return g; }));
  return { broad, pine };
}

function buildStump(r) {
  const group = new THREE.Group();
  const height = 0.86;
  const barkTex = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#4a3a2c'; g.fillRect(0, 0, w, h);
    const rr = mulberry32(11);
    for (let i = 0; i < 260; i++) {
      const x = rr() * w; const v = 30 + rr() * 60;
      g.strokeStyle = `rgba(${v},${v * 0.8},${v * 0.6},0.8)`;
      g.lineWidth = 1 + rr() * 4;
      g.beginPath(); g.moveTo(x, 0);
      let cx = x;
      for (let y = 0; y <= h; y += 20) { cx += (rr() - 0.5) * 6; g.lineTo(cx, y); }
      g.stroke();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${100 + rr() * 60},${110 + rr() * 50},${80},${0.15 + rr() * 0.2})`;
      g.fillRect(rr() * w, rr() * h, 2 + rr() * 8, 1 + rr() * 3);
    }
  });
  const ringTex = canvasTexture(512, 512, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#b08a5e'; g.fillRect(0, 0, w, w);
    for (let i = 60; i > 0; i--) {
      const rad = (i / 60) * c * 0.98;
      g.strokeStyle = i % 2 ? 'rgba(110,75,45,0.55)' : 'rgba(170,130,85,0.4)';
      g.lineWidth = 1.5 + (i % 3);
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
        const rr2 = rad * (1 + noise2(Math.cos(a) * 2 + i * 0.1, Math.sin(a) * 2) * 0.06);
        const x = c + Math.cos(a) * rr2, y = c + Math.sin(a) * rr2;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    const rr = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const a = rr() * 6.28;
      g.strokeStyle = 'rgba(60,40,25,0.7)'; g.lineWidth = 1 + rr() * 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.15, c + Math.sin(a) * c * 0.15);
      g.lineTo(c + Math.cos(a) * c * (0.5 + rr() * 0.5), c + Math.sin(a) * c * (0.5 + rr() * 0.5)); g.stroke();
    }
    g.fillStyle = 'rgba(70,45,25,0.9)';
    g.beginPath(); g.arc(c, c, 6, 0, 7); g.fill();
  });
  const body = new THREE.CylinderGeometry(0.13, 0.17, height, 40, 12, true);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + noise2(Math.cos(a) * 3, y * 4) * 0.06 + Math.sin(a * 14) * 0.012 + smoothstep(0.0, -height / 2, y) * (0.1 + 0.08 * Math.sin(a * 5));
    p.setXYZ(i, x * k, y, z * k);
  }
  body.computeVertexNormals();
  body.translate(0, height / 2, 0);
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 }));
  bodyMesh.castShadow = bodyMesh.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.135, 40).rotateX(-Math.PI / 2).translate(0, height, 0),
    new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.8 }));
  top.receiveShadow = true;
  group.add(bodyMesh, top);
  return { group, height };
}
