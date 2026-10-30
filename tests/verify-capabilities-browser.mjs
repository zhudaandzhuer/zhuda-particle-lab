import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Development integration test, using an isolated Chrome profile and the real Laya WebGL runtime.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zhuda-particle-qa-'));
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.env.CAPABILITIES_URL || 'http://localhost:8897/zhuda-particle-lab/capabilities.html';
let server, socket;
try { await fetch(url); } catch {
  server = spawn(process.execPath, ['scripts/server.mjs'], { cwd: root, stdio: 'ignore', env:{...process.env,PORT:'8897',BASE_PATH:'/zhuda-particle-lab'} });
  for (let i = 0; i < 100; i++) { try { await fetch(url); break; } catch { await delay(100); } }
}
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });
const errors = [];
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type==='error') errors.push(m.params.args.map(a=>a.value||a.description));
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
  const stageShot = async name => {
    await frame();
    const clip=await evaluate('(()=>{const r=document.getElementById("stage").getBoundingClientRect();return {x:r.x+scrollX+2,y:r.y+scrollY+2,width:r.width-4,height:r.height-4,scale:1}})()');
    const {data}=await cdp('Page.captureScreenshot',{format:'png',clip});
    fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(data,'base64'));return data;
  };
  const pixelDifference = (a,b) => evaluate(`(async()=>{
    const images=await Promise.all(${JSON.stringify([a,b])}.map(data=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src='data:image/png;base64,'+data;})));
    const c=document.createElement('canvas');c.width=images[0].width;c.height=images[0].height;const g=c.getContext('2d');
    const pixels=images.map(i=>{g.clearRect(0,0,c.width,c.height);g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;});
    let changed=0;for(let i=0;i<pixels[0].length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(pixels[0][i+k]-pixels[1][i+k])))>20)changed++;
    return {changedPixels:changed,totalPixels:c.width*c.height};
  })()`);
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url});
  for(let i=0;i<200;i++){if(await evaluate('!!window.capabilities'))break;await delay(100);}
  assert.ok(await evaluate('!!window.capabilities'),await evaluate('document.getElementById("stage").contentDocument.body.dataset.error'));
  const cases=[];
  for(const mode of ['dissolve','distortion','soft','bloom','flipbook','collision','timeline','budget','pbr']){
    await evaluate(`document.querySelector('[data-mode="${mode}"]').click();capabilities.seek(2)`);await frame();
    await delay(350);const s=await evaluate('capabilities.stats()');assert.ok(s.finite);assert.ok(s.profiler.samples.slice(-5).every(s=>s.drawCalls>0),'Actual WebGL calls in the active mode');
    if(mode==='collision'){assert.ok(s.events>0);assert.ok(s.particles>0);}
    if(mode==='pbr')assert.deepEqual(s.materials.filter(m=>typeof m.metallic==='number').map(m=>m.metallic),[0,.5,1]);
    if(mode==='budget'){assert.ok(s.particles<=600);assert.equal(s.allocations.reduce((n,a)=>n+a.particleLimit,0),600);}
    await shot('capability-'+mode);cases.push({mode,particles:s.particles,events:s.events});
  }
  const pixels={};
  for(const mode of ['dissolve','distortion','soft']){
    await evaluate(`capabilities.setMode('${mode}');capabilities.seek(.7);capabilities.setValue(0)`);const off=await stageShot('capability-'+mode+'-off');
    await evaluate('capabilities.setValue(1)');const on=await stageShot('capability-'+mode+'-on');
    pixels[mode]=await pixelDifference(off,on);assert.ok(pixels[mode].changedPixels>500,mode+' must visibly change the rendered stage');
  }
  await evaluate("capabilities.setMode('flipbook');capabilities.seek(.05)");const flipA=await stageShot('capability-flipbook-a');
  await evaluate("capabilities.seek(.4)");const flipB=await stageShot('capability-flipbook-b');pixels.flipbook=await pixelDifference(flipA,flipB);assert.ok(pixels.flipbook.changedPixels>500,'Atlas animation must visibly advance');
  await evaluate("capabilities.setMode('bloom');capabilities.seek(.7);capabilities.camera.postProcess.enable=false");const bloomOff=await stageShot('capability-bloom-off');
  await evaluate('capabilities.camera.postProcess.enable=true');const bloomOn=await stageShot('capability-bloom-on');pixels.bloom=await pixelDifference(bloomOff,bloomOn);assert.ok(pixels.bloom.changedPixels>500,'Bloom must spread light beyond the source');
  await evaluate("capabilities.setMode('timeline');const t=JSON.parse(capabilities.exportJSON()).timeline;t.duration=4;capabilities.configureTimeline(t);const e=JSON.parse(capabilities.exportJSON()).effects[0];e.rate=73;capabilities.configureEmitter(e);capabilities.seek(1)");
  const edited=await evaluate('JSON.parse(capabilities.exportJSON())');assert.equal(edited.effects[0].rate,73);assert.equal(edited.timeline.duration,4);assert.ok(await evaluate('capabilities.stats().particles>0'));
  assert.ok(await evaluate("(()=>{const s=capabilities.systems[0];try{capabilities.configureEmitter({})}catch{return capabilities.systems[0]===s}return false})()"),'Invalid edits preserve the active emitter');
  await evaluate("capabilities.setMode('collision');capabilities.configureEmitter(JSON.parse(capabilities.exportJSON()).effects[0]);capabilities.seek(2)");assert.ok(await evaluate('capabilities.stats().events>0'),'Emitter edits retain collision links');
  for(let i=0;i<12;i++)await evaluate("capabilities.setMode('collision');capabilities.seek(.4);capabilities.setMode('dissolve');capabilities.seek(.3)");
  assert.ok(await evaluate('[...capabilities.textures.values()].every(t=>!t.destroyed)'),'Borrowed textures survive scene rebuilds');
  assert.equal(await evaluate('capabilities.scene.numChildren'),3,'Camera, light and one owned root');
  assert.deepEqual(await evaluate('capabilities.stats().camera'),{depth:0,opaque:false},'Additional camera passes are restored after leaving VFX modes');
  for(const width of [390,1440]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:width<500});await delay(300);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Workbench fits its viewport');
  }
  const sample=await evaluate('capabilities.stats()');assert.deepEqual(errors,[],'No browser exceptions');
  fs.writeFileSync(path.join(evidence,'capabilities-verification.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),userAgent:await evaluate('navigator.userAgent'),url,cases,pixels,profiler:sample.profiler,sceneSwitches:24,editorReplay:true},null,2));
  console.log(JSON.stringify({passed:true,url,cases,pixels,sceneSwitches:24,editorReplay:true},null,2));

} finally {
  socket?.close();chrome.kill('SIGTERM');server?.kill('SIGTERM');await delay(300);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
