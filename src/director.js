import * as THREE from 'three';
import { clamp, smoothstep, easeInOut, easeOut, easeIn, smoother, lerp, shake } from './utils.js';
import { RIFLE } from './rifle.js';
import { APPLE_R } from './apple.js';

export const V_BULLET = 853;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const seg = (u, a, b) => clamp((u - a) / (b - a));
const bump = (u, a, b) => Math.sin(Math.PI * seg(u, a, b));
const BULLET_START = RIFLE.bulletBaseX - RIFLE.muzzleX;

function track(keys, u) {
  if (u <= keys[0].u) return { pos: keys[0].pos.clone(), look: keys[0].look.clone(), fov: keys[0].fov };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (u <= b.u) {
      const t = easeInOut(seg(u, a.u, b.u));
      return { pos: a.pos.clone().lerp(b.pos, t), look: a.look.clone().lerp(b.look, t), fov: lerp(a.fov, b.fov, t) };
    }
  }
  const k = keys[keys.length - 1];
  return { pos: k.pos.clone(), look: k.look.clone(), fov: k.fov };
}

export class Director {
  constructor(c) {
    this.c = c;
    this.shots = this.buildShots();
    this.cues = this.buildCues().sort((a, b) => a.t - b.t);
    this.duration = this.shots[this.shots.length - 1].end;
    this.reset();
  }

  reset() {
    this.t = 0; this.idx = -1; this.cue = 0; this.done = false;
  }

  setCam(pos, look, fov, roll = 0) {
    const cam = this.c.camera;
    cam.position.copy(pos);
    cam.up.copy(UP);
    cam.lookAt(look);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 1e-6) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  update(dt) {
    const c = this.c;
    this.t += dt;
    const t = this.t;
    // A failing sound cue must never stall the picture.
    while (this.cue < this.cues.length && this.cues[this.cue].t <= t) {
      try { this.cues[this.cue].fn(); } catch (e) { console.warn('cue', this.cues[this.cue].t, e); }
      this.cue++;
    }
    let i = this.shots.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0) { i = this.shots.length - 1; this.done = true; }
    const s = this.shots[i];
    if (i !== this.idx) { this.idx = i; s.enter && s.enter(); }
    const u = clamp((t - s.start) / (s.end - s.start));
    const ts = s.ts ? Math.max(0, s.ts(u, dt)) : 1;
    c.state.ts = ts;
    c.simulate(dt * ts, dt);
    s.frame(u, dt, t);
    c.afterCamera(dt * ts, dt);
  }

  // Idle orbit shown behind the start screen.
  idle(dt, time) {
    const c = this.c;
    c.state.ts = 1;
    c.simulate(dt, dt);
    const a = time * 0.05;
    const p = c.G(V3(-1.2 + Math.cos(a) * 2.6, 0.9 + Math.sin(time * 0.1) * 0.15, 0.4 + Math.sin(a) * 2.6));
    this.setCam(p, c.G(V3(-0.4, 0.3, 0)), 34);
    c.afterCamera(dt, dt);
  }

  buildShots() {
    const c = this.c;
    const setCam = (...a) => this.setCam(...a);
    const { state, rifle, sniper, apple, path, ui, post } = c;
    const A = c.A, L = path.L;
    const R = (x, y, z) => c.R(V3(x, y, z));
    const G = (x, y, z) => c.G(V3(x, y, z));
    const tan = new THREE.Vector3(), bpos = new THREE.Vector3();
    const sunH = c.world.sunDir.clone().setY(0).normalize();
    const sunSide = new THREE.Vector3().crossVectors(UP, sunH).normalize();
    const shots = [];
    const S = (start, end, o) => shots.push({ start, end, ...o });
    const tsForDist = (d, dt) => (dt > 0 ? (d - state.bulletDist) / (V_BULLET * dt) : 0);
    const bulletFrame = (d) => {
      path.pos(d, bpos); path.tangent(d, tan);
      const rt = new THREE.Vector3().crossVectors(tan, UP).normalize();
      const up = new THREE.Vector3().crossVectors(rt, tan).normalize();
      return { pos: bpos.clone(), T: tan.clone(), rt, up };
    };
    let lastTrail = 0;
    const emitTrail = (from, to, spacing = 0.004) => {
      const n = Math.min(120, Math.floor((to - from) / spacing));
      const p = new THREE.Vector3(), tt = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        const d = from + (k / n) * (to - from);
        path.pos(d, p); path.tangent(d, tt);
        const rt = new THREE.Vector3().crossVectors(tt, UP).normalize();
        const up = new THREE.Vector3().crossVectors(rt, tt);
        const a = d * 40;
        p.addScaledVector(rt, Math.cos(a) * 0.003).addScaledVector(up, Math.sin(a) * 0.003);
        c.trail.spawn({ pos: p, vel: rt.multiplyScalar(Math.cos(a) * 2).addScaledVector(up, Math.sin(a) * 2), life: 0.006 + Math.random() * 0.004, size0: 0.004, size1: 0.016, tau: 0.0004, sizeMid: 0.006, alpha: 0.1, color: [0.95, 0.95, 1.0], drag: 300, grow: 0.3, fadeIn: 0.02 });
      }
    };

    // 0. Establishing: the apple at golden hour
    S(0, 5.5, {
      enter() { ui.letterbox(true); c.world.setShadowFocus(A, 1.6); c.motes.sys.mesh.visible = true; },
      frame(u, dt, t) {
        post.u.uFade.value = smoothstep(0, 1.8, t);
        const ang = 1.75 - 0.3 * u;
        const dir = sunH.clone().multiplyScalar(-Math.cos(ang)).addScaledVector(sunSide, Math.sin(ang));
        const dist = lerp(1.25, 0.6, easeOut(u));
        const pos = A.clone().addScaledVector(dir, dist).addScaledVector(UP, lerp(0.07, 0.025, u)).add(shake(t * 0.6, 1).multiplyScalar(0.003));
        setCam(pos, A.clone().addScaledVector(UP, 0.012), 26);
      },
    });
    // 1. The sniper in the grass
    S(5.5, 11.5, {
      enter() { c.world.setShadowFocus(c.G(V3(-0.6, 0, 0)), 3.5); },
      frame(u, dt, t) {
        const k = track([
          { u: 0, pos: G(-0.2, 2.6, 4.2), look: G(-0.4, 0.25, 0), fov: 30 },
          { u: 1, pos: G(-2.3, 0.62, 1.45), look: G(-0.2, 0.33, 0.0), fov: 30 },
        ], u);
        k.pos.add(shake(t * 0.5, 2).multiplyScalar(0.01));
        setCam(k.pos, k.look, k.fov);
      },
    });
    // 2. Rifle detail, scope turret dialed in
    S(11.5, 15.5, {
      enter() { c.world.setShadowFocus(R(0.1, 0, 0), 1.0); },
      frame(u, dt, t) {
        const k = track([
          { u: 0, pos: R(0.8, 0.1, 0.36), look: R(0.45, 0.02, 0.0), fov: 28 },
          { u: 0.45, pos: R(0.36, 0.15, 0.3), look: R(0.12, 0.06, 0.0), fov: 28 },
          { u: 1, pos: R(0.09, 0.16, 0.17), look: R(0.01, 0.085, 0.0), fov: 30 },
        ], u);
        k.pos.add(shake(t * 0.7, 3).multiplyScalar(0.0015));
        setCam(k.pos, k.look, k.fov);
        const clicks = clamp(Math.floor((t - 13.4) / 0.16) + 1, 0, 8);
        rifle.setTurret(-clicks * (Math.PI * 2) / 40);
      },
    });
    // 3. Through the scope
    const beats = Array.from({ length: 8 }, (_, k) => 15.8 + k * 0.92 + k * k * 0.01);
    S(15.5, 22.5, {
      enter() {
        c.setShooterVisible(false);
        c.world.setShadowFocus(A, 2.5);
        c.motes.sys.mesh.visible = false;
      },
      frame(u, dt, t) {
        const eye = c.R(RIFLE.eye.clone());
        const dir = A.clone().sub(eye).normalize();
        const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
        const upv = new THREE.Vector3().crossVectors(right, dir);
        const hold = smoothstep(0.55, 0.78, u);
        const amp = lerp(0.0011, 0.000015, smoothstep(0.08, 0.78, u));
        let yaw = amp * (Math.sin(t * 0.9) * 0.7 + Math.sin(t * 2.3 + 1) * 0.3);
        let pitch = amp * (Math.sin(t * 1.25 + 0.5) * 0.6 + Math.sin(t * 0.45) * 0.4);
        pitch += (1 - hold) * 0.0005 * Math.sin((t - 16.0) * (Math.PI * 2) / 3.2);
        let pulse = 0;
        for (const b of beats) if (t > b) pulse += Math.exp(-(t - b) * 14) - Math.exp(-(t - b) * 40);
        pitch += pulse * 0.00005;
        const d2 = dir.clone().addScaledVector(right, yaw).addScaledVector(upv, pitch).normalize();
        const fov = lerp(1.1, 0.17, easeInOut(seg(u, 0.1, 0.42)));
        setCam(eye, eye.clone().addScaledVector(d2, 300), fov);
        ui.drawScope(true, (yaw / 0.0011) * 10, (-pitch / 0.0011) * 10, 0.6 + 0.4 * Math.sin(t * 3));
        const mag = Math.round(5 + 27 * easeInOut(seg(u, 0.1, 0.42)));
        ui.setHud(`<div class="row"><span>ДИСТ</span><b>300 м</b></div><div class="row"><span>ВЕТЕР</span><b>1.8 м/с ←</b></div><div class="row"><span>УВЕЛ</span><b>×${mag}</b></div><div class="row"><span>ПОПР</span><b>+1.2 MIL</b></div>`);
        post.u.uVignette.value = 0.2;
      },
    });
    // 4. X-ray: trigger, sear, firing pin, primer, powder, bullet down the bore
    S(22.5, 28.5, {
      enter() {
        c.setShooterVisible(true);
        ui.drawScope(false); ui.setHud('');
        c.xrayMode(true); ui.setXrayTag(true); ui.flash(0.85, '#dff2ff', 0.5);
        state.bulletPhys = false;
        c.world.setShadowFocus(R(0, 0, 0), 1.0);
        post.u.uVignette.value = 0.55;
      },
      ts: () => 0,
      frame(u, dt, t) {
        post.u.uXray.value = 1;
        const p = easeInOut(seg(u, 0.08, 0.3));
        rifle.setTrigger(p); sniper.setFinger(p);
        rifle.setPin(easeIn(seg(u, 0.31, 0.38)));
        rifle.setPowder(seg(u, 0.4, 0.62), bump(u, 0.37, 0.52));
        const bt = easeIn(seg(u, 0.52, 1.0));
        state.bulletDist = lerp(BULLET_START, 0, bt);
        const bx = RIFLE.muzzleX + state.bulletDist;
        rifle.setGas(RIFLE.caseBaseX + 0.004, bx, seg(u, 0.42, 0.56) * (0.7 + 0.3 * seg(u, 0.55, 1)));
        let k = track([
          { u: 0, pos: R(0.01, -0.025, 0.3), look: R(-0.1, -0.06, 0), fov: 30 },
          { u: 0.3, pos: R(-0.03, -0.035, 0.24), look: R(-0.1, -0.062, 0.0), fov: 30 },
          { u: 0.36, pos: R(-0.03, -0.03, 0.235), look: R(-0.09, -0.055, 0.0), fov: 30 },
          { u: 0.52, pos: R(0.02, 0.035, 0.2), look: R(-0.03, -0.004, 0), fov: 30 },
        ], u);
        if (u > 0.52) {
          const f = easeInOut(seg(u, 0.52, 0.62));
          k.pos.lerp(R(bx - 0.09, 0.035, 0.15), f);
          k.look.lerp(R(bx + 0.05, 0, 0), f);
        }
        k.pos.add(shake(t * 0.8, 4).multiplyScalar(0.001));
        setCam(k.pos, k.look, k.fov);
        const ms = seg(u, 0.28, 1) * 5.8;
        ui.setHud(`<div class="row"><span>t</span><b>${(ms / 1000).toFixed(4)} с</b></div>`);
      },
    });
    // 5. Muzzle exit in extreme slow motion
    S(28.5, 32.0, {
      enter() {
        c.xrayMode(false); ui.setXrayTag(false); ui.flash(1, '#fff6e0', 0.6);
        post.u.uXray.value = 0;
        rifle.setPowder(0, 0); rifle.setGas(0, 0, 0);
        state.bulletDist = 0; state.bulletPhys = true; state.fireTime = state.simTime;
        c.blast.fire(c.muzzleFrame(), c.world.groundY(c.muzzleWorld.x, c.muzzleWorld.z));
        c.bullet.cone.visible = true;
        c.motes.sys.mesh.visible = true;
        c.world.setShadowFocus(R(0.7, 0, 0), 1.5);
        lastTrail = 0.03;
      },
      ts: (u, dt) => tsForDist(3.2 * Math.pow(u, 2.2), dt),
      frame(u, dt, t) {
        post.u.uCA.value = 0.004;
        const k = track([
          { u: 0, pos: R(0.98, 0.05, 0.3), look: R(0.8, 0.0, 0), fov: 34 },
          { u: 1, pos: R(1.22, 0.07, 0.38), look: R(1.02, 0.0, 0.0), fov: 36 },
        ], u);
        k.pos.add(shake(t * 9, 5).multiplyScalar(0.004 * Math.exp(-u * 4)));
        setCam(k.pos, k.look, k.fov);
        if (state.bulletDist > lastTrail + 0.01) { emitTrail(lastTrail, state.bulletDist); lastTrail = state.bulletDist; }
        const tp = state.simTime - state.fireTime;
        ui.setHud(`<div class="row"><span>V</span><b>${Math.round(V_BULLET * clamp(tp * 4000, 0, 1))} м/с</b></div><div class="row"><span>T+</span><b>${(tp * 1000).toFixed(2)} мс</b></div>`);
      },
    });
    // 6. Bullet cam across the valley
    let d0 = 0;
    S(32.0, 37.5, {
      enter() { d0 = state.bulletDist; state.spinOverride = c.bullet.spin; c.motes.sys.mesh.visible = false; },
      ts: (u, dt) => tsForDist(d0 + (L - 1.25 - d0) * smoother(u), dt),
      frame(u, dt, t) {
        state.spinOverride += dt * Math.PI * 2 * 2.2;
        const f = bulletFrame(state.bulletDist);
        c.world.setShadowFocus(f.pos, 6);
        const th = 0.5 + u * 2.4;
        const pos = f.pos.clone().addScaledVector(f.T, -0.045).addScaledVector(f.rt, 0.03 + 0.012 * Math.cos(th)).addScaledVector(f.up, 0.01 + 0.012 * Math.sin(th));
        pos.add(shake(t * 6, 6).multiplyScalar(0.0012 * bump(u, 0.1, 0.9)));
        setCam(pos, f.pos.clone().addScaledVector(f.T, 0.05), 36, Math.sin(u * 3) * 0.08);
        const sp = c.project(f.pos);
        post.u.uCenter.value.set(sp.x, sp.y);
        post.u.uZoom.value = 0.35 * bump(u, 0.05, 0.92);
        post.u.uCA.value = 0.004 + 0.01 * bump(u, 0.05, 0.92);
        const tp = state.simTime - state.fireTime;
        ui.setHud(`<div class="row"><span>V</span><b>${Math.round(V_BULLET - tp * 260)} м/с</b></div><div class="row"><span>T+</span><b>${tp.toFixed(3)} с</b></div><div class="row"><span>D</span><b>${Math.max(0, state.bulletDist).toFixed(1)} м</b></div>`);
      },
    });
    // 7. X-ray of the apple as the bullet enters
    const seedBase = apple.seeds.map((s) => s.position.clone());
    S(37.5, 42.5, {
      enter() {
        state.bulletDist = L - 0.2; state.spinOverride = null;
        c.xrayMode(true); ui.setXrayTag(true); ui.flash(0.85, '#dff2ff', 0.5);
        c.bullet.cone.visible = false;
        post.u.uZoom.value = 0; post.u.uCA.value = 0.003;
        c.world.setShadowFocus(A, 1.0);
        lastTrail = L - 0.2;
      },
      ts: (u, dt) => tsForDist(L - 0.2 + 0.29 * u, dt),
      frame(u, dt, t) {
        post.u.uXray.value = 1;
        const T = path.tangent(L, new THREE.Vector3());
        const rt = new THREE.Vector3().crossVectors(T, UP).normalize();
        const b = smoothstep(0.45, 1, u);
        apple.group.scale.set(1 + 0.14 * b, 1 + 0.09 * b, 1 + 0.14 * b);
        seedBase.forEach((p, i) => apple.seeds[i].position.copy(p).multiplyScalar(1 + 0.9 * b));
        if (u > 0.45) {
          apple.shock.visible = true;
          const entry = path.pos(L - APPLE_R, new THREE.Vector3());
          apple.group.worldToLocal(entry);
          const g = easeOut(seg(u, 0.45, 1));
          apple.shock.position.copy(entry).lerp(new THREE.Vector3(), g * 0.6);
          apple.shock.scale.setScalar(0.004 + 0.05 * g);
          apple.shock.material.uniforms.uIntensity.value = 1.3 * (1 - 0.6 * seg(u, 0.8, 1));
        }
        if (state.bulletDist > lastTrail + 0.002) { emitTrail(lastTrail, state.bulletDist, 0.002); lastTrail = state.bulletDist; }
        const pos = A.clone().addScaledVector(rt, 0.3).addScaledVector(UP, 0.05).addScaledVector(T, -0.05);
        pos.sub(A).applyAxisAngle(UP, -0.2 + 0.3 * u).add(A);
        pos.add(shake(t, 7).multiplyScalar(0.0012));
        setCam(pos, A.clone().addScaledVector(T, -0.025), 30);
        const tp = state.simTime - state.fireTime;
        ui.setHud(`<div class="row"><span>T+</span><b>${tp.toFixed(5)} с</b></div><div class="row"><span>V</span><b>${Math.round(V_BULLET - tp * 260)} м/с</b></div>`);
      },
    });
    // 8. The apple bursts; time snaps back
    let camDir = null;
    S(42.5, 50.0, {
      enter() {
        c.xrayMode(false); ui.setXrayTag(false); ui.flash(1, '#fff', 0.5);
        post.u.uXray.value = 0;
        apple.shock.visible = false; apple.group.scale.set(1, 1, 1);
        seedBase.forEach((p, i) => apple.seeds[i].position.copy(p));
        c.burst.explode(A, path.tangent(L, new THREE.Vector3()), c.mist);
        c.motes.sys.mesh.visible = true;
        camDir = null;
      },
      ts: (u) => (u < 0.55 ? lerp(0.0008, 0.004, u / 0.55) : u < 0.6 ? 0.004 * Math.pow(250, seg(u, 0.55, 0.6)) : 1),
      frame(u, dt, t) {
        const T = path.tangent(L, new THREE.Vector3());
        const rt = new THREE.Vector3().crossVectors(T, UP).normalize();
        c.bullet.group.visible = u < 0.6;
        const r = 0.6 + 0.14 * u;
        const base = rt.clone().multiplyScalar(Math.cos(0.4)).addScaledVector(T, Math.sin(0.4));
        let pos = A.clone().addScaledVector(base.applyAxisAngle(UP, 0.75 * Math.min(u, 0.6)), r).addScaledVector(UP, 0.0 + 0.04 * u);
        let look = A.clone().addScaledVector(T, 0.05).addScaledVector(UP, 0.01);
        if (!camDir && u >= 0.58) camDir = pos.clone().sub(A).setY(0).normalize();
        if (camDir) {
          const f = easeOut(seg(u, 0.58, 0.9));
          pos.lerp(A.clone().addScaledVector(camDir, 1.15).addScaledVector(T, -0.2).addScaledVector(UP, 0.32), f);
          look.lerp(A.clone().addScaledVector(UP, -0.12).addScaledVector(T, 0.25), f);
        }
        pos.add(shake(t * 14, 8).multiplyScalar(0.006 * bump(u, 0.55, 0.68)));
        setCam(pos, look, 34);
        c.world.setShadowFocus(A, 2.2);
        post.u.uCA.value = u < 0.58 ? 0.0025 : 0.0012;
        ui.setHud('');
      },
    });
    // 9a. Back at the rifle: bolt cycles, brass ejects
    let ejected = false;
    S(50.0, 54.5, {
      enter() {
        c.bullet.group.visible = false; state.bulletPhys = false;
        c.world.setShadowFocus(R(-0.1, 0, 0.1), 1.2);
        state.wisp = true; ejected = false;
      },
      ts: (u) => {
        const tt = u * 4.5;
        if (tt < 1.12) return 1;
        if (tt < 1.3) return lerp(1, 0.12, seg(tt, 1.12, 1.3));
        if (tt < 2.4) return 0.12;
        return lerp(0.12, 1, seg(tt, 2.4, 2.6));
      },
      frame(u, dt, t) {
        const tt = t - 50;
        const lift = easeInOut(seg(tt, 0.45, 0.7)) - easeInOut(seg(tt, 3.15, 3.35));
        const slide = easeInOut(seg(tt, 0.85, 1.15)) - easeInOut(seg(tt, 2.75, 3.05));
        rifle.setBolt(lift, slide);
        if (!ejected && tt > 1.1) { ejected = true; c.ejectCasing(); }
        const k = track([
          { u: 0, pos: R(0.1, 0.24, 0.5), look: R(-0.12, 0.1, 0.1), fov: 34 },
          { u: 1, pos: R(0.14, 0.24, 0.58), look: R(-0.1, 0.07, 0.18), fov: 34 },
        ], u);
        k.pos.add(shake(t * 0.6, 9).multiplyScalar(0.003));
        setCam(k.pos, k.look, k.fov);
      },
    });
    // 9b. Pull out, title, fade
    S(54.5, 61.0, {
      enter() { c.world.setShadowFocus(G(-0.6, 0, 0), 5); },
      frame(u, dt, t) {
        const k = track([
          { u: 0, pos: G(-1.4, 0.6, 1.45), look: G(0.2, 0.3, 0), fov: 32 },
          { u: 1, pos: G(-5.5, 4.6, 6.8), look: G(9, 0.0, -2), fov: 38 },
        ], u);
        setCam(k.pos, k.look, k.fov);
        post.u.uFade.value = 1 - smoothstep(59.2, 61.0, t);
      },
    });
    return shots;
  }

  buildCues() {
    const c = this.c, a = c.audio, ui = c.ui;
    const cues = [];
    const at = (t, fn) => cues.push({ t, fn });
    const now = () => a.now(0.01);
    at(0, () => { a.ambience(now()); a.drone(now()); });
    at(0.7, () => ui.caption('<small>КАЙНАРСКОЕ ПЛАТО</small>19:42', { cls: 'loc', dur: 4.2 }));
    at(2.9, () => ui.caption('<small>ЦЕЛЬ</small>яблоко · 300 м', { cls: 'loc right', dur: 2.6 }));
    at(6.3, () => ui.caption('ОДИН ВЫСТРЕЛ', { cls: 'title', dur: 4.8 }));
    at(13.3, () => ui.caption('<small>ВЕРТИКАЛЬНАЯ ПОПРАВКА</small>+1.2 MIL', { cls: 'loc', dur: 2.2 }));
    for (let i = 0; i < 8; i++) at(13.4 + i * 0.16, () => a.turretClick(now()));
    at(15.5, () => { a.ambDuck(now(), 5000, 0.7); });
    for (let k = 0; k < 8; k++) at(15.8 + k * 0.92 + k * k * 0.01, () => a.heartbeat(now(), 0.45 + k * 0.05));
    at(16.0, () => a.breath(now(), true, 1.4));
    at(17.6, () => a.breath(now(), false, 1.5));
    at(19.3, () => a.breath(now(), true, 0.9));
    at(19.8, () => a.droneLevel(now(), 0.05));
    at(20.0, () => a.riser(now(), 2.45));
    at(22.5, () => { const t = now(); a.slowmoIn(t); a.xrayOn(t); a.ambDuck(t, 250, 0.3); a.dronePitch(t, 0.5); a.droneLevel(t, 0.14); });
    for (const tt of [23.0, 24.9, 26.8]) at(tt, () => a.heartbeat(now(), 0.85, 2.2));
    at(24.2, () => a.triggerSlow(now()));
    at(24.8, () => a.pinStrike(now()));
    at(25.0, () => a.ignition(now(), 1.6));
    at(28.5, () => { const t = now(); a.xrayOff(t); a.gunshotSlow(t); a.ambDuck(t, 420, 0.35); });
    at(32.0, () => { const t = now(); a.bulletFlight(t, 5.5); a.dronePitch(t, 0.72, 1.5); });
    at(37.5, () => { const t = now(); a.xrayOn(t); a.slowmoIn(t); a.dronePitch(t, 0.45); });
    for (const tt of [38.0, 40.1]) at(tt, () => a.heartbeat(now(), 0.9, 2.4));
    at(39.75, () => a.impactSlow(now()));
    at(42.5, () => { const t = now(); a.xrayOff(t); a.braam(t); a.splash(t, 0.7); });
    at(46.62, () => { const t = now(); a.slowmoOut(t); a.dronePitch(t, 1, 0.3); a.ambDuck(t + 0.4, 18000, 1, 0.4); a.droneLevel(t, 0.05); });
    at(46.72, () => a.splash(now(), 1.3));
    at(47.25, () => a.gunshot(now(), { gain: 0.75, distant: true }));
    for (let i = 0; i < 16; i++) at(46.9 + Math.pow(i / 16, 1.4) * 1.6, () => a.pat(now(), 1 - i / 20));
    at(47.5, () => ui.caption('ПОПАДАНИЕ<small>300 м · 0.37 с</small>', { cls: 'hit', dur: 2.8 }));
    at(50.45, () => a.boltLift(now()));
    at(50.85, () => a.boltSlide(now(), true));
    at(52.75, () => a.boltSlide(now(), false));
    at(53.15, () => a.boltLift(now()));
    at(55.0, () => a.pad(now(), 6.5));
    at(55.4, () => ui.caption('ЦЕЛЬ ПОРАЖЕНА', { cls: 'title end', dur: 4.6 }));
    at(58.6, () => { const t = now(); a.droneLevel(t, 0, 0.8); a.ambDuck(t, 18000, 0, 1.0); });
    return cues;
  }
}
