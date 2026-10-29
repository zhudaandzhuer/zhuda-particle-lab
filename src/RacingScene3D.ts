import { ZhudaParticleSystem3D, ZhudaLayaParticleRenderer3D, ZhudaRibbonTrail3D,
  ZhudaLayaRibbonRenderer3D, ZhudaRibbonPath3D, ZhudaEffectEnvelope, validateParticleEffect3D, rotateParticleVector3 } from 'zhuda-laya-engine';
import type { ParticleEffectSpec3D, ParticleVector3 } from 'zhuda-laya-engine';
declare const Laya: any;
type Parameters = { density: number; velocity: number; lifetime: number; trails: boolean; ground: boolean; enabled: boolean };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Vehicle, track and all art direction belong to this independent demonstration.
export class RacingScene3D {
  readonly scene = new Laya.Scene3D();
  readonly camera = new Laya.Camera(0, .08, 230);
  readonly car = new Laya.Sprite3D('Demo racing car');
  cameraMode = 'chase';
  private spec: ParticleEffectSpec3D;
  private presetSpec: ParticleEffectSpec3D;
  private systems: ZhudaParticleSystem3D[] = [];
  private renderers: ZhudaLayaParticleRenderer3D[] = [];
  private trails: ZhudaRibbonTrail3D[] = [];
  private ribbons: ZhudaLayaRibbonRenderer3D[] = [];
  private flowSpecs: any[] = [];
  private flows: Array<{ path: ZhudaRibbonPath3D; renderer: ZhudaLayaRibbonRenderer3D; points: ParticleVector3[]; widthDirs: ParticleVector3[]; spec: any }> = [];
  private envelope = new ZhudaEffectEnvelope(.2, .55);
  private running = false;
  private distance = 0;
  private speed = 0;
  private time = 0;
  private wheels: any[] = [];
  private temp = { x: 0, y: 0, z: 0 };
  private target = new Laya.Vector3();
  private cameraPosition = new Laya.Vector3();
  private up = new Laya.Vector3(0, 1, 0);
  private params: Parameters;
  private materials: any[] = [];
  constructor(private readonly textures: Map<string, any>) {
    Laya.stage.addChild(this.scene); this.scene.name = 'Independent Racing 3D';
    this.scene.ambientMode = Laya.AmbientMode.SolidColor; this.scene.ambientColor = new Laya.Color(.48, .58, .7, 1);
    this.scene.enableFog = true; this.scene.fogColor = new Laya.Color(.035, .065, .105, 1); this.scene.fogStart = 50; this.scene.fogRange = 160;
    this.camera.clearColor = new Laya.Color(.035, .065, .105, 1); this.camera.fieldOfView = 57; this.scene.addChild(this.camera);
    const lightNode = new Laya.Sprite3D('Moon key'); this.scene.addChild(lightNode);
    const light = lightNode.addComponent(Laya.DirectionLightCom); light.color = new Laya.Color(.78, .89, 1, 1); light.intensity = 1.4;
    lightNode.transform.rotationEuler = new Laya.Vector3(-42, -25, 0);
    this.makeTrack(); this.makeCar(); this.scene.addChild(this.car); this.scene.active = false;
  }
  async load(): Promise<void> {
    this.flowSpecs = (await (await fetch('assets/effects/racing-airflow.json')).json()).paths;
    const spec = await (await fetch('assets/effects/racing3d.json')).json(); this.presetSpec = clone(spec);
    this.configure(spec, { density: 1, velocity: 1, lifetime: 1, trails: true, ground: true, enabled: true });
  }
  usePreset(params: Parameters): void { this.configure(this.presetSpec, params); }
  configure(spec: ParticleEffectSpec3D, params: Parameters): void {
    const issues = validateParticleEffect3D(spec); if (issues.length) throw new Error(issues.join(' | '));
    for (const e of spec.emitters) if (!this.textures.has(e.texture)) throw new Error(`Unknown demo texture: ${e.texture}`);
    this.spec = clone(spec); this.params = params;
    this.rebuild();
  }
  descriptor(params = this.params): ParticleEffectSpec3D {
    const spec = clone(this.spec);
    const scale = (v: number | [number, number], f: number) => Array.isArray(v) ? v.map(x => x * f) as [number, number] : v * f;
    for (const e of spec.emitters) { e.rate *= params.density; e.speed = scale(e.speed, params.velocity); e.lifetime = scale(e.lifetime, params.lifetime); e.bursts?.forEach(b => b.count = Math.round(b.count * params.density)); }
    return spec;
  }
  updateParameters(params: Parameters): void { this.params = params; this.rebuild(); }
  reset(): void {
    this.time = this.distance = this.speed = 0; this.running = false; this.envelope.reset();
    for (const s of this.systems) s.stop(true); for (const t of this.trails) t.clear(); for (const f of this.flows) f.path.clear();
    this.moveCar(); this.draw();
  }
  advance(dt: number, time: number): void {
    this.time = time;
    const running = time >= .7 && time < 5.6;
    if (running && !this.running) { this.envelope.start(); for (const s of this.systems) s.play(); }
    if (!running && this.running) { this.envelope.stop(); for (const s of this.systems) s.stop(); }
    this.running = running; this.envelope.update(dt);
    this.speed = time < .7 ? 8 : time < 5.6 ? 8 + this.envelope.value * 38 : Math.max(0, 8 * (1 - (time - 5.6) / .8)) + this.envelope.value * 38;
    this.distance += this.speed * dt; this.moveCar();
    const q = this.car.transform.rotation;
    for (const s of this.systems) {
      const id = s.spec.id, side = id.endsWith('left') ? -1 : 1;
      const point = this.temp;
      if (id.startsWith('smoke') || id.startsWith('sparks')) Object.assign(point, { x: side * 1.05, y: .16, z: 1.22 });
      else if (id === 'speed-lines') Object.assign(point, { x: 0, y: 2.1, z: -5 });
      else Object.assign(point, { x: side * .61, y: .42, z: 2.12 });
      rotateParticleVector3(point, q, point);
      const p = this.car.transform.position;
      s.setTransform(p.x + point.x, p.y + point.y, p.z + point.z, q);
      const motion = this.temp; Object.assign(motion, { x: 0, y: 0, z: -this.speed }); rotateParticleVector3(motion, q, motion);
      Object.assign(s.emitterVelocity, motion);
      s.intensity = this.envelope.value * (id.startsWith('smoke') ? .55 + Math.min(.8, Math.abs(this.path(this.distance).yaw) * 2) : 1);
      s.update(dt);
    }
    for (let i = 0; i < this.trails.length; i++) {
      const side = i % 2 ? 1 : -1, point = this.temp;
      Object.assign(point, { x: side * 1.12, y: i < 2 ? .52 : .48, z: .6 }); rotateParticleVector3(point, q, point);
      const p = this.car.transform.position;
      this.trails[i].update(dt, p.x + point.x, p.y + point.y, p.z + point.z, running && this.params.trails);
    }
  }
  draw(): void {
    this.updateCamera();
    for (let i = 0; i < this.systems.length; i++) {
      const ground = /^(smoke|sparks)/.test(this.systems[i].spec.id);
      this.renderers[i].render(this.camera, this.params.enabled && (!ground || this.params.ground) ? 1 : 0);
    }
    // Short historical trails are a secondary accent; the main wake wraps the whole vehicle.
    for (const r of this.ribbons) r.render(this.camera, this.params.trails && this.params.enabled ? .12 : 0);
    this.drawBodyFlow();
  }
  cycleCamera(): void { const modes = ['chase', 'side', 'front']; this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length]; this.draw(); }
  stats() {
    const snapshots = this.systems.map(s => s.snapshot()), p = this.car.transform.position;
    return { dimension: 3, particles: this.systems.reduce((a, s) => a + s.aliveCount, 0),
      poolCapacity: this.systems.reduce((a, s) => a + s.capacity, 0), trailPoints: this.trails.reduce((a, t) => a + t.pointCount, 0),
      meshSubmissions: this.renderers.reduce((a, r) => a + r.submittedBatches, 0) + this.ribbons.reduce((a, r) => a + r.submittedBatches, 0)
        + this.flows.reduce((a, f) => a + f.renderer.submittedBatches, 0),
      particleSnapshots: snapshots, ribbonHistory: this.trails.map(t => t.snapshot()),
      positionsFinite: snapshots.every(group => group.every(v => [v.x, v.y, v.z, v.vx, v.vy, v.vz].every(Number.isFinite))),
      speedKmh: this.speed * 3.6, carPosition: { x: p.x, y: p.y, z: p.z }, cameraMode: this.cameraMode,
      depthTest: this.renderers[0]?.node.meshRenderer.sharedMaterial.depthTest,
      depthWrite: this.renderers[0]?.node.meshRenderer.sharedMaterial.depthWrite,
      bodyFlow: this.flows.map(f => f.path.snapshot()),
      flowWindows: this.flows.map(f => ({ start: f.path.visibleStart, end: f.path.visibleEnd })),
      effectNodes: Array.from({length: this.scene.numChildren}, (_, i) => this.scene.getChildAt(i)).filter((n: any) => /^Zhuda(Particles|Ribbon)3D$/.test(n.name)).length, flowStrength: this.envelope.value,
      envelope: this.envelope.value };
  }
  private rebuild(): void {
    for (const r of this.renderers) r.dispose(); for (const r of this.ribbons) r.dispose();
    for (const f of this.flows) f.renderer.dispose();
    this.systems = this.descriptor().emitters.map(e => new ZhudaParticleSystem3D(e));
    this.renderers = this.systems.map(s => new ZhudaLayaParticleRenderer3D(s, this.scene, key => this.textures.get(key)));
    this.trails = [-1, 1, -1, 1].map((_, i) => new ZhudaRibbonTrail3D({ maxPoints: 128, lifetime: .7, width: i < 2 ? .34 : .065, minDistance: .05, teleportDistance: 25,
      widthOverLife: [{ time: 0, value: .5 }, { time: .15, value: 1 }, { time: 1, value: 0 }] }));
    this.ribbons = this.trails.map((t, i) => new ZhudaLayaRibbonRenderer3D(t, this.scene, this.textures.get('ribbon'), i < 2 ? '#3fa9d4' : '#c8fbff'));
    this.flows = this.flowSpecs.map(spec => {
      const path = new ZhudaRibbonPath3D(spec.ribbon); path.uvTiles = 2;
      return { path, spec, widthDirs: Array.from({ length: 64 }, () => ({ x: 0, y: 0, z: 0 })), points: Array.from({ length: 64 }, () => ({ x: 0, y: 0, z: 0 })),
        renderer: new ZhudaLayaRibbonRenderer3D(path, this.scene, this.textures.get('flow')) };
    });
    this.reset();
  }
  private path(s: number) {
    const x = 7 * Math.sin(s / 27) + 3 * Math.sin(s / 11), y = .35 * Math.sin(s / 35);
    const dx = 7 / 27 * Math.cos(s / 27) + 3 / 11 * Math.cos(s / 11), dy = .35 / 35 * Math.cos(s / 35);
    return { x, y, z: -s, yaw: -Math.atan(dx), pitch: Math.atan2(dy, Math.sqrt(1 + dx * dx)) };
  }
  private drawBodyFlow(): void {
    const power = this.params.enabled && this.params.trails ? this.envelope.value : 0;
    const q = this.car.transform.rotation, car = this.car.transform.position;
    for (let k = 0; k < this.flows.length; k++) {
      const f = this.flows[k], controls = f.spec.points as ParticleVector3[];
      if (power < .001) { f.path.clear(); f.renderer.render(this.camera, 0); continue; }
      for (let i = 0; i < f.points.length; i++) {
        const t = i / (f.points.length - 1), v = t * (controls.length - 1), index = Math.min(controls.length - 2, Math.floor(v)), u = v - index;
        const a = controls[Math.max(0, index - 1)], b = controls[index], c = controls[index + 1], d = controls[Math.min(controls.length - 1, index + 2)];
        const sample = (key: 'x' | 'y' | 'z') => .5 * ((2 * b[key]) + (-a[key] + c[key]) * u
          + (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * u * u + (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * u * u * u);
        const x = sample('x'), y = sample('y'), z = sample('z'), p = f.points[i];
        const dir = f.widthDirs[i]; dir.x = -(y - .6); dir.y = x; dir.z = 0;
        const flutter = Math.sin(t * 22 - this.time * 9 + k * 1.7) * (.016 + t * .045);
        if (z <= 2.2) {
          rotateParticleVector3(dir, q, dir);
          Object.assign(p, { x: x + flutter, y: y + flutter * .5, z }); rotateParticleVector3(p, q, p);
          p.x += car.x; p.y += car.y; p.z += car.z;
        } else {
          const old = this.path(this.distance - (z - 2.2)), c = Math.cos(old.yaw), sn = Math.sin(old.yaw);
          const dirX = dir.x; dir.x = c * dirX; dir.z = -sn * dirX;
          p.x = old.x + c * (x + flutter) + sn * 2.2; p.y = old.y + y + flutter * .5;
          p.z = old.z - sn * (x + flutter) + c * 2.2;
        }
      }
      f.path.visibleEnd = Math.min(1, Math.max(0, (this.time - .7) / .75));
      f.path.visibleStart = Math.min(f.path.visibleEnd, Math.max(0, (this.time - 5.6) / .65));
      f.path.uvOffset = -this.time * 1.7 + k * .13; f.path.setPoints(f.points, f.widthDirs);
      f.renderer.render(this.camera, power * .95);
    }
  }
  private moveCar(): void {
    const p = this.path(this.distance);
    this.car.transform.position = new Laya.Vector3(p.x, p.y + .02, p.z);
    this.car.transform.rotationEuler = new Laya.Vector3(p.pitch * 180 / Math.PI, p.yaw * 180 / Math.PI, p.yaw * this.envelope.value * -5);
    for (const wheel of this.wheels) wheel.transform.localRotationEulerX = this.distance / .4 * 180 / Math.PI;
  }
  private updateCamera(): void {
    const p = this.car.transform.position, q = this.car.transform.rotation, offset = this.temp;
    Object.assign(offset, this.cameraMode === 'side' ? { x: 7.6, y: 2.7, z: 4.5 } : this.cameraMode === 'front' ? { x: -1, y: 2.4, z: -8.6 } : { x: 2.2, y: 3, z: 9.5 });
    rotateParticleVector3(offset, q, offset); this.cameraPosition.setValue(p.x + offset.x, p.y + offset.y, p.z + offset.z);
    this.camera.transform.position = this.cameraPosition;
    Object.assign(offset, { x: 0, y: .7, z: this.cameraMode === 'front' ? 0 : -1.5 }); rotateParticleVector3(offset, q, offset);
    this.target.setValue(p.x + offset.x, p.y + offset.y, p.z + offset.z); this.camera.transform.lookAt(this.target, this.up, false);
    this.camera.fieldOfView = 54 + this.envelope.value * 7;
  }
  private material(color: string, lit = false): any {
    const mat = lit ? new Laya.BlinnPhongMaterial() : new Laya.UnlitMaterial(), c = parseInt(color.slice(1), 16);
    mat.albedoColor = new Laya.Color((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255, 1);
    if (lit) mat.shininess = .6; this.materials.push(mat); return mat;
  }
  private box(parent: any, size: number[], position: number[], material: any): any {
    const node = new Laya.MeshSprite3D(Laya.PrimitiveMesh.createBox(...size)); parent.addChild(node);
    node.meshRenderer.sharedMaterial = material; node.transform.localPosition = new Laya.Vector3(...position); return node;
  }
  private makeCar(): void {
    const paint = this.material('#ef7242', true), frame = this.material('#101c28', true), glass = this.material('#1c4056', true), trim = this.material('#b9dbdf', true);
    const white = this.material('#e0f8ff'), cyan = this.material('#62ddec'), red = this.material('#f54d44'), rubber = this.material('#090e16');
    this.box(this.car, [2.12, .42, 3.8], [0, .52, 0], paint);
    this.box(this.car, [2.25, .18, 4.15], [0, .24, 0], frame);
    this.box(this.car, [1.56, .62, 1.6], [0, 1.02, -.35], glass);
    this.box(this.car, [1.65, .1, 1.2], [0, 1.37, -.2], paint);
    this.box(this.car, [.18, .02, 1.2], [-.16, 1.43, -.2], white); this.box(this.car, [.18, .02, 1.2], [.16, 1.43, -.2], white);
    this.box(this.car, [.35, .02, 1], [0, .75, -1.35], white);
    this.box(this.car, [2.4, .1, .4], [0, 1.16, 1.6], frame);
    for (const side of [-1, 1]) {
      this.box(this.car, [.1, .55, .12], [side * .78, .88, 1.6], trim);
      this.box(this.car, [.53, .13, .06], [side * .7, .52, -1.94], white);
      this.box(this.car, [.62, .13, .06], [side * .66, .54, 1.94], red);
      this.box(this.car, [.38, .23, .18], [side * .61, .42, 2.04], frame);
      this.box(this.car, [.26, .11, .02], [side * .61, .42, 2.14], cyan);
      this.box(this.car, [.04, .12, 2.3], [side * 1.09, .39, .1], cyan);
      for (const z of [-1.22, 1.22]) {
        const group = new Laya.Sprite3D('wheel'); this.car.addChild(group); group.transform.localPosition = new Laya.Vector3(side * 1.08, .4, z); this.wheels.push(group);
        for (const [radius, height, mat] of [[.4, .34, rubber], [.22, .36, trim]] as any[]) {
          const wheel = new Laya.MeshSprite3D(Laya.PrimitiveMesh.createCylinder(radius, height, 16)); group.addChild(wheel);
          wheel.transform.localRotationEuler = new Laya.Vector3(0, 0, 90); wheel.meshRenderer.sharedMaterial = mat;
        }
      }
    }
  }
  private makeTrack(): void {
    const vertices: number[] = [], indices: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[], color: number[]) => {
      const i = vertices.length / 7; for (const p of [a, b, c, d]) vertices.push(...p, ...color, 1);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const strip = (s: number, end: number, left: number, right: number, height: number, color: number[]) => {
      const a = this.path(s), b = this.path(end);
      const point = (p: typeof a, side: number) => [p.x + Math.cos(p.yaw) * side, p.y + height, p.z - Math.sin(p.yaw) * side];
      quad(point(a, left), point(a, right), point(b, right), point(b, left), color);
    };
    for (let s = -70; s < 700; s += 3) {
      strip(s, s + 3, -6.6, 6.6, 0, s % 6 === 0 ? [.065, .09, .12] : [.072, .098, .13]);
      for (const side of [-1, 1]) {
        strip(s, s + 3, side * 6.2 - .055, side * 6.2 + .055, .012, side < 0 ? [.12, .65, .75] : [.9, .4, .22]);
        strip(s, s + 3, side * 6.65 - .25, side * 6.65 + .25, .015, Math.floor(s / 3) % 2 ? [.32, .4, .47] : [.13, .21, .29]);
        const a = this.path(s), b = this.path(s + 3), x = side * 7.1;
        quad([a.x + x, a.y, a.z], [b.x + x, b.y, b.z], [b.x + x, b.y + .65, b.z], [a.x + x, a.y + .65, a.z], [.075, .16, .22]);
      }
      if (Math.floor(s / 3) % 3 === 0) strip(s, s + 2, -.035, .035, .018, [.3, .4, .46]);
    }
    const material = this.material('#ffffff'); material.enableVertexColor = true; material.cull = Laya.RenderState.CULL_NONE;
    const mesh = Laya.PrimitiveMesh._createMesh(Laya.VertexMesh.getVertexDeclaration('POSITION,COLOR'), new Float32Array(vertices), new Uint16Array(indices));
    const road = new Laya.MeshSprite3D(mesh); road.name = '3D road'; road.meshRenderer.sharedMaterial = material; this.scene.addChild(road);
    const ground = this.box(this.scene, [2000, .1, 2000], [0, -1, -350], this.material('#07141f'));
    ground.name = 'Landscape';
    const supports = this.material('#19313e'), lamps = this.material('#88c7d6');
    for (let s = 0; s < 600; s += 24) {
      const p = this.path(s);
      for (const side of [-1, 1]) {
        this.box(this.scene, [.17, 4.5, .17], [p.x + side * 8, p.y + 2, p.z], supports);
        this.box(this.scene, [.2, .8, .2], [p.x + side * 8, p.y + 3.7, p.z], lamps);
      }
    }
  }
}
