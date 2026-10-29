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

  const manifest=await evaluate('effectCatalog');
  assert.equal(manifest.total,100);assert.equal(manifest.categories.length,10);
  assert.equal(await evaluate('document.querySelectorAll("[data-preset]").length'),100);
  const folder=path.join(evidence,'catalog');fs.mkdirSync(folder,{recursive:true});
  const bounds=await evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
  const capture=async file=>{await frame();const {data}=await cdp('Page.captureScreenshot',{format:'png',clip:{...bounds,scale:1}});fs.writeFileSync(path.join(folder,file),Buffer.from(data,'base64'));};
  report.entries=[];
  for(const e of manifest.entries){
    await evaluate(`lab.setPreset(${JSON.stringify(e.id)});lab.seek(${e.inspectAt})`);await frame();
    const s=await evaluate('lab.stats()');
    assert.ok(s.webglContexts>0&&s.drawCalls>0,`${e.id}: real WebGL`);
    assert.ok(s.particles>0&&s.particles<=s.poolCapacity,`${e.id}: particles ${s.particles}/${s.poolCapacity}`);
    assert.ok(s.positionsFinite&&s.meshSubmissions>0,`${e.id}: finite and submitted`);
    const saved=await evaluate('lab.stats().particleSnapshots');
    await evaluate(`lab.seek(${e.inspectAt})`);
    assert.deepEqual(await evaluate('lab.stats().particleSnapshots'),saved,`${e.id}: deterministic replay`);
    await capture(e.id+'.png');
    await evaluate('lab.setParameters({enabled:false})');await capture(e.id+'-off.png');
    await evaluate('lab.setParameters({enabled:true})');
    const json=await evaluate('lab.exportJSON()');
    assert.equal(await evaluate(`lab.importJSON(${JSON.stringify(json)});lab.exportJSON()`),json,`${e.id}: JSON roundtrip`);
    if(e.renderer==='library'){
      await evaluate(`lab.seek(${e.inspectAt})`);
      assert.deepEqual(await evaluate('lab.stats().particleSnapshots'),saved,`${e.id}: motion bindings roundtrip`);
    }
    const before=await evaluate('lab.stats().particleSnapshots');await evaluate(`lab.seek(${e.inspectAt+.1})`);
    assert.notDeepEqual(await evaluate('lab.stats().particleSnapshots'),before,`${e.id}: animation advances`);
    report.entries.push({id:e.id,title:e.title,number:e.number,category:e.category,dimension:s.dimension,particles:s.particles,poolCapacity:s.poolCapacity,meshSubmissions:s.meshSubmissions,drawCalls:s.drawCalls,nodes:s.effectNodes});
    if(e.number%10===0)console.log(`Verified ${e.number}/100: ${e.title}`);
  }
  for(const c of manifest.categories){
    await evaluate(`(()=>{const e=document.getElementById('category');e.value=${JSON.stringify(c.id)};e.dispatchEvent(new Event('change'));})()`);
    assert.equal(await evaluate('document.querySelectorAll("[data-preset]:not([hidden])").length'),10);
  }
  await evaluate("(()=>{document.getElementById('category').value='all';document.getElementById('search').value='噴泉';document.getElementById('search').dispatchEvent(new Event('input'));})()");
  assert.equal(await evaluate('document.querySelectorAll("[data-preset]:not([hidden])").length'),3);
  await evaluate("(()=>{document.getElementById('search').value='';document.getElementById('search').dispatchEvent(new Event('input'));})()");
  await evaluate("lab.setPreset('fountain3d');lab.seek(2.5)");
  const intact=await evaluate('lab.exportJSON()');
  for(const bad of [{schemaVersion:1,dimension:3,emitters:[{}]}, {...JSON.parse(intact),labPreview:{version:1,bindings:{bad:{period:0}}}}]){
    assert.equal(await evaluate(`(()=>{try{lab.importJSON(${JSON.stringify(JSON.stringify(bad))});return false}catch{return true}})()`),true);
    assert.equal(await evaluate('lab.exportJSON()'),intact);
  }
  const nodes=[];
  for(let i=0;i<25;i++){
    await evaluate("lab.setPreset('fire3d');lab.seek(2.5);lab.setPreset('rain');lab.seek(2);lab.setPreset('racing3d');lab.seek(2);lab.setPreset('portal3d');lab.seek(2)");
    const s=await evaluate('lab.stats()');nodes.push([s.sceneNodes,s.scene2DNodes,s.effectNodes]);
    assert.ok(await evaluate('[...lab.textures.values()].every(t=>!t.destroyed&&(!t.bitmap||!t.bitmap.destroyed))'));
  }
  assert.ok(nodes.every(n=>JSON.stringify(n)===JSON.stringify(nodes[0])),'Scene nodes must remain bounded across switching');report.switchNodes=nodes[0];
  for(const id of ['fountain','rain','fire3d','fountain3d','meteor3d']){
    await evaluate(`lab.setPreset('${id}');lab.seek(5.65)`);assert.ok(await evaluate('lab.stats().particles')>0,`${id}: graceful stop`);
    await evaluate('lab.seek(8)');assert.equal(await evaluate('lab.stats().particles'),0,`${id}: drain after stop`);
  }
  await evaluate("lab.setPreset('meteor3d');lab.seek(2)");
  await evaluate('lab.setParameters({trails:false})');await frame();assert.equal(await evaluate('lab.stats().meshSubmissions'),0);
  await evaluate('lab.setParameters({trails:true,density:1.5,velocity:1.3,lifetime:1.2})');
  assert.equal(await evaluate('lab.params.density'),1.5);
  await evaluate("lab.setParameters({density:1,velocity:1,lifetime:1});lab.setPreset('fountain3d');lab.seek(2.5)");
  const camera=await evaluate('lab.stats().cameraMode');await evaluate('lab.cycleCamera()');assert.notEqual(await evaluate('lab.stats().cameraMode'),camera);
  report.livePlayback=[];
  for(const id of ['rain','campfire','healing','warp3d','fountain3d']){
    await evaluate(`lab.setPreset('${id}');lab.seek(.9);lab.frameTimes=[];lab.paused=false`);
    await delay(1500);const s=await evaluate('lab.paused=true;lab.stats()');
    assert.ok(s.time>2&&s.particles>0&&s.drawCalls>0&&s.positionsFinite,`${id}: live playback advances`);
    report.livePlayback.push({id,time:s.time,particles:s.particles,cpuMs:s.cpuMs,drawCalls:s.drawCalls,frameP95:s.frameP95});
  }
  report.passed=true;report.total=100;report.dimensionCounts={twoD:91,threeD:9};
  await evaluate("document.querySelector('[data-preset=\"portal\"]').click();lab.seek(2.5)");await shot('library-interface');
  assert.equal(errors.length,0,JSON.stringify(errors));
  fs.writeFileSync(path.join(evidence,'catalog-report.json'),JSON.stringify(report,null,2));
  console.log('100 effects passed real WebGL, deterministic replay, motion, import/export, search, drain and repeated switching.');
} catch (error) {
  fs.writeFileSync(path.join(evidence,'catalog-failure.json'),JSON.stringify({message:error.stack,errors},null,2));throw error;
} finally {socket?.close();chrome.kill('SIGTERM');server?.kill('SIGTERM');await delay(300);fs.rmSync(profile,{recursive:true,force:true});}
