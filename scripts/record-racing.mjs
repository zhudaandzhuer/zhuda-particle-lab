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
  const fps = Number(process.env.RECORD_FPS || 60);
  assert.ok(Number.isInteger(fps) && fps >= 24 && fps <= 120 && 120 % fps === 0, 'Capture FPS must divide the 120 Hz simulation step');
  const mode = process.env.CAMERA || 'chase';
  assert.ok(['chase','side','front'].includes(mode));
  await evaluate("lab.loop=false;lab.seek(0)");
  for(let i=0;await evaluate('lab.stats().cameraMode')!==mode && i<3;i++) await evaluate('lab.cycleCamera()');
  const bounds = await evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
  const frames=path.join(evidence,`racing3d-${mode}-${fps}fps-frames`);fs.mkdirSync(frames,{recursive:true});
  const times=[];
  for(let i=0;i<8*fps;i++) {
    await evaluate(`lab.seek(${i/fps})`);await frame();
    const actual=await evaluate('lab.time');assert.ok(Math.abs(actual-i/fps)<1e-7, 'Every frame must have the requested simulation time');times.push(actual);
    const {data}=await cdp('Page.captureScreenshot',{format:'png',clip:{...bounds,scale:1}});
    fs.writeFileSync(path.join(frames,`${String(i).padStart(4,'0')}.png`),Buffer.from(data,'base64'));
    if(i%fps===0)console.log(`Rendered ${i}/${8*fps} frames at ${fps} FPS`);
  }
  assert.deepEqual(errors,[], 'Browser runtime must not throw while rendering');
  const output=path.join(root,'exports',`3d-racing-airflow-${mode}-${fps}fps.mp4`);fs.mkdirSync(path.dirname(output),{recursive:true});
  execFileSync(process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',['-y','-loglevel','error','-framerate',String(fps),
    '-start_number','0','-i',path.join(frames,'%04d.png'),'-frames:v',String(8*fps),'-vf','scale=960:-2',
    '-c:v','libx264','-preset','slow','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart',output]);
  const metadata={createdAt:new Date().toISOString(),fps,frames:times.length,durationSeconds:8,camera:mode,sourceTimes:times,
    method:'Independent deterministic scene rendering for each frame, without frame interpolation or repeated-frame upsampling',output};
  fs.writeFileSync(path.join(evidence,`recording-${mode}-${fps}fps.json`),JSON.stringify(metadata,null,2));
  console.log(JSON.stringify({output,fps,frames:times.length,durationSeconds:8},null,2));
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server?.kill('SIGTERM');
  await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2500); } });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
