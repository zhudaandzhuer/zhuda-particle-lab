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
const url = process.env.SHOWCASE_URL || 'http://localhost:8896/zhuda-particle-lab/showcase.html';
let server, socket;
try { await fetch(url); } catch {
  server = spawn(process.execPath, ['scripts/server.mjs'], { cwd: root, stdio: 'ignore', env:{...process.env,PORT:'8896',BASE_PATH:'/zhuda-particle-lab'} });
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
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  for (let i=0;i<200;i++){if(await evaluate('document.querySelector("video")?.readyState>=2'))break;await delay(100);}
  for (let i=0;i<50;i++){if(await evaluate('!document.querySelector("video").paused'))break;await delay(100);}
  const video=await evaluate('(()=>{const v=document.querySelector("video");return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,muted:v.muted,loop:v.loop,paused:v.paused,time:v.currentTime}})()');
  assert.equal(video.width,1280);assert.equal(video.height,880);assert.equal(video.duration,17);assert.ok(video.muted&&video.loop&&!video.paused,JSON.stringify(video));
  await delay(700);assert.ok(await evaluate('document.querySelector("video").currentTime')>video.time,'Autoplay must show advancing frames');
  await shot('published-home-desktop');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  const labURL=await evaluate('document.querySelector(".primary").href');
  const galleryURL=new URL('catalog.html',url).href;
  for(const size of [{width:390,height:844},{width:1440,height:1100}]){
    await cdp('Emulation.setDeviceMetricsOverride',{...size,deviceScaleFactor:1,mobile:size.width<500});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Homepage must fit viewport');
    if(size.width<500)await shot('published-home-mobile');
  }
  await cdp('Page.navigate',{url:galleryURL});
  for(let i=0;i<100;i++){if(await evaluate('document.querySelectorAll("a.card").length===100'))break;await delay(100);}
  assert.equal(await evaluate('document.querySelectorAll("a.card").length'),100);
  const base=new URL('./',url).pathname;
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('a.card')).every(a=>new URL(a.href).pathname===${JSON.stringify(base)})`),'Gallery links must retain repository subpath');
  const assets=await evaluate('Promise.all(Array.from(document.querySelectorAll("img")).map(async i=>({src:i.getAttribute("src"),status:(await fetch(i.src)).status})))');
  assert.equal(assets.length,100);assert.ok(assets.every(a=>a.status===200));
  const chosen=await evaluate("document.querySelector('a[href*=\"effect=fountain3d\"]').href");
  await cdp('Page.navigate',{url:chosen});
  for(let i=0;i<200;i++){if(await evaluate('!!window.lab&&lab.preset==="fountain3d"'))break;await delay(100);}
  assert.equal(await evaluate('lab.preset'),'fountain3d');
  await evaluate('lab.seek(2.5)');await frame();const stats=await evaluate('lab.stats()');
  assert.ok(stats.particles>0&&stats.positionsFinite&&stats.drawCalls>0);await shot('published-live-lab');
  assert.equal(new URL(labURL).pathname,base);
  assert.deepEqual(errors,[],'Publication must have no browser exceptions');
  fs.writeFileSync(path.join(evidence,'publication-verification.json'),JSON.stringify({passed:true,url,video,galleryAssets:100,selectedPreset:'fountain3d',subpath:base},null,2));
  console.log(JSON.stringify({passed:true,url,video,galleryAssets:100,selectedPreset:'fountain3d',subpath:base},null,2));
} finally {
  socket?.close();chrome.kill('SIGTERM');server?.kill('SIGTERM');await delay(300);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
