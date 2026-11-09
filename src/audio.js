// Procedural cinematic sound design on WebAudio. All methods take an absolute AudioContext time.
export class Sound {
  constructor() {
    this.ctx = null;
    this.silent = false;
    this.muted = false;
    this.loops = [];
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.user = ctx.createGain();
    this.user.gain.value = this.muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.3;
    this.user.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    this.white = ctx.createBuffer(2, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const w = this.white.getChannelData(c), b = this.brown.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const r = Math.random() * 2 - 1;
        w[i] = r;
        last = (last + 0.02 * r) / 1.02;
        b[i] = last * 3.5;
      }
    }
    this.ir = this.makeIR(3.8, 2.4);
    this.shaper = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.shaper[i] = Math.tanh(x * 2.6); }
    this.buildBus();
  }

  buildBus() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.user);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.ir;
    this.revOut = ctx.createGain(); this.revOut.gain.value = 0.55;
    this.reverb.connect(this.revOut).connect(this.master);
    this.ambFilter = ctx.createBiquadFilter(); this.ambFilter.type = 'lowpass'; this.ambFilter.frequency.value = 18000;
    this.amb = ctx.createGain(); this.amb.gain.value = 1;
    this.amb.connect(this.ambFilter).connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 1;
    this.music.connect(this.master);
  }

  makeIR(dur, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  get on() { return !!this.ctx && !this.silent; }
  now(o = 0) { return this.ctx ? this.ctx.currentTime + o : 0; }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setMuted(m) {
    this.muted = m;
    if (this.user) this.user.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  // Hard stop for replay: fade the bus and rebuild a fresh one.
  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const old = this.master;
    old.gain.setTargetAtTime(0, t, 0.03);
    setTimeout(() => old.disconnect(), 400);
    for (const l of this.loops) { try { l.stop(t + 0.3); } catch { /* already stopped */ } }
    this.loops = [];
    this.buildBus();
  }

  // ---------- primitives ----------
  route(node, { dest, rev = 0, pan = 0 } = {}) {
    const ctx = this.ctx;
    let n = node;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
    n.connect(dest || this.master);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; n.connect(s).connect(this.reverb); }
    return n;
  }
  env(param, t, a, peak, d, hold = 0) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + Math.max(a, 0.001));
    param.setValueAtTime(peak, t + a + hold);
    param.setTargetAtTime(0.0001, t + a + hold, d);
  }
  noise(t, { kind = 'white', a = 0.005, peak = 0.5, d = 0.1, hold = 0, filters = [], rate = 1, ...o } = {}) {
    t = Math.max(t, this.ctx.currentTime);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = kind === 'brown' ? this.brown : this.white;
    src.loop = true;
    src.playbackRate.value = rate;
    let n = src;
    for (const f of filters) {
      const bq = ctx.createBiquadFilter();
      bq.type = f.type; bq.Q.value = f.Q ?? 0.7;
      bq.frequency.setValueAtTime(f.f, t);
      if (f.to) bq.frequency.exponentialRampToValueAtTime(f.to, t + (f.dur ?? d * 3));
      n.connect(bq); n = bq;
    }
    const g = ctx.createGain();
    this.env(g.gain, t, a, peak, d, hold);
    n.connect(g);
    this.route(g, o);
    src.start(t, Math.random() * 3);
    src.stop(t + a + hold + d * 7 + 0.05);
    return { src, g };
  }
  tone(t, { type = 'sine', f = 440, to, glide, a = 0.005, peak = 0.3, d = 0.2, hold = 0, shape = false, filter, ...o } = {}) {
    t = Math.max(t, this.ctx.currentTime);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + (glide ?? d * 3));
    let n = osc;
    if (shape) { const ws = ctx.createWaveShaper(); ws.curve = this.shaper; n.connect(ws); n = ws; }
    if (filter) { const bq = ctx.createBiquadFilter(); bq.type = filter.type; bq.frequency.value = filter.f; bq.Q.value = filter.Q ?? 0.7; n.connect(bq); n = bq; }
    const g = ctx.createGain();
    this.env(g.gain, t, a, peak, d, hold);
    n.connect(g);
    this.route(g, o);
    osc.start(t);
    osc.stop(t + a + hold + d * 7 + 0.05);
    return { osc, g };
  }
  metal(t, partials, { peak = 0.2, d = 0.05, rev = 0.15, pan = 0, dest } = {}) {
    partials.forEach((f, i) => this.tone(t, { f, peak: peak / (i + 1.2), d: d / (1 + i * 0.35), a: 0.001, rev, pan, dest }));
    this.noise(t, { a: 0.0005, peak: peak * 0.8, d: 0.006, filters: [{ type: 'highpass', f: 2500 }], pan, dest });
  }

  // ---------- ambience & score ----------
  ambience(t) {
    if (!this.on) return;
    const ctx = this.ctx;
    const mk = (buf, filt, f, q, gain, lfoHz, lfoAmt, pan) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const bq = ctx.createBiquadFilter(); bq.type = filt; bq.frequency.value = f; bq.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 3);
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoHz;
      const la = ctx.createGain(); la.gain.value = lfoAmt;
      lfo.connect(la).connect(g.gain);
      s.connect(bq).connect(g);
      this.route(g, { dest: this.amb, pan });
      s.start(t, Math.random() * 3); lfo.start(t);
      this.loops.push(s, lfo);
    };
    mk(this.brown, 'lowpass', 380, 0.5, 0.3, 0.07, 0.12, -0.2);
    mk(this.white, 'bandpass', 900, 0.6, 0.025, 0.11, 0.015, 0.3);
    mk(this.white, 'highpass', 4200, 0.5, 0.008, 0.17, 0.006, -0.4);
    for (let i = 0; i < 9; i++) this.bird(t + 0.8 + Math.random() * 13, (Math.random() - 0.5) * 1.6);
  }
  bird(t, pan) {
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 + Math.random() * 0.05);
      this.tone(tt, { f: base, to: base * (1.25 + Math.random() * 0.3), glide: 0.05, a: 0.004, peak: 0.018, d: 0.025, hold: 0.03, pan, rev: 0.5, dest: this.amb });
    }
  }
  ambDuck(t, cutoff, gain, tc = 0.25) {
    if (!this.on) return;
    this.ambFilter.frequency.setTargetAtTime(cutoff, t, tc);
    this.amb.gain.setTargetAtTime(gain, t, tc);
  }
  drone(t) {
    if (!this.on) return;
    const ctx = this.ctx;
    const out = (this.droneGain = ctx.createGain());
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.11, t + 8);
    const lp = (this.droneLP = ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const la = ctx.createGain(); la.gain.value = 90; lfo.connect(la).connect(lp.frequency); lfo.start(t);
    lp.connect(out);
    this.route(out, { dest: this.music, rev: 0.35 });
    this.droneOsc = [];
    for (const [f, ty] of [[55, 'sawtooth'], [55.35, 'sawtooth'], [82.6, 'sawtooth'], [27.5, 'sine'], [110.4, 'triangle']]) {
      const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f; o.connect(lp); o.start(t);
      this.droneOsc.push(o); this.loops.push(o);
    }
    this.loops.push(lfo);
  }
  droneLevel(t, v, tc = 0.6) { if (this.on && this.droneGain) this.droneGain.gain.setTargetAtTime(v, t, tc); }
  dronePitch(t, factor, tc = 0.5) {
    if (!this.on || !this.droneOsc) return;
    const base = [55, 55.35, 82.6, 27.5, 110.4];
    this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime(base[i] * factor, t, tc));
  }
  riser(t, dur) {
    if (!this.on) return;
    this.noise(t, { a: dur, peak: 0.12, d: 0.02, filters: [{ type: 'bandpass', f: 300, to: 5000, dur, Q: 3 }], rev: 0.3 });
    this.tone(t, { type: 'sawtooth', f: 110, to: 440, glide: dur, a: dur, peak: 0.035, d: 0.02, filter: { type: 'lowpass', f: 1600 }, rev: 0.3, dest: this.music });
  }
  heartbeat(t, s = 1, slow = 1) {
    if (!this.on) return;
    for (const [dt, k] of [[0, 1], [0.27 * slow, 0.7]]) {
      this.tone(t + dt, { f: 64 / Math.sqrt(slow), to: 36 / Math.sqrt(slow), glide: 0.12 * slow, a: 0.008, peak: 0.55 * s * k, d: 0.07 * slow, filter: { type: 'lowpass', f: 180 } });
    }
  }
  breath(t, inhale, dur) {
    if (!this.on) return;
    const [f0, f1] = inhale ? [700, 1400] : [1300, 600];
    this.noise(t, { a: dur * 0.45, hold: dur * 0.2, peak: 0.07, d: dur * 0.15, filters: [{ type: 'bandpass', f: f0, to: f1, dur, Q: 0.8 }, { type: 'lowpass', f: 3000 }], pan: -0.1 });
  }
  turretClick(t) { if (this.on) this.metal(t, [3100, 4700, 6900], { peak: 0.12, d: 0.03, pan: 0.2 }); }

  // ---------- the shot ----------
  slowmoIn(t) {
    if (!this.on) return;
    this.noise(t - 0.35, { a: 0.35, peak: 0.25, d: 0.5, filters: [{ type: 'lowpass', f: 9000, to: 160, dur: 1.4 }], rev: 0.4 });
    this.tone(t, { f: 240, to: 32, glide: 1.6, a: 0.02, peak: 0.45, d: 0.6, hold: 0.4, shape: true, rev: 0.4 });
    this.tone(t, { f: 48, to: 30, glide: 2, a: 0.02, peak: 0.6, d: 0.9 });
  }
  slowmoOut(t) {
    if (!this.on) return;
    this.noise(t, { a: 0.5, peak: 0.3, d: 0.06, filters: [{ type: 'lowpass', f: 180, to: 9000, dur: 0.55 }] });
    this.tone(t, { f: 40, to: 220, glide: 0.55, a: 0.5, peak: 0.25, d: 0.05, shape: true });
  }
  xrayOn(t) {
    if (!this.on) return;
    for (const [f, p] of [[1760, 0.05], [2637, 0.035], [3520, 0.02], [880, 0.04]]) this.tone(t, { f, peak: p, d: 0.9, a: 0.004, rev: 0.6 });
    this.noise(t, { a: 0.002, peak: 0.25, d: 0.08, filters: [{ type: 'highpass', f: 1800 }], rev: 0.3 });
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const g = (this.humGain = ctx.createGain()); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.4);
    const trem = ctx.createOscillator(); trem.frequency.value = 7; const ta = ctx.createGain(); ta.gain.value = 0.02;
    trem.connect(ta).connect(g.gain);
    o.connect(lp).connect(g); this.route(g, { rev: 0.2 });
    o.start(t); trem.start(t);
    this.hum = [o, trem]; this.loops.push(o, trem);
  }
  xrayOff(t) {
    if (!this.on) return;
    if (this.humGain) this.humGain.gain.setTargetAtTime(0, t, 0.08);
    if (this.hum) this.hum.forEach((o) => { try { o.stop(t + 0.6); } catch { /* ok */ } });
    this.hum = null;
    this.noise(t, { a: 0.002, peak: 0.2, d: 0.06, filters: [{ type: 'highpass', f: 2000 }] });
  }
  triggerSlow(t) {
    if (!this.on) return;
    this.metal(t, [170, 410, 690, 1130, 1720], { peak: 0.55, d: 0.9, rev: 0.6 });
    this.noise(t, { kind: 'brown', a: 0.01, peak: 0.3, d: 0.2, filters: [{ type: 'lowpass', f: 400 }] });
  }
  pinStrike(t) {
    if (!this.on) return;
    this.metal(t, [380, 1010, 1930, 2860], { peak: 0.7, d: 1.4, rev: 0.7 });
    this.tone(t, { f: 90, to: 40, glide: 0.8, a: 0.003, peak: 0.6, d: 0.35 });
  }
  ignition(t, dur) {
    if (!this.on) return;
    this.noise(t, { kind: 'brown', a: dur * 0.9, peak: 0.7, d: 0.4, filters: [{ type: 'lowpass', f: 70, to: 1200, dur }], rev: 0.4 });
    for (let i = 0; i < 70; i++) {
      const tt = t + dur * Math.pow(Math.random(), 0.6);
      this.noise(tt, { a: 0.0005, peak: 0.05 + Math.random() * 0.12, d: 0.004 + Math.random() * 0.01, filters: [{ type: 'bandpass', f: 800 + Math.random() * 3000, Q: 1.5 }], pan: (Math.random() - 0.5) * 0.6 });
    }
    this.tone(t, { type: 'sawtooth', f: 45, to: 90, glide: dur, a: dur, peak: 0.12, d: 0.2, shape: true, filter: { type: 'lowpass', f: 300 } });
  }
  gunshotSlow(t) {
    if (!this.on) return;
    this.tone(t, { f: 110, to: 24, glide: 3.2, a: 0.02, peak: 1.0, d: 1.3, shape: true, rev: 0.4 });
    this.noise(t, { kind: 'brown', a: 0.05, peak: 1.0, d: 1.1, filters: [{ type: 'lowpass', f: 1400, to: 110, dur: 3.5 }], rev: 0.8 });
    this.noise(t, { a: 0.006, peak: 0.55, d: 0.3, filters: [{ type: 'bandpass', f: 1300, to: 300, dur: 1.2, Q: 0.6 }], rev: 0.9 });
    this.noise(t + 0.02, { a: 0.6, peak: 0.25, d: 1.6, filters: [{ type: 'lowpass', f: 500 }], rev: 1.0, pan: 0.3 });
    this.noise(t + 0.04, { a: 0.6, peak: 0.25, d: 1.6, filters: [{ type: 'lowpass', f: 520 }], rev: 1.0, pan: -0.3 });
  }
  gunshot(t, { gain = 1, distant = false } = {}) {
    if (!this.on) return;
    const k = gain;
    if (!distant) this.noise(t, { a: 0.0008, peak: 0.9 * k, d: 0.012, filters: [{ type: 'highpass', f: 1200 }] });
    this.noise(t, { kind: 'brown', a: 0.002, peak: 0.9 * k, d: distant ? 0.35 : 0.18, filters: [{ type: 'lowpass', f: distant ? 700 : 2500 }], rev: 0.9 });
    this.tone(t, { f: 100, to: 34, glide: 0.35, a: 0.002, peak: 0.8 * k, d: 0.16, shape: true });
    this.echo(t + 0.35, 0.45 * k);
  }
  echo(t, k) {
    if (!this.on) return;
    [0, 0.55, 1.25, 2.1].forEach((dt, i) => {
      this.noise(t + dt, { kind: 'brown', a: 0.05, peak: k / (1 + i * 0.9), d: 0.5 + i * 0.2, filters: [{ type: 'lowpass', f: 600 - i * 100 }], rev: 1.0, pan: i % 2 ? 0.5 : -0.5 });
    });
  }
  bulletFlight(t, dur) {
    if (!this.on) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.white; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.08, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.5, t); pan.pan.linearRampToValueAtTime(0.5, t + dur * 0.5); pan.pan.linearRampToValueAtTime(-0.2, t + dur);
    src.connect(bp).connect(g).connect(pan).connect(this.master);
    src.start(t); src.stop(t + dur + 0.4);
    this.noise(t, { kind: 'brown', a: dur * 0.4, hold: dur * 0.3, peak: 0.35, d: dur * 0.2, filters: [{ type: 'lowpass', f: 140 }] });
    this.tone(t, { f: 1400, to: 900, glide: dur, a: dur * 0.5, peak: 0.015, d: dur * 0.2, rev: 0.3 });
  }
  impactSlow(t) {
    if (!this.on) return;
    this.tone(t, { f: 80, to: 26, glide: 2.4, a: 0.01, peak: 1.0, d: 0.8, shape: true, rev: 0.3 });
    this.noise(t, { a: 0.01, peak: 0.6, d: 0.6, filters: [{ type: 'bandpass', f: 700, to: 220, dur: 2, Q: 0.7 }], rev: 0.6 });
    for (let i = 0; i < 45; i++) {
      const tt = t + Math.pow(Math.random(), 1.5) * 1.2;
      this.noise(tt, { a: 0.001, peak: 0.12 * (1 - (tt - t) / 1.4), d: 0.02 + Math.random() * 0.04, filters: [{ type: 'bandpass', f: 900 + Math.random() * 2500, Q: 2 }], pan: (Math.random() - 0.5), rev: 0.3 });
    }
  }
  braam(t) {
    if (!this.on) return;
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(140, t); lp.frequency.exponentialRampToValueAtTime(1500, t + 0.35); lp.frequency.exponentialRampToValueAtTime(260, t + 4);
    const ws = ctx.createWaveShaper(); ws.curve = this.shaper;
    const g = ctx.createGain(); this.env(g.gain, t, 0.08, 0.32, 1.3, 1.6);
    lp.connect(ws).connect(g);
    this.route(g, { dest: this.music, rev: 0.6 });
    for (const f of [55, 55.4, 54.6, 82.4, 110, 109.4, 130.8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 9);
    }
    this.tone(t, { f: 41, a: 0.05, peak: 0.6, d: 1.6, hold: 1, dest: this.music });
  }
  splash(t, k = 1) {
    if (!this.on) return;
    this.noise(t, { a: 0.003, peak: 0.6 * k, d: 0.12, filters: [{ type: 'bandpass', f: 1100, Q: 0.6 }], rev: 0.3 });
    this.noise(t, { kind: 'brown', a: 0.003, peak: 0.5 * k, d: 0.1, filters: [{ type: 'lowpass', f: 400 }] });
  }
  pat(t, k = 1) {
    if (!this.on) return;
    this.noise(t, { a: 0.001, peak: 0.12 * k, d: 0.02 + Math.random() * 0.02, filters: [{ type: 'bandpass', f: 500 + Math.random() * 1400, Q: 1.2 }], pan: (Math.random() - 0.5) * 0.8 });
  }
  boltLift(t) { if (this.on) this.metal(t, [1900, 3300, 5200], { peak: 0.3, d: 0.08 }); }
  boltSlide(t, back) {
    if (!this.on) return;
    this.noise(t, { a: 0.02, hold: 0.06, peak: 0.12, d: 0.03, filters: [{ type: 'bandpass', f: back ? 2600 : 3200, to: back ? 1800 : 4200, dur: 0.12, Q: 2.5 }] });
    this.metal(t + 0.11, back ? [1500, 2600, 4100] : [1700, 2900, 4800], { peak: 0.28, d: 0.06 });
  }
  tinkle(t, k = 1) { if (this.on) this.metal(t, [3150, 5230, 7400, 9100], { peak: 0.16 * k, d: 0.22, rev: 0.2, pan: 0.35 }); }
  pad(t, dur) {
    if (!this.on) return;
    for (const f of [110, 164.8, 220, 261.6, 329.6, 493.9]) {
      this.tone(t, { type: 'triangle', f, a: 2.5, hold: dur - 4, peak: 0.022, d: 1.2, filter: { type: 'lowpass', f: 1200 }, rev: 0.7, dest: this.music });
    }
  }
}
