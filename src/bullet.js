import * as THREE from 'three';
import { bulletProfile } from './rifle.js';
import { xrayMaterial } from './xray.js';
import { canvasTexture } from './utils.js';

const X = new THREE.Vector3(1, 0, 0);

// Trajectory: straight muzzle->apple chord plus a parabolic arc (drop compensation).
// dist < 0 means still inside the barrel along the bore axis.
export class BulletPath {
  constructor(muzzle, target, arc = 0.16) {
    this.M = muzzle.clone();
    this.A = target.clone();
    this.L = this.M.distanceTo(this.A);
    this.D = new THREE.Vector3().subVectors(this.A, this.M).normalize();
    this.arc = arc;
    this.up = new THREE.Vector3(0, 1, 0);
    this.T0 = this.tangent(0, new THREE.Vector3());
  }
  pos(d, out) {
    if (d < 0) return out.copy(this.M).addScaledVector(this.T0, d);
    const s = d / this.L;
    return out.copy(this.M).addScaledVector(this.D, d).addScaledVector(this.up, 4 * this.arc * s * (1 - s));
  }
  tangent(d, out) {
    if (d < 0 && this.T0) return out.copy(this.T0);
    const s = d / this.L;
    return out.copy(this.D).multiplyScalar(this.L).addScaledVector(this.up, 4 * this.arc * (1 - 2 * s)).normalize();
  }
}

export function buildBullet(xray) {
  const group = new THREE.Group();
  const geo = new THREE.LatheGeometry(bulletProfile().map(([r, x]) => new THREE.Vector2(r, x)), 48).rotateZ(-Math.PI / 2);
  // Rifling engraving on the bearing surface (lathe v in [3/19, 4/19]) so the spin reads on camera.
  const engr = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const y0 = (1 - 4 / 19) * h, y1 = (1 - 3 / 19) * h;
    g.fillStyle = '#4a4a4a';
    for (let k = 0; k < 4; k++) {
      const x = k * (w / 4);
      g.beginPath(); g.moveTo(x, y1); g.lineTo(x + 9, y1); g.lineTo(x + 21, y0); g.lineTo(x + 12, y0); g.fill();
    }
  });
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8804c, map: engr, metalness: 1, roughness: 0.2 });
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  body.userData.xrayMat = xrayMaterial({ color: 0xfff2dc, base: 0.55, rim: 1.4, power: 1.3, intensity: 1.6 });
  group.add(body);
  // Mach cone (~23 deg half-angle at Mach 2.5)
  const h = 0.09;
  const coneGeo = new THREE.ConeGeometry(h * 0.44, h, 40, 1, true).rotateZ(-Math.PI / 2).translate(0.031 - h / 2, 0, 0);
  const cone = new THREE.Mesh(coneGeo, xrayMaterial({ color: 0xe8f4ff, base: 0.0, rim: 0.35, power: 3.5, intensity: 0.5 }));
  cone.userData.noXray = true;
  cone.visible = false;
  group.add(cone);
  xray.register(group);

  const q = new THREE.Quaternion(), qs = new THREE.Quaternion(), tan = new THREE.Vector3();
  return {
    group, body, cone, spin: 0,
    place(path, dist) {
      path.pos(dist, group.position);
      path.tangent(dist, tan);
      q.setFromUnitVectors(X, tan);
      qs.setFromAxisAngle(X, this.spin);
      group.quaternion.copy(q).multiply(qs);
    },
  };
}
