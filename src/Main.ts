import { textureCanvas } from './TextureFactory';
import { LIBRARY_TEXTURE_KEYS } from './LibraryTextures';
import { LibraryScene } from './LibraryScene';
import { ZhudaEngine, ZhudaParticleSystem, ZhudaLayaParticleRenderer, ZhudaRibbonTrail,
  ZhudaLayaRibbonRenderer, ZhudaEffectEnvelope, validateParticleEffect } from 'zhuda-laya-engine';
import type { ParticleEffectSpec } from 'zhuda-laya-engine';
import { RacingScene3D } from './RacingScene3D';
declare const Laya: any;

const W = 960, H = 660, STEP = 1 / 120;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Count actual WebGL draw calls, rather than labelling mesh submissions as draw calls.
const glStats = { current: 0, last: 0, contexts: 0 };
const getContext = HTMLCanvasElement.prototype.getContext;
(HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: any[]) {
  const gl: any = getContext.call(this, type as any, ...args);
  if (gl && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') && !gl.__particleLabCounter) {
    gl.__particleLabCounter = true; glStats.contexts++;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      if (typeof gl[name] !== 'function') continue;
      const original = gl[name].bind(gl);
      gl[name] = (...values: any[]) => { glStats.current++; return original(...values); };
    }
  }
  return gl;
};


class ParticleLab {
  preset = 'sprint';
  time = 0;
  paused = false;
  loop = true;
  params = { density: 1, velocity: 1, lifetime: 1, trails: true, ground: true, enabled: true };
  readonly textures = new Map<string, any>();
  readonly root = new Laya.Sprite();
  readonly background = new Laya.Sprite();
  readonly world = new Laya.Sprite();
  readonly ribbonLayer = new Laya.Sprite();
  readonly particleLayer = new Laya.Sprite();
  readonly actor = new Laya.Sprite();
  readonly overlay = new Laya.Sprite();
  catalog: any;
  private libraryEffects: Record<string, any>;
  private library: LibraryScene;
  private libraryActive = false;
  private presets: Record<string, ParticleEffectSpec>;
  private baseSpec: ParticleEffectSpec;
  private systems: ZhudaParticleSystem[] = [];
  private renderers: ZhudaLayaParticleRenderer[] = [];
  private trails: ZhudaRibbonTrail[] = [];
  private ribbons: ZhudaLayaRibbonRenderer[] = [];
  private envelope = new ZhudaEffectEnvelope(.16, .48);
  private racing: RacingScene3D;
  private get is3D() { return this.preset === 'racing3d' || this.preset === 'custom3d'; }
  private active = false;
  private accumulator = 0;
  private x = 0; private y = 0; private heading = 0;
  private cpuMs = 0;
  private frameTimes: number[] = [];
  private get effectActive() { return this.time >= .7 && this.time < 5.6; }

  async start(): Promise<void> {
    const bundle = await (await fetch('assets/effects/catalog-bundle.json')).json();
    this.catalog = bundle.manifest; this.libraryEffects = bundle.effects;
    this.presets = await (await fetch('assets/effects/presets.json')).json();
    for (const [name, spec] of Object.entries(this.presets)) {
      const issues = validateParticleEffect(spec); if (issues.length) throw new Error(`${name}: ${issues.join(' | ')}`);
    }
    for (const key of ['glow', 'streak', 'smoke', 'coin', 'snow', 'flame', 'ribbon', 'flow', ...LIBRARY_TEXTURE_KEYS]) {
      let texture: any;
      if (key === 'flow') {
        texture = new Laya.Texture2D(128, 64, Laya.TextureFormat.R8G8B8A8, false, false);
        const pixels = new Uint8Array(128 * 64 * 4);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
          const u = x / 128, v = y / 63, wave = .035 * Math.sin(u * Math.PI * 2);
          const main = Math.exp(-Math.pow((v - .5 - wave) / .12, 2));
          const fine = Math.exp(-Math.pow((v - .27 - .045 * Math.sin(u * Math.PI * 4)) / .022, 2));
          const haze = Math.pow(Math.sin(v * Math.PI), 2);
          const alpha = .50 * main + .23 * fine + .15 * haze;
          const i = (y * 128 + x) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 255; pixels[i + 3] = Math.round(alpha * 255);
        }
        texture.setPixelsData(pixels, false, false); texture.wrapModeU = Laya.WrapMode.Repeat;
      } else texture = await Laya.loader.load({ url: textureCanvas(key).toDataURL(), type: Laya.Loader.IMAGE });
      if (!texture) throw new Error(`Texture failed: ${key}`);
      texture.lock = true; if (texture.bitmap) texture.bitmap.lock = true;
      this.textures.set(key, texture);
    }
    Laya.stage.addChild(this.root); this.root.addChild(this.background); this.root.addChild(this.world);
    this.world.addChild(this.ribbonLayer); this.world.addChild(this.particleLayer); this.world.addChild(this.actor);
    this.root.addChild(this.overlay);
    this.racing = new RacingScene3D(this.textures); await this.racing.load();
    this.library = new LibraryScene(this.textures);
    this.setPreset('racing3d');
    let previous = performance.now();
    const tick = (now: number) => {
      glStats.last = glStats.current; glStats.current = 0;
      const dt = Math.min(.1, (now - previous) / 1000); previous = now;
      if (dt > 0) { this.frameTimes.push(dt * 1000); if (this.frameTimes.length > 240) this.frameTimes.shift(); }
      const begin = performance.now();
      if (!this.paused) {
        this.accumulator += dt;
        while (this.accumulator + 1e-10 >= STEP) {
          if (this.time >= 8) { if (this.loop) this.reset(false); else { this.paused = true; this.accumulator = 0; break; } }
          this.advance(STEP); this.accumulator -= STEP;
        }
      }
      this.draw(); this.cpuMs = this.cpuMs * .92 + (performance.now() - begin) * .08;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as any).particleLab = this;
    document.body.dataset.ready = 'true';
  }
  setPreset(name: string): void {
    const entry = this.catalog.entries.find((e: any) => e.id === name);
    if (entry?.renderer === 'library') {
      this.library.configure(this.libraryEffects[name], this.params);
      this.libraryActive = true; this.preset = name; this.root.visible = false; this.racing.scene.active = false; this.reset(); return;
    }
    if (name !== 'racing3d' && !this.presets[name]) throw new Error('Unknown preset.');
    this.libraryActive = false; this.library.deactivate();
    if (name === 'racing3d') {
      this.preset = name; this.racing.usePreset(this.params); this.root.visible = false; this.racing.scene.active = true; this.reset(); return;
    }
    if (!this.presets[name]) throw new Error('Unknown preset.');
    this.root.visible = true; this.racing.scene.active = false;
    this.preset = name; this.baseSpec = clone(this.presets[name]); this.rebuild(); this.paused = false;
  }
  setParameters(patch: Partial<typeof this.params>): void {
    for (const k of ['density', 'velocity', 'lifetime']) if (patch[k] !== undefined && (!Number.isFinite(patch[k]) || patch[k] < .1 || patch[k] > 3)) throw new Error('Parameter outside limits.');
    Object.assign(this.params, patch); const t = this.time, paused = this.paused;
    if (this.libraryActive) this.library.updateParameters(this.params); else if (this.is3D) this.racing.updateParameters(this.params); else this.rebuild();
    this.seek(t); this.paused = paused;
  }
  cycleCamera(): void { if (this.libraryActive) this.library.cycleCamera(); else if (this.is3D) this.racing.cycleCamera(); }
  exportJSON(): string { return JSON.stringify(this.libraryActive ? this.library.descriptor() : this.is3D ? this.racing.descriptor() : this.descriptor(), null, 2); }
  importJSON(text: string): void {
    const spec = JSON.parse(text);
    if (spec?.labPreview) {
      this.library.configure(spec, { ...this.params, density: 1, velocity: 1, lifetime: 1 });
      this.params.density = this.params.velocity = this.params.lifetime = 1;
      this.libraryActive = true; this.preset = 'custom-library'; this.root.visible = false; this.racing.scene.active = false; this.reset(); return;
    }
    if (spec?.dimension === 3) {
      // configure validates before changing scene state or any editor parameters.
      this.racing.configure(spec, { ...this.params, density: 1, velocity: 1, lifetime: 1 });
      this.libraryActive = false; this.library.deactivate();
      this.params.density = this.params.velocity = this.params.lifetime = 1;
      this.preset = 'custom3d'; this.root.visible = false; this.racing.scene.active = true; this.reset(); return;
    }
    const issues = validateParticleEffect(spec);
    if (issues.length) throw new Error(issues.join(' | '));
    for (const e of spec.emitters) if (!this.textures.has(e.texture)) throw new Error(`Unknown demo texture: ${e.texture}`);
    this.libraryActive = false; this.library.deactivate();
    this.baseSpec = clone(spec); this.params.density = this.params.velocity = this.params.lifetime = 1;
    this.preset = 'custom'; this.root.visible = true; this.racing.scene.active = false; this.rebuild();
  }
  reset(unpause = true): void {
    this.time = 0; this.x = 0; this.y = 0; this.heading = 0; this.active = false; this.envelope.reset();
    for (const system of this.systems) { system.stop(true); system.setTransform(0, 0); }
    for (const trail of this.trails) trail.clear();
    if (this.libraryActive) this.library.reset(); else if (this.is3D) this.racing.reset();
    if (unpause) { this.accumulator = 0; this.paused = false; }
    this.draw();
  }
  seek(time: number): void {
    if (!Number.isFinite(time)) throw new Error('Invalid timeline position.');
    this.reset(false); this.accumulator = 0; this.paused = true;
    const steps = Math.round(Math.max(0, Math.min(8, time)) / STEP);
    for (let i = 0; i < steps; i++) this.advance(STEP);
    this.draw();
  }
  stats() {
    const frames = [...this.frameTimes].sort((a, b) => a - b);
    const phase = this.time < .7 ? '準備' : this.time < .9 ? '啟動爆發' : this.time >= 5.6 ? '停止發射 · 自然消散'
      : this.preset !== 'sprint' ? (this.preset === 'explosion' ? '爆發擴散 · 餘燼' : '持續發射')
      : this.time < 3 ? '直線衝刺' : this.time < 4.7 ? '轉彎 · 保留路徑' : '持續衝刺';
    return { preset: this.preset, time: this.time, phase, particles: this.systems.reduce((n, s) => n + s.aliveCount, 0),
      trailPoints: this.trails.reduce((n, t) => n + t.pointCount, 0), cpuMs: this.cpuMs,
      frameP95: frames[Math.floor(frames.length * .95)] || 0, drawCalls: glStats.last, webglContexts: glStats.contexts,
      meshSubmissions: this.renderers.reduce((n, r) => n + r.submittedBatches, 0) + this.ribbons.reduce((n, r) => n + r.submittedBatches, 0),
      poolCapacity: this.systems.reduce((n, s) => n + s.capacity, 0), envelope: this.envelope.value,
      positionsFinite: this.systems.every(s => s.snapshot().every(p => Number.isFinite(p.x) && Number.isFinite(p.y))),
      ribbonHistory: this.trails.map(t => t.snapshot()), particleSnapshots: this.systems.map(s => s.snapshot()),
      hasTrails: this.preset === 'sprint', hasGround: this.preset === 'sprint',
      dimension: 2, ...(this.libraryActive ? this.library.stats() : this.is3D ? { ...this.racing.stats(), hasTrails: true, hasGround: true, phase: this.time < .7 ? '3D 巡航' : this.time < 3 ? '車頭起流 · 包覆車體'
        : this.time < 5.6 ? '彎道暴衝 · 三維氣流' : '鬆開油門 · 自然消散' } : {}) };
  }
  private descriptor(): ParticleEffectSpec {
    const spec = clone(this.baseSpec);
    const scale = (range: number | [number, number], factor: number) => Array.isArray(range) ? range.map(v => v * factor) as [number, number] : range * factor;
    for (const e of spec.emitters) {
      e.rate *= this.params.density;
      e.bursts?.forEach(b => b.count = Math.round(b.count * this.params.density));
      e.speed = scale(e.speed, this.params.velocity); e.lifetime = scale(e.lifetime, this.params.lifetime);
    }
    return spec;
  }
  private rebuild(): void {
    for (const renderer of this.renderers) renderer.dispose();
    for (const ribbon of this.ribbons) ribbon.dispose();
    this.systems = this.descriptor().emitters.map(e => new ZhudaParticleSystem(e));
    this.renderers = this.systems.map(s => new ZhudaLayaParticleRenderer(s, this.particleLayer, key => this.textures.get(key)));
    this.trails = [-1, 1, -1, 1].map((_, i) => new ZhudaRibbonTrail({ maxPoints: 128, lifetime: .8, width: i < 2 ? 34 : 7, minDistance: 1.5, teleportDistance: 180,
      widthOverLife: [{ time: 0, value: .8 }, { time: .3, value: 1 }, { time: 1, value: 0 }] }));
    this.ribbons = this.trails.map((t, i) => new ZhudaLayaRibbonRenderer(t, this.ribbonLayer, this.textures.get('ribbon'),
      i < 2 ? '#39c9bd' : '#e5fff2', i < 2 ? 'alpha' : 'additive'));
    this.reset();
  }
  private advance(dt: number): void {
    this.time += dt;
    if (this.libraryActive) { this.library.advance(dt, this.time); return; }
    if (this.is3D) { this.racing.advance(dt, this.time); return; }
    const next = this.effectActive;
    if (next && !this.active) { this.envelope.start(); for (const s of this.systems) s.play(); }
    if (!next && this.active) { this.envelope.stop(); for (const s of this.systems) s.stop(); }
    this.active = next; this.envelope.update(dt);
    this.heading = this.time > 3 && this.time < 4.7 ? Math.sin((this.time - 3) / 1.7 * Math.PI) * .65 : 0;
    if (this.preset === 'sprint') {
      const speed = 65 + this.envelope.value * 270;
      this.x += Math.sin(this.heading) * speed * dt; this.y -= Math.cos(this.heading) * speed * dt;
    }
    const c = Math.cos(this.heading), sn = Math.sin(this.heading);
    for (const s of this.systems) {
      let px = 0, py = 0, angle = 0;
      if (this.preset === 'sprint') {
        const side = s.spec.id === 'wake-left' ? -19 : s.spec.id === 'wake-right' ? 19 : 0;
        px = this.x + side * c - 25 * sn; py = this.y + side * sn + 25 * c; angle = this.heading;
      } else if (this.preset === 'snow') { py = -300; }
      s.setTransform(px, py, angle);
      s.intensity = s.spec.bursts?.length ? 1 : this.envelope.value;
      s.update(dt);
    }
    for (let i = 0; i < this.trails.length; i++) {
      const side = i % 2 === 0 ? -19 : 19;
      this.trails[i].update(dt, this.x + side * c - 22 * sn, this.y + side * sn + 22 * c,
        this.preset === 'sprint' && next && this.params.trails);
    }
  }
  private draw(): void {
    if (this.libraryActive) { this.library.draw(); return; }
    if (this.is3D) { this.racing.draw(); return; }
    const sprint = this.preset === 'sprint';
    const zoom = sprint || this.preset === 'snow' ? 1 : this.preset === 'coins' ? 1.2 : 1.65;
    this.world.scale(zoom, zoom);
    this.world.pos(sprint ? W / 2 - this.x * .8 : W / 2, sprint ? 280 - this.y : 420);
    const bg = this.background.graphics; bg.clear();
    bg.drawRect(0, 0, W, H, sprint ? '#b0c8c0' : '#152833');
    if (sprint) this.drawTrack(bg);
    else {
      for (let x = 0; x < W; x += 48) bg.drawLine(x, 0, x, H, '#1b3440', 1);
      for (let y = 0; y < H; y += 48) bg.drawLine(0, y, W, y, '#1b3440', 1);
      if (this.preset !== 'snow') {
        bg.drawEllipse(W / 2, 420, 155, 28, '#10222b', '#284552', 1);
        bg.drawEllipse(W / 2, 420, 115, 16, null, '#315460', 1);
      }
      if (this.preset === 'magic' && this.params.enabled && this.envelope.value > .05) {
        bg.drawCircle(W / 2, 420, 92 * zoom, null, '#8f71b7', 1.5);
        bg.drawCircle(W / 2, 420, 82 * zoom, null, '#524f7d', 1);
        for (let i = 0; i < 12; i++) {
          const a = i * Math.PI / 6 + this.time * .12;
          bg.drawLine(W / 2 + Math.cos(a) * 78 * zoom, 420 + Math.sin(a) * 78 * zoom,
            W / 2 + Math.cos(a) * 86 * zoom, 420 + Math.sin(a) * 86 * zoom, '#8f71b7', 2);
        }
      }
    }
    this.actor.visible = sprint; this.actor.pos(this.x, this.y); this.actor.rotation = this.heading * 180 / Math.PI;
    if (sprint) this.drawActor();
    for (let i = 0; i < this.systems.length; i++) {
      const ground = this.systems[i].spec.id.startsWith('ground-');
      this.renderers[i].render(this.params.enabled && (!ground || this.params.ground) ? 1 : 0);
    }
    for (const ribbon of this.ribbons) ribbon.render(sprint && this.params.trails && this.params.enabled ? .9 : 0);
    this.drawOverlay();
  }
  private drawTrack(g: any): void {
    const center = W / 2 - this.x * .8;
    g.drawRect(center - 254, 0, 508, H, '#d6d6b7');
    g.drawRect(center - 230, 0, 460, H, '#e6dfbd');
    g.drawRect(center - 197, 0, 394, H, '#e9e2c5');
    g.drawLine(center - 228, 0, center - 228, H, '#eee9d2', 4);
    g.drawLine(center + 228, 0, center + 228, H, '#eee9d2', 4);
    const offset = ((-this.y) % 100 + 100) % 100;
    for (let y = -100; y < H + 100; y += 100) {
      const yy = y + offset;
      g.drawRect(center - 2, yy, 4, 36, '#c9c6a5');
      for (const side of [-1, 1]) {
        g.drawRect(center + side * 242 - 4, yy, 8, 40, '#bd735e');
        g.drawRect(center + side * 242 - 4, yy + 40, 8, 40, '#f4ecd5');
        g.drawCircle(center + side * 315, yy + 20, 29, '#93aea4');
        g.drawCircle(center + side * 310, yy + 14, 22, '#a0bcb0');
      }
    }
    g.drawRect(0, 0, W, 50, '#00000010');
  }
  private drawActor(): void {
    const g = this.actor.graphics; g.clear();
    g.drawEllipse(7, 18, 27, 47, '#2b4d492c');
    // Stylised top-down test vehicle; no borrowed game assets.
    g.drawRoundRect(-10, -37, 20, 20, 7, 7, 7, 7, '#20383e');
    g.drawRoundRect(-10, 25, 20, 29, 7, 7, 7, 7, '#20383e');
    g.drawPoly(0, 0, [-17, 30, -22, -14, -10, -40, 0, -48, 10, -40, 22, -14, 17, 30], '#205766', '#143b49', 2);
    g.drawPoly(0, 0, [-12, 21, -14, -9, 0, -33, 14, -9, 12, 21, 0, 32], '#58c4ba');
    g.drawLine(0, 5, 0, 27, '#b4f1d5', 3);
    g.drawRoundRect(-25, 13, 10, 22, 3, 3, 3, 3, '#23434d'); g.drawRoundRect(15, 13, 10, 22, 3, 3, 3, 3, '#23434d');
    const power = this.envelope.value;
    if (this.params.enabled && power > 0) {
      g.drawEllipse(-19, 29, 3, 6 * power, '#c1fff0'); g.drawEllipse(19, 29, 3, 6 * power, '#c1fff0');
    }
    g.drawRoundRect(-17, -5, 34, 23, 8, 8, 8, 8, '#20404d');
    g.drawCircle(0, -18, 15, '#f6bd7b', '#24505c', 3);
    g.drawPoly(0, 0, [-12, -22, -7, -31, 6, -31, 13, -20, 9, -14, -9, -14], '#d9eee0');
    g.drawLine(-7, -20, 7, -20, '#285c67', 4);
  }
  private drawOverlay(): void {
    const g = this.overlay.graphics; g.clear();
    if (this.preset === 'sprint' && this.params.enabled && this.envelope.value > .05) {
      for (let i = 0; i < 12; i++) {
        const left = i % 2 === 0, x = left ? 32 + i * 7 : W - 30 - i * 7;
        const y = (i * 97 + this.time * 600) % H;
        g.drawLine(x, y, x + (left ? -7 : 7), y + 20 + this.envelope.value * 35, '#f8fff342', 1 + (i % 3 === 0 ? 1 : 0));
      }
    }
  }
}

(async () => {
  await ZhudaEngine.boot({ width: W, height: H, bgColor: '#152833', features: ['core', '2d', 'ui', '3d'] });
  const lab = new ParticleLab(); await lab.start();
})().catch(error => { document.body.dataset.error = error.message; console.error(error); });
