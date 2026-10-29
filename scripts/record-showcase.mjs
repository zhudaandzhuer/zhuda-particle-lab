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
const url = process.env.LAB_URL || 'http://localhost:8894/stage.html';
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 960, height: 660, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  for (let i = 0; i < 200; i++) { if (await evaluate('!!window.particleLab')) break; await delay(100); }
  assert.ok(await evaluate('!!window.particleLab'), 'Particle Lab failed to boot');
  await evaluate('window.lab=window.particleLab;lab.loop=false;lab.seek(0)');
  const fps=60, total=4*fps, media=path.join(root,'docs/media'), work=path.join(evidence,'showcase');
  fs.mkdirSync(media,{recursive:true});fs.mkdirSync(work,{recursive:true});
  const clips=[
    {id:'chase',preset:'racing3d',camera:'chase',start:1.1,seconds:3,scale:1},
    {id:'side',preset:'racing3d',camera:'side',start:1.5,seconds:3,scale:1},
    {id:'front',preset:'racing3d',camera:'front',start:1.3,seconds:3,scale:1},
    ...['portal','holy','vortex','healing'].map(preset=>({id:preset,preset,start:1.1,seconds:4,scale:.5})),
    ...['fireball','critical','frost','explosion3d'].map((preset,i)=>({id:preset,preset,start:.7166666666666667,seconds:4,scale:.5,period:.65,phase:i*.15}))
  ];
  const metadata=[];
  for(const clip of clips){
    if(process.env.REUSE_CAPTURE==='1'&&!(process.env.RECAPTURE_IMPACT==='1'&&clip.period)){
      const existing=path.join(work,clip.id),count=Math.round(clip.seconds*fps);
      assert.equal(fs.readdirSync(existing).filter(f=>/^\d{4}\.png$/.test(f)).length,count,'Reused capture must be complete');
      metadata.push({...clip,frames:count,captureReused:true});continue;
    }
    await evaluate(`lab.setPreset(${JSON.stringify(clip.preset)});lab.seek(${clip.start+(clip.phase||0)})`);
    if(clip.camera)for(let i=0;await evaluate('lab.stats().cameraMode')!==clip.camera&&i<3;i++)await evaluate('lab.cycleCamera()');
    const folder=path.join(work,clip.id);fs.mkdirSync(folder,{recursive:true});
    let peakParticles=0,frameCount=Math.round(clip.seconds*fps);
    for(let i=0;i<frameCount;i++){
      if(i){
        if(clip.period&&(i+Math.round((clip.phase||0)*fps))%Math.round(clip.period*fps)===0)await evaluate(`lab.seek(${clip.start})`);
        else await evaluate('lab.advance(1/120);lab.advance(1/120);lab.draw()');
      }
      await frame();
      const s=await evaluate('lab.stats()');
      assert.ok(s.positionsFinite&&s.particles<=s.poolCapacity);
      const expected=clip.start+(clip.period?((i+Math.round((clip.phase||0)*fps))%Math.round(clip.period*fps))/fps:i/fps);
      assert.ok(Math.abs(s.time-expected)<1e-6,`${clip.id} frame ${i}: simulation time drift`);
      peakParticles=Math.max(peakParticles,s.particles);
      const {data}=await cdp('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:960,height:660,scale:clip.scale}});
      fs.writeFileSync(path.join(folder,`${String(i).padStart(4,'0')}.png`),Buffer.from(data,'base64'));
    }
    assert.ok(peakParticles>0);metadata.push({...clip,frames:frameCount,peakParticles});
    console.log(`Rendered ${clip.id}: ${frameCount} independent 60 fps frames`);
  }
  assert.deepEqual(errors,[],'No browser errors during capture');
  const ffmpeg=process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg';
  execFileSync(process.env.PYTHON_PATH||'python3',[path.join(root,'scripts/showcase-overlays.py')],{stdio:'inherit'});
  const encode=['-c:v','libx264','-preset','slow','-crf','20','-pix_fmt','yuv420p','-r','60','-movflags','+faststart'];
  const run=args=>execFileSync(ffmpeg,['-y','-loglevel','error',...args],{stdio:'inherit'});
  const segments=[];
  for(const mode of ['chase','side','front']){
    const out=path.join(work,mode+'.mp4');
    run(['-framerate','60','-i',path.join(work,mode,'%04d.png'),'-loop','1','-framerate','60','-i',path.join(work,mode+'-overlay.png'),'-filter_complex','[0:v]scale=1280:880[v];[v][1:v]overlay=shortest=1:format=auto,format=yuv420p','-frames:v','180',...encode,out]);segments.push(out);
  }
  for(const group of [
    {name:'magic',title:'MAGIC IN MOTION',ids:['portal','holy','vortex','healing'],labels:['PORTAL / RUNE GATE','HOLY / LIGHT COLUMN','VORTEX / ATTRACTION','HEALING / RESTORATION']},
    {name:'impact',title:'IMPACT / BURST / AFTERMATH',ids:['fireball','critical','frost','explosion3d'],labels:['FIREBALL / HIT','CRITICAL / FLASH','FROST / SHATTER','3D / SPHERICAL EXPLOSION']}
  ]){
    const args=[];for(const id of group.ids)args.push('-framerate','60','-i',path.join(work,id,'%04d.png'));
    args.push('-loop','1','-framerate','60','-i',path.join(work,group.name+'-overlay.png'));
    const filter='[0:v][1:v][2:v][3:v]xstack=inputs=4:layout=0_0|480_0|0_330|480_330,scale=1280:880[v];[v][4:v]overlay=shortest=1:format=auto,format=yuv420p';
    const out=path.join(work,group.name+'.mp4');run([...args,'-filter_complex',filter,'-frames:v','240',...encode,out]);segments.push(out);
  }
  const list=path.join(work,'concat.txt');fs.writeFileSync(list,segments.map(f=>`file '${f}'`).join('\n')+'\n');
  const output=path.join(media,'showcase-60fps.mp4');run(['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',output]);
  run(['-ss','2.0','-i',output,'-frames:v','1','-update','1',path.join(media,'showcase-poster.jpg')]);
  // Eight seconds of real motion for GitHub README, which supports animated images.
  run(['-i',output,'-filter_complex',
    "[0:v]split=4[a][b][c][d];[a]trim=start=0.5:end=3,setpts=PTS-STARTPTS[a1];[b]trim=start=3.5:end=5,setpts=PTS-STARTPTS[b1];[c]trim=start=9.5:end=11.5,setpts=PTS-STARTPTS[c1];[d]trim=start=13:end=15,setpts=PTS-STARTPTS[d1];[a1][b1][c1][d1]concat=n=4:v=1:a=0,fps=24,scale=640:440:flags=lanczos,split[x][z];[x]palettegen=max_colors=128:stats_mode=diff[p];[z][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    '-loop','0',path.join(media,'showcase-preview.gif')]);
  fs.writeFileSync(path.join(media,'recording.json'),JSON.stringify({fps,width:1280,height:880,durationSeconds:17,frames:1020,
    simulationHz:120,method:'Actual WebGL frame capture at 60 fps, with two fixed simulation steps per output frame. Impact examples replay every 0.65 seconds, with staggered onsets across panels. No interpolated or upsampled frames.',clips:metadata},null,2)+'\n');
  console.log(`Created ${output} and GitHub animated preview.`);
} finally {
  socket?.close();chrome.kill('SIGTERM');server?.kill('SIGTERM');
  await new Promise(resolve=>{if(chrome.exitCode!==null)resolve();else{chrome.once('exit',resolve);setTimeout(resolve,2500);}});
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
