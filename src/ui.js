// DOM overlays: letterbox, captions, HUD, flashes, scope reticle, start / end screens.
export class UI {
  constructor() {
    this.root = document.getElementById('overlay');
    this.scope = document.getElementById('scope');
    this.sctx = this.scope.getContext('2d');
    this.flashEl = document.getElementById('flash');
    this.capEl = document.getElementById('captions');
    this.hud = document.getElementById('hud');
    this.xrayTag = document.getElementById('xraytag');
    this.bars = [...document.querySelectorAll('.bar')];
    this.scopeOn = false;
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.scope.width = this.w * dpr; this.scope.height = this.h * dpr;
    this.sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = this.w / 2.39;
    const bar = Math.max(0, (this.h - target) / 2);
    this.barPx = bar;
    document.documentElement.style.setProperty('--bar', `${bar}px`);
  }
  letterbox(on) { document.body.classList.toggle('lb', on); }
  flash(strength = 1, color = '#fff', dur = 0.45) {
    const f = this.flashEl;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = String(strength);
    void f.offsetWidth;
    f.style.transition = `opacity ${dur}s ease-out`;
    f.style.opacity = '0';
  }
  caption(html, { cls = '', dur = 3.5 } = {}) {
    if (this.silent) return null;
    const el = document.createElement('div');
    el.className = `cap ${cls}`;
    el.innerHTML = html;
    el.style.setProperty('--dur', `${dur}s`);
    this.capEl.appendChild(el);
    setTimeout(() => el.remove(), dur * 1000 + 100);
    return el;
  }
  clearCaptions() { this.capEl.innerHTML = ''; }
  setHud(html) {
    if (this._hud === html) return;
    this._hud = html;
    this.hud.innerHTML = html || '';
    this.hud.style.opacity = html ? '1' : '0';
  }
  setXrayTag(on) { this.xrayTag.style.opacity = on ? '1' : '0'; }

  // Sniper scope: dark tube vignette, parallax shadow, second-focal-plane mil reticle.
  drawScope(on, ox = 0, oy = 0, glow = 1) {
    const g = this.sctx, w = this.w, h = this.h;
    if (!on) { if (this.scopeOn) g.clearRect(0, 0, w, h); this.scopeOn = false; return; }
    this.scopeOn = true;
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h * 1.02) * 0.44;
    const sx = cx + ox, sy = cy + oy;
    g.save();
    g.fillStyle = '#000';
    g.beginPath(); g.rect(0, 0, w, h); g.arc(sx, sy, r, 0, Math.PI * 2, true); g.fill('evenodd');
    const grd = g.createRadialGradient(sx, sy, r * 0.7, sx, sy, r);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.82, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grd; g.beginPath(); g.arc(sx, sy, r + 1, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,90,40,0.18)'; g.beginPath(); g.arc(sx - 1.5, sy, r * 0.985, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(60,140,255,0.18)'; g.beginPath(); g.arc(sx + 1.5, sy, r * 0.985, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(sx, sy, r * 0.99, 0, Math.PI * 2); g.clip();
    // reticle
    g.fillStyle = 'rgba(8,8,8,0.92)';
    const t = 1.1, post = 4.5;
    g.fillRect(cx - r, cy - t / 2, r * 2, t);
    g.fillRect(cx - t / 2, cy - r, t, r * 2);
    g.fillRect(cx - r, cy - post / 2, r * 0.48, post);
    g.fillRect(cx + r * 0.52, cy - post / 2, r * 0.48, post);
    g.fillRect(cx - post / 2, cy + r * 0.52, post, r * 0.48);
    g.fillRect(cx - post / 2, cy - r, post, r * 0.48);
    const mil = r * 0.052;
    for (let i = -9; i <= 9; i++) {
      if (!i) continue;
      const L = i % 5 === 0 ? 9 : 5;
      g.fillRect(cx + i * mil - 0.5, cy - L / 2, 1, L);
      g.fillRect(cx - L / 2, cy + i * mil - 0.5, L, 1);
      if (i > 0 && i % 2 === 0) {
        for (let k = -Math.floor(i / 2); k <= Math.floor(i / 2); k++) g.fillRect(cx + k * mil - 0.6, cy + i * mil - 0.6, 1.2, 1.2);
      }
    }
    g.font = '600 10px ui-monospace, Menlo, monospace';
    g.fillStyle = 'rgba(10,10,10,0.9)';
    for (const i of [5]) {
      g.fillText(String(i), cx + i * mil - 3, cy - 9);
      g.fillText(String(i), cx + 7, cy + i * mil + 3);
    }
    // illuminated center dot
    g.shadowColor = 'rgba(255,40,20,0.9)'; g.shadowBlur = 8 * glow;
    g.fillStyle = `rgba(255,${40 + 20 * glow},30,${0.6 + 0.4 * glow})`;
    g.beginPath(); g.arc(cx, cy, 1.7, 0, Math.PI * 2); g.fill();
    g.restore();
    // eyebox shadow crescent (parallax)
    if (Math.abs(ox) + Math.abs(oy) > 0.5) {
      g.save();
      const sh = g.createRadialGradient(sx + ox * 3, sy + oy * 3, r * 0.6, sx + ox * 3, sy + oy * 3, r * 1.05);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.8)');
      g.fillStyle = sh; g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
}
