import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Development integration test, using an isolated Chrome profile and the real Laya WebGL runtime.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zhuda-particle-qa-'));
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.env.LAB_URL || 'http://localhost:8894/';
let server, socket;
try { await fetch(url); } catch {
  server = spawn(process.execPath, ['scripts/server.mjs'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await fetch(url); break; } catch { await delay(100); } }
}
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
const errors = [], report = { checkedAt: new Date().toISOString(), url, presets: {}, samples: {} };
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 150; i++) await delay(100);
  assert.ok(fs.existsSync(portFile), 'Chrome remote debugging did not start');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p?.reject(new Error(JSON.stringify(m.error))); else p?.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const frame = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
  const shot = async name => {
    await delay(150); await frame(); const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(data, 'base64'));
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  for (let i = 0; i < 200; i++) { if (await evaluate('!!window.lab')) break; await delay(100); }
  assert.ok(await evaluate('!!window.lab'), 'Particle Lab failed to boot');
  const brief = s => ({ particles: s.particles, trailPoints: s.trailPoints, poolCapacity: s.poolCapacity,
    meshSubmissions: s.meshSubmissions, drawCalls: s.drawCalls, positionsFinite: s.positionsFinite });
  for (const [preset, time] of Object.entries({ sprint: 3.5, fire: 2.5, smoke: 3.5, explosion: 0.9, snow: 3.8, coins: 2.5, magic: 2.5 })) {
    await evaluate(`document.querySelector('[data-preset="${preset}"]').click();lab.seek(${time});`);
    await frame(); const stats = await evaluate('lab.stats()');
    assert.ok(stats.webglContexts > 0, 'Must use real WebGL');
    assert.ok(stats.particles > 0 && stats.particles <= stats.poolCapacity, `${preset} must emit within its budget`);
    assert.equal(stats.positionsFinite, true); assert.ok(stats.drawCalls > 0);
    assert.ok(stats.meshSubmissions > 0, `${preset} must submit textured geometry`);
    assert.equal(await evaluate(`document.querySelector('[data-preset="${preset}"]').classList.contains('selected')`), true);
    report.presets[preset] = brief(stats); await shot(preset);
  }
  await evaluate("document.querySelector('[data-preset=\"sprint\"]').click();lab.seek(3.5)");
  const first = await evaluate('lab.stats()');
  await evaluate('lab.seek(3.5)');
  assert.deepEqual(await evaluate('lab.stats().particleSnapshots'), first.particleSnapshots, 'Seeded seek must replay exactly');
  assert.deepEqual(await evaluate('lab.stats().ribbonHistory'), first.ribbonHistory);
  const trail = first.ribbonHistory[0]; assert.ok(trail.length > 20);
  const headings = trail.slice(1).map((p, i) => Math.atan2(p.y - trail[i].y, p.x - trail[i].x));
  assert.ok(Math.max(...headings) - Math.min(...headings) > .1, 'Turning must preserve a curved world path');
  await shot('sprint-turn');
  for (const time of [.8, 2, 5.65, 7.8]) {
    await evaluate(`lab.seek(${time})`); await frame();
    report.samples[time] = brief(await evaluate('lab.stats()')); await shot('sprint-' + time);
  }
  assert.ok(report.samples[5.65].particles > 0, 'Stop must allow existing particles to drain');
  assert.equal(report.samples[7.8].particles, 0); assert.equal(report.samples[7.8].trailPoints, 0);
  await evaluate('lab.seek(2)'); const pausedTime = await evaluate('lab.time'); await delay(180);
  assert.equal(await evaluate('lab.time'), pausedTime, 'Paused scene must remain still');
  for (const toggle of ['trails', 'ground', 'enabled']) {
    const submissions = await evaluate('lab.stats().meshSubmissions');
    await evaluate(`document.getElementById('${toggle}').click()`); await frame();
    assert.equal(await evaluate(`lab.params.${toggle}`), false);
    assert.ok(await evaluate('lab.stats().meshSubmissions') < submissions, `${toggle} must reduce visible mesh submissions`);
    if (toggle === 'enabled') assert.equal(await evaluate('lab.stats().meshSubmissions'), 0);
    await evaluate(`document.getElementById('${toggle}').click()`);
  }
  const exported = await evaluate('lab.exportJSON()');
  assert.equal(await evaluate(`lab.importJSON(${JSON.stringify(exported)});lab.exportJSON()`), exported);
  const beforeInvalid = await evaluate('lab.exportJSON()');
  assert.equal(await evaluate("(()=>{try{lab.importJSON('{\"schemaVersion\":1,\"emitters\":[{}]}');return false}catch{return true}})()"), true);
  assert.equal(await evaluate('lab.exportJSON()'), beforeInvalid, 'Failed import must preserve the current effect');
  for (const key of ['density', 'velocity', 'lifetime']) {
    await evaluate(`(()=>{const el=document.getElementById('${key}');el.value='1.4';el.dispatchEvent(new Event('input'));})()`);
    assert.equal(await evaluate(`lab.params.${key}`), 1.4);
  }
  // Measure actual playback, not forced seek. Frame intervals include GPU/OS scheduling;
  // CPU update+submit measures only the demo's simulation and command construction.
  await evaluate("lab.setParameters({density:1,velocity:1,lifetime:1});document.querySelector('[data-preset=\"sprint\"]').click();lab.loop=false;lab.reset();");
  const performanceSamples = [];
  for (let i = 0; i < 34; i++) {
    await delay(200); const s = await evaluate('lab.stats()');
    performanceSamples.push({ time: s.time, cpuMs: s.cpuMs, frameP95: s.frameP95, drawCalls: s.drawCalls, particles: s.particles });
  }
  assert.ok(performanceSamples.at(-1).time > 5, 'Real playback must advance');
  assert.ok(performanceSamples.some(s => s.particles > 0 && s.drawCalls > 1));
  report.performance = { scope: 'Desktop headless Chrome, real WebGL; no mobile performance claim',
    userAgent: await evaluate('navigator.userAgent'), samples: performanceSamples,
    peakParticles: Math.max(...performanceSamples.map(s => s.particles)),
    peakDrawCalls: Math.max(...performanceSamples.map(s => s.drawCalls)),
    maxSmoothedCpuMs: Math.max(...performanceSamples.map(s => s.cpuMs)),
    frameP95Ms: performanceSamples.at(-1).frameP95 };

  const stress = { schemaVersion: 1, emitters: [{ id: 'load-test', texture: 'glow', seed: 478,
    space: 'world', blend: 'additive', shape: { type: 'box', width: 400, height: 200 },
    maxParticles: 4096, rate: 2000, lifetime: 2, speed: [10, 80], angle: [0, 6.283185307], size: [3, 10],
    alphaOverLife: [{ time: 0, value: 0 }, { time: .1, value: .5 }, { time: 1, value: 0 }] }] };
  await evaluate(`lab.importJSON(${JSON.stringify(JSON.stringify(stress))});lab.seek(3);lab.paused=false;`);
  const load = [];
  for (let i = 0; i < 12; i++) {
    await delay(150); const s = await evaluate('lab.stats()');
    assert.ok(s.positionsFinite && s.particles <= s.poolCapacity);
    load.push({ particles: s.particles, cpuMs: s.cpuMs, drawCalls: s.drawCalls, frameP95: s.frameP95 });
  }
  assert.ok(load.every(s => s.particles >= 3900), 'Load test must sustain about 4000 live particles');
  report.loadTest = { targetParticles: 4000, samples: load,
    maxSmoothedCpuMs: Math.max(...load.map(s => s.cpuMs)), peakDrawCalls: Math.max(...load.map(s => s.drawCalls)),
    frameP95Ms: load.at(-1).frameP95 };

  if (process.env.RECORD === '1') {
    const frames = path.join(evidence, 'sprint-frames'); fs.mkdirSync(frames, { recursive: true });
    await evaluate("document.querySelector('[data-preset=\"sprint\"]').click();lab.seek(0)");
    const bounds = await evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    for (let i = 0; i < 160; i++) {
      await evaluate(`lab.seek(${i / 20})`); await frame();
      const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { ...bounds, scale: 1 } });
      fs.writeFileSync(path.join(frames, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
    }
    const video = path.join(evidence, 'sprint-cycle.mp4');
    execFileSync(process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '20',
      '-i', path.join(frames, '%04d.png'), '-vf', 'scale=960:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-crf', '22', '-movflags', '+faststart', video]);
    report.video = video;
  }
  assert.deepEqual(errors, [], 'Browser runtime must not throw');
  report.passed = true;
  fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, presets: report.presets, performance: report.performance,
    loadTest: report.loadTest, evidence }, null, 2));
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server?.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2500); } });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
