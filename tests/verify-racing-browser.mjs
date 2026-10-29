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
  const brief = s => ({time:s.time,particles:s.particles,trailPoints:s.trailPoints,flowPoints:s.bodyFlow.reduce((a,p)=>a+p.length,0),
    flowWindows:s.flowWindows,meshSubmissions:s.meshSubmissions,drawCalls:s.drawCalls,positionsFinite:s.positionsFinite});
  for(const time of [.65,.8,1.05,1.5,3.5,5.7,7.8]) {
    await evaluate(`lab.seek(${time})`);await frame();const s=await evaluate('lab.stats()');
    assert.equal(s.dimension,3);assert.ok(s.webglContexts>0 && s.drawCalls>0);assert.ok(s.positionsFinite);
    assert.ok(s.particles<=s.poolCapacity);assert.equal(s.depthWrite,false);assert.equal(s.depthTest,await evaluate("document.getElementById('stage').contentWindow.Laya.RenderState.DEPTHTEST_LEQUAL"));
    assert.ok(s.bodyFlow.flat().every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
    report.samples[time]=brief(s);await shot('racing3d-'+time);
  }
  assert.equal(report.samples[.65].flowPoints,0);assert.equal(report.samples[7.8].flowPoints,0);
  assert.equal(report.samples[7.8].particles,0);assert.equal(report.samples[7.8].trailPoints,0);
  assert.ok(report.samples[.8].flowWindows[0].end<report.samples[1.05].flowWindows[0].end);
  assert.ok(report.samples[1.05].flowWindows[0].end<1);assert.equal(report.samples[1.5].flowWindows[0].end,1);
  assert.ok(report.samples[5.7].flowWindows[0].start>0);assert.ok(report.samples[5.7].particles>0);
  await evaluate('lab.seek(3.5)');const first=await evaluate('lab.stats()');
  assert.equal(first.bodyFlow.length,8);assert.ok(first.bodyFlow.every(p=>p.length===64));
  // Inspect path coverage in vehicle coordinates; points span the nose, both flanks, roof and wake.
  const local = await evaluate(`(()=>{const c=lab.racing.car.transform,p=c.position,q=c.rotation;return lab.stats().bodyFlow.flat().map(v=>{
    const x=v.x-p.x,y=v.y-p.y,z=v.z-p.z,tx=2*(-q.y*z+q.z*y),ty=2*(-q.z*x+q.x*z),tz=2*(-q.x*y+q.y*x);
    return {x:x+q.w*tx-q.y*tz+q.z*ty,y:y+q.w*ty-q.z*tx+q.x*tz,z:z+q.w*tz-q.x*ty+q.y*tx};});})()`);
  assert.ok(local.some(p=>p.z< -2.5),'Flow starts ahead of the nose');
  assert.ok(local.some(p=>p.x< -1 && p.z<1) && local.some(p=>p.x>1 && p.z<1),'Both flanks are wrapped');
  assert.ok(local.some(p=>p.y>1.5 && p.z<1),'Roof is wrapped');assert.ok(local.some(p=>p.z>8),'Wake extends behind the vehicle');
  await evaluate('lab.seek(3.5)');assert.deepEqual(await evaluate('lab.stats().particleSnapshots'),first.particleSnapshots);
  assert.deepEqual(await evaluate('lab.stats().bodyFlow'),first.bodyFlow);assert.deepEqual(await evaluate('lab.stats().ribbonHistory'),first.ribbonHistory);
  for(const mode of ['chase','side','front']) {
    for(let i=0;await evaluate('lab.stats().cameraMode')!==mode && i<3;i++)await evaluate('lab.cycleCamera()');
    await frame();assert.equal(await evaluate('lab.stats().cameraMode'),mode);
    assert.deepEqual(await evaluate('lab.stats().particleSnapshots'),first.particleSnapshots);
    assert.deepEqual(await evaluate('lab.stats().bodyFlow'),first.bodyFlow);await shot('racing3d-'+mode);
  }
  for(const toggle of ['trails','ground','enabled']) {
    const before=await evaluate('lab.stats().meshSubmissions');
    await evaluate(`lab.setParameters({${toggle}:false})`);await frame();
    assert.ok(await evaluate('lab.stats().meshSubmissions')<before);
    if(toggle==='trails')assert.equal(await evaluate('lab.stats().bodyFlow.flat().length'),0);
    if(toggle==='enabled')assert.equal(await evaluate('lab.stats().meshSubmissions'),0);
    await evaluate(`lab.setParameters({${toggle}:true})`);
  }
  const json=await evaluate('lab.exportJSON()');assert.equal(JSON.parse(json).dimension,3);
  await evaluate(`lab.importJSON(${JSON.stringify(json)});lab.seek(3.5)`);
  assert.equal(await evaluate('lab.exportJSON()'),json);assert.deepEqual(await evaluate('lab.stats().particleSnapshots'),first.particleSnapshots);
  const invalid=JSON.parse(json);invalid.emitters[0].direction={x:0,y:0,z:0};
  assert.equal(await evaluate(`(()=>{try{lab.importJSON(${JSON.stringify(JSON.stringify(invalid))});return false}catch{return true}})()`),true);
  assert.equal(await evaluate('lab.exportJSON()'),json);
  for(let i=0;i<12;i++) {
    await evaluate("lab.setPreset('sprint');lab.seek(1);lab.setPreset('racing3d');lab.seek(3.5)");
    assert.equal(await evaluate('lab.stats().effectNodes'),21,'Scene rebuild must not leak particle/ribbon nodes');
    assert.equal(await evaluate("[...lab.textures.values()].every(t=>!t.destroyed && !(t.bitmap||t).destroyed)"),true,'Shared textures must survive material destruction');
  }
  report.rebuilds=12;await shot('racing3d-after-rebuilds');
  await evaluate("lab.loop=false;lab.reset();while(lab.stats().cameraMode!=='chase')lab.cycleCamera()");
  const samples=[];
  for(let i=0;i<38;i++) {await delay(200);const s=await evaluate('lab.stats()');samples.push({time:s.time,particles:s.particles,cpuMs:s.cpuMs,drawCalls:s.drawCalls,frameP95:s.frameP95});}
  assert.ok(samples.at(-1).time>6);assert.ok(samples.some(s=>s.particles>0));
  report.performance={scope:'Desktop headless Chrome, real Laya 3D WebGL; no mobile performance claim',samples,
    peakParticles:Math.max(...samples.map(s=>s.particles)),peakDrawCalls:Math.max(...samples.map(s=>s.drawCalls)),
    maxSmoothedCpuMs:Math.max(...samples.map(s=>s.cpuMs)),frameP95Ms:samples.at(-1).frameP95};
  if(process.env.RECORD==='1') {
    const frames=path.join(evidence,'racing3d-frames');fs.mkdirSync(frames,{recursive:true});
    const bounds=await evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    const fps=Number(process.env.RECORD_FPS || 60);
    assert.ok(Number.isInteger(fps) && fps>=24 && fps<=120 && 120%fps===0);
    for(let i=0;i<8*fps;i++) {
      await evaluate(`lab.seek(${i/fps})`);await frame();const {data}=await cdp('Page.captureScreenshot',{format:'png',clip:{...bounds,scale:1}});
      fs.writeFileSync(path.join(frames,`${String(i).padStart(4,'0')}.png`),Buffer.from(data,'base64'));
    }
    report.video=path.join(evidence,'racing3d-cycle.mp4');execFileSync(process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',
      ['-y','-loglevel','error','-framerate',String(fps),'-i',path.join(frames,'%04d.png'),'-vf','scale=960:-2','-c:v','libx264','-pix_fmt','yuv420p','-crf','21','-movflags','+faststart',report.video]);
  }
  assert.deepEqual(errors,[],'No browser runtime exceptions');report.passed=true;
  fs.writeFileSync(path.join(evidence,'racing-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,rebuilds:report.rebuilds,performance:report.performance,evidence},null,2));
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server?.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2500); } });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
