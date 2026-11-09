import * as THREE from 'three';
import './style.css';
import { buildWorld } from './world.js';
import { buildRifle, RIFLE } from './rifle.js';
import { buildSniper } from './sniper.js';
import { buildApple, AppleBurst } from './apple.js';
import { buildBullet, BulletPath } from './bullet.js';
import { initTextures, TEX, Particles, MuzzleBlast, Casing, Motes } from './effects.js';
import { XRay } from './xray.js';
import { Sound } from './audio.js';
import { buildPost } from './post.js';
import { UI } from './ui.js';
import { Director } from './director.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') === 'low' ? 'low' : 'high';
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const playBtn = document.getElementById('play');
const startEl = document.getElementById('start');
const endEl = document.getElementById('end');

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('stage').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.002, 6000);

  initTextures();
  const world = buildWorld(scene, renderer, { quality });
  const xray = new XRay();

  // Shooter rig: X toward the target, Y up, Z to the shooter's right.
  const rig = new THREE.Group();
  rig.position.copy(world.shooterPos);
  const fwd = V3(world.fwd2.x, 0, world.fwd2.y), up = V3(0, 1, 0);
  rig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, up, new THREE.Vector3().crossVectors(fwd, up)));
  scene.add(rig);

  const rifle = buildRifle();
  rifle.group.position.y = RIFLE.boreHeight;
  rig.add(rifle.group);
  xray.register(rifle.group);
  xray.internal(rifle.internals);
  const sniper = buildSniper(rig, rifle, xray);

  const apple = buildApple(xray);
  apple.apple.geometry.computeBoundingBox();
  apple.group.position.set(world.stumpPos.x, world.stumpTop - apple.apple.geometry.boundingBox.min.y - 0.001, world.stumpPos.z);
  scene.add(apple.group);
  const A = apple.group.position.clone();

  // Aim: bore axis matches the trajectory tangent at the muzzle.
  const ARC = 0.16;
  let path;
  const rigInv = new THREE.Quaternion();
  for (let i = 0; i < 4; i++) {
    rig.updateMatrixWorld(true);
    path = new BulletPath(rifle.muzzle.getWorldPosition(V3()), A, ARC);
    const tl = path.T0.clone().applyQuaternion(rigInv.copy(rig.quaternion).invert());
    rifle.group.rotation.set(0, Math.atan2(-tl.z, tl.x), Math.asin(tl.y), 'YZX');
  }
  rig.updateMatrixWorld(true);
  path = new BulletPath(rifle.muzzle.getWorldPosition(V3()), A, ARC);
  const muzzleWorld = path.M.clone();

  const bullet = buildBullet(xray);
  scene.add(bullet.group);

  const smoke = new Particles({ max: 900, map: TEX.puff });
  const dust = new Particles({ max: 300, map: TEX.puff });
  const mist = new Particles({ max: 400, map: TEX.puff });
  const trail = new Particles({ max: 1600, map: TEX.dot });
  const fire = new Particles({ max: 200, map: TEX.glow, additive: true, intensity: 2 });
  for (const p of [smoke, dust, mist, trail, fire]) scene.add(p.mesh);
  const blast = new MuzzleBlast(scene, smoke, fire, dust);
  const casing = new Casing(scene, rifle.caseMesh.geometry, rifle.materials.brass);
  const burst = new AppleBurst(scene, apple, world.groundY, { center: world.stumpPos, top: world.stumpTop, radius: 0.13 });
  const motes = new Motes(scene);

  const audio = new Sound();
  const post = buildPost(renderer, scene, camera, { quality });
  post.setSize(window.innerWidth, window.innerHeight);
  const ui = new UI();

  const state = {};
  const resetState = () => Object.assign(state, {
    simTime: 0, ts: 1, bulletDist: RIFLE.bulletBaseX - RIFLE.muzzleX, bulletPhys: false, spinOverride: null, fireTime: 0, wisp: false, wispAcc: 0,
  });
  resetState();

  const rq = new THREE.Quaternion();
  const xrayBg = new THREE.Color(0x01040a), xrayFog = new THREE.Color(0x020812);
  const baseFog = scene.fog.color.clone(), baseSun = world.sun.intensity, baseHemi = world.hemi.intensity, baseEnv = scene.environmentIntensity;
  const c = {
    renderer, scene, camera, world, rig, rifle, sniper, apple, bullet, path, A, blast, smoke, dust, mist, trail, fire, casing, burst, motes,
    xray, audio, post, ui, state, muzzleWorld,
    R: (v) => rifle.group.localToWorld(v),
    G: (v) => rig.localToWorld(v),
    project(v) { const p = v.clone().project(camera); return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5 }; },
    muzzleFrame() {
      rifle.group.getWorldQuaternion(rq);
      return { pos: muzzleWorld.clone(), dir: V3(1, 0, 0).applyQuaternion(rq), up: V3(0, 1, 0).applyQuaternion(rq), right: V3(0, 0, 1).applyQuaternion(rq) };
    },
    setShooterVisible(v) {
      rifle.group.visible = v; sniper.body.visible = v; sniper.bag.visible = v;
      sniper.strands.visible = v && !xray.active;
    },
    // X-ray film: swap materials and drop the world into a dark, sky-less blue.
    xrayMode(on) {
      xray.set(on);
      world.sky.visible = !on;
      scene.background = on ? xrayBg : null;
      scene.fog.color.copy(on ? xrayFog : baseFog);
      world.sun.intensity = on ? 0.9 : baseSun;
      world.hemi.intensity = on ? 0.18 : baseHemi;
      scene.environmentIntensity = on ? 0.08 : baseEnv;
    },
    ejectCasing() {
      const f = c.muzzleFrame();
      const pos = c.R(V3(-0.075, 0.006, 0.022));
      casing.launch(pos, rq.clone(), f.right.clone().multiplyScalar(1.4).addScaledVector(f.up, 1.6).addScaledVector(f.dir, -0.3),
        f.up.clone().multiplyScalar(16).addScaledVector(f.dir, 5).addScaledVector(f.right, 9), world.groundY);
    },
    simulate(simDt) {
      state.simTime += simDt;
      world.update(simDt);
      if (state.bulletPhys) state.bulletDist += 853 * simDt;
      bullet.spin = state.spinOverride ?? ((state.bulletDist - (RIFLE.bulletBaseX - RIFLE.muzzleX)) / 0.254) * Math.PI * 2;
      bullet.place(path, state.bulletDist);
      blast.update(simDt);
      burst.update(simDt);
      casing.update(simDt);
    },
    afterCamera(simDt) {
      if (state.wisp) {
        state.wispAcc += simDt * 24;
        const f = c.muzzleFrame();
        while (state.wispAcc > 1) {
          state.wispAcc -= 1;
          smoke.spawn({
            pos: f.pos.clone().addScaledVector(f.dir, -0.03 + Math.random() * 0.04), vel: V3((Math.random() - 0.5) * 0.04, 0.05 + Math.random() * 0.08, (Math.random() - 0.5) * 0.04).addScaledVector(f.right, 0.03),
            life: 2.5 + Math.random() * 2, size0: 0.01, size1: 0.09 + Math.random() * 0.08, alpha: 0.12 + Math.random() * 0.08, color: [0.85, 0.83, 0.8], drag: 0.5, grav: -0.02, rotV: (Math.random() - 0.5) * 0.6, fadeIn: 0.15, grow: 0.6,
          });
        }
      }
      for (const p of [smoke, dust, mist, trail, fire]) p.update(simDt, camera);
      motes.update(simDt, camera);
    },
    resetAll() {
      c.xrayMode(false);
      rifle.setTrigger(0); rifle.setPin(0); rifle.setPowder(0, 0); rifle.setGas(0, 0, 0); rifle.setBolt(0, 0); rifle.setTurret(0);
      sniper.setFinger(0);
      burst.reset(); blast.reset(); casing.reset();
      apple.shock.visible = false; apple.group.scale.set(1, 1, 1);
      for (const p of [smoke, dust, mist, trail, fire]) p.clear();
      motes.clear(); motes.sys.mesh.visible = true;
      bullet.group.visible = true; bullet.cone.visible = false;
      c.setShooterVisible(true);
      resetState();
      post.u.uXray.value = 0; post.u.uZoom.value = 0; post.u.uCA.value = 0.0012; post.u.uVignette.value = 0.55; post.u.uFade.value = 0;
      ui.clearCaptions(); ui.setHud(''); ui.setXrayTag(false); ui.drawScope(false);
    },
  };
  casing.onBounce = (hard) => audio.tinkle(audio.now(0.005), Math.min(1, hard / 2));

  const director = new Director(c);
  c.resetAll();
  post.u.uFade.value = 1;

  addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(w, h);
    ui.resize();
  });

  let mode = 'idle', paused = false, idleT = 0, last = performance.now();
  function start() {
    audio.init();
    audio.resume();
    audio.stopAll();
    c.resetAll();
    director.reset();
    startEl.classList.add('hidden');
    endEl.hidden = true;
    document.body.classList.add('playing');
    mode = 'play'; paused = false;
    const seek = parseFloat(params.get('t') || '0');
    if (seek > 0) {
      audio.silent = true; ui.silent = true;
      while (director.t < seek) director.update(1 / 60);
      audio.silent = false; ui.silent = false;
    }
  }
  function togglePause() {
    if (mode !== 'play') return;
    paused = !paused;
    if (audio.ctx) paused ? audio.ctx.suspend() : audio.ctx.resume();
    document.body.classList.toggle('paused', paused);
  }
  playBtn.onclick = start;
  document.getElementById('replay').onclick = start;
  document.getElementById('restart').onclick = start;
  const muteBtn = document.getElementById('mute');
  const toggleMute = () => { audio.setMuted(!audio.muted); muteBtn.textContent = audio.muted ? '🔇' : '🔊'; };
  muteBtn.onclick = toggleMute;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') toggleMute();
    else if (e.code === 'KeyR') start();
    else if (e.code === 'Space') { e.preventDefault(); if (mode === 'play') togglePause(); else start(); }
  });

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (mode === 'play') {
      if (!paused) {
        director.update(dt);
        if (director.done) {
          mode = 'end';
          endEl.hidden = false;
          document.body.classList.remove('playing');
        }
      }
    } else if (mode === 'idle') {
      idleT += dt;
      director.idle(dt, idleT);
    }
    if (!paused) post.render(dt);
  }

  playBtn.disabled = false;
  playBtn.textContent = '▶  Смотреть';
  window.__scene = { director, c, start };
  // Debug: ?still renders only on demand (used for headless screenshots).
  if (params.has('still')) {
    window.__scene.step = (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) { if (mode === 'play') director.update(dt); else director.idle(dt, (idleT += dt)); }
      post.render(dt);
    };
  } else requestAnimationFrame(loop);
  if (params.has('autostart')) start();
}

requestAnimationFrame(() => setTimeout(() => {
  try { init(); } catch (e) {
    console.error(e);
    playBtn.textContent = 'WebGL недоступен';
    document.getElementById('err').textContent = String(e && e.message ? e.message : e);
  }
}, 30));
