import { ZhudaEngine, ZhudaParticleSystem3D, ZhudaLayaParticleRenderer3D, ZhudaVfxCamera,
  ZhudaEffectDirector, ZhudaEffectBudget, ZhudaRuntimeProfiler, ZhudaParticleEventLink,
  convertUnityVisualMaterial, instantiateMigratedMaterial, disposeMigratedMaterial } from 'zhuda-laya-engine';
declare const Laya:any;
const W=960,H=660,STEP=1/120;
const profiler=new ZhudaRuntimeProfiler();
const getContext=HTMLCanvasElement.prototype.getContext;
(HTMLCanvasElement.prototype as any).getContext=function(kind:string,...args:any[]){const gl=getContext.call(this,kind as any,...args);if(gl&&['webgl','webgl2','experimental-webgl'].includes(kind)){profiler.attach(gl);}return gl;};
class CapabilityLab {
  mode='dissolve';time=0;paused=false;value=.4;
  scene=new Laya.Scene3D();camera=new Laya.Camera(0,.1,50);root:any;
  textures=new Map<string,any>();systems:any[]=[];renderers:any[]=[];links:any[]=[];owned:any[]=[];
  cameraPass:any;director:any;events=0;budget=new ZhudaEffectBudget({maxParticles:600,maxCoverage:3});allocation:any[]=[];
  emitterOverrides=new Map<string,any>();timelineOverride:any=null;
  async init(){
    Laya.stage.addChild(this.scene);this.scene.addChild(this.camera);this.camera.clearColor=new Laya.Color(.035,.055,.08,1);this.camera.fieldOfView=46;
    this.camera.transform.position=new Laya.Vector3(0,3.1,9);this.camera.transform.lookAt(new Laya.Vector3(0,1.2,0),new Laya.Vector3(0,1,0));
    this.scene.ambientMode=Laya.AmbientMode.SolidColor;this.scene.ambientColor=new Laya.Color(.5,.55,.6,1);
    const sun=new Laya.Sprite3D();this.scene.addChild(sun);const light=sun.addComponent(Laya.DirectionLightCom);light.intensity=1.5;sun.transform.rotationEuler=new Laya.Vector3(-40,-35,0);
    for(const key of ['white','noise','mask','checker','atlas','glow'])this.texture(key);
    this.setMode('dissolve');let previous=performance.now(),acc=0;
    const tick=(now:number)=>{const dt=Math.max(0,Math.min(.1,(now-previous)/1000)),begin=performance.now();previous=now;
      if(!this.paused){acc+=dt;while(acc>=STEP){this.advance(STEP);acc-=STEP;}}
      this.render();profiler.endFrame(dt*1000,performance.now()-begin);profiler.beginFrame();requestAnimationFrame(tick);
    };requestAnimationFrame(tick);(window as any).capabilities=this;
  }
  texture(key:string){if(this.textures.has(key))return this.textures.get(key);
    const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d')!;
    if(key==='noise'){const data=g.createImageData(256,256);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4,n=.5+.22*Math.sin(x*.065+Math.sin(y*.04)*3)+.15*Math.cos(y*.09+x*.025)+.1*Math.sin(x*.21-y*.17);data.data[i]=Math.round(n*255);data.data[i+1]=Math.round((.5+.4*Math.sin(y*.05+x*.1))*255);data.data[i+2]=128;data.data[i+3]=255;}g.putImageData(data,0,0);}
    else if(key==='atlas'){for(let i=0;i<16;i++){const x=(i%4)*64,y=Math.floor(i/4)*64;g.save();g.translate(x+32,y+32);const r=7+i*1.4,gradient=g.createRadialGradient(0,0,0,0,0,r);gradient.addColorStop(0,'white');gradient.addColorStop(.35,`hsl(${30+i*12},100%,60%)`);gradient.addColorStop(1,'transparent');g.fillStyle=gradient;g.fillRect(-32,-32,64,64);g.strokeStyle=`hsl(${30+i*12},100%,70%)`;g.lineWidth=3;g.beginPath();g.arc(0,0,r*.85,0,Math.PI*1.5);g.stroke();g.restore();}}
    else if(key==='checker'){for(let y=0;y<8;y++)for(let x=0;x<8;x++){g.fillStyle=(x+y)%2?'#48d9c2':'#124051';g.fillRect(x*32,y*32,32,32);}}
    else if(key==='mask'||key==='glow'){const gradient=g.createRadialGradient(128,128,key==='mask'?74:0,128,128,124);gradient.addColorStop(0,'white');gradient.addColorStop(1,key==='mask'?'black':'transparent');g.fillStyle=gradient;g.fillRect(0,0,256,256);}
    else {g.fillStyle='white';g.fillRect(0,0,256,256);}
    const t=new Laya.Texture2D(256,256,Laya.TextureFormat.R8G8B8A8,false,false);t.setPixelsData(g.getImageData(0,0,256,256).data,false,false);t.wrapModeU=t.wrapModeV=Laya.WrapMode.Repeat;t.lock=true;this.textures.set(key,t);return t;
  }
  box(x:number,y:number,z:number,w:number,h:number,d:number,texture?:string,color='#273e4b'){
    const n=new Laya.MeshSprite3D(Laya.PrimitiveMesh.createBox(w,h,d));n.transform.position=new Laya.Vector3(x,y,z);this.root.addChild(n);
    const m=new Laya.UnlitMaterial();const c=parseInt(color.slice(1),16);m.albedoColor=new Laya.Color((c>>16&255)/255,(c>>8&255)/255,(c&255)/255,1);if(texture)m.albedoTexture=this.texture(texture);n.meshRenderer.sharedMaterial=m;this.owned.push(m);return n;
  }
  particle(patch:any={},position=[0,1.8,0]){
    const spec={id:'capability-'+this.systems.length,texture:'glow',seed:42,maxParticles:512,space:'world',blend:'alpha',shape:{type:'point'},rate:0,lifetime:100,speed:0,size:3,direction:{x:0,y:1,z:0},spread:0,...patch};
    const s=new ZhudaParticleSystem3D(spec);s.setTransform(...position as [number,number,number]);const r=new ZhudaLayaParticleRenderer3D(s,this.root,key=>this.texture(key));this.systems.push(s);this.renderers.push(r);return s;
  }
  setMode(mode:string){
    if(!['dissolve','distortion','soft','bloom','flipbook','collision','timeline','budget','pbr'].includes(mode))throw new Error('Unknown capability.');
    for(const l of this.links)l.dispose();for(const r of this.renderers)r.dispose();for(const m of this.owned)disposeMigratedMaterial(m);this.cameraPass?.dispose();this.root?.destroy(true);
    this.mode=mode;this.time=0;this.events=0;this.systems=[];this.renderers=[];this.links=[];this.owned=[];this.director=null;this.allocation=[];
    this.root=new Laya.Sprite3D();this.scene.addChild(this.root);this.cameraPass=new ZhudaVfxCamera(this.camera,{softParticles:mode==='soft',refraction:mode==='distortion',...mode==='bloom'?{bloomIntensity:4}:{}});
    this.box(0,-.15,0,12,.2,8,undefined,'#132733');this.box(0,2,-1,7,4,.15,'checker','#ffffff');
    if(['dissolve','distortion','soft','bloom'].includes(mode)){
      const s=this.particle({texture:'white',material:{version:1,noiseTexture:'noise',maskTexture:'mask',edgeColor:'#ff9d35',dissolve:mode==='dissolve'?this.value:0,uvDistortion:mode==='distortion'?this.value*.1:0,refraction:mode==='distortion'?this.value*.15:0,uvScroll:{x:.08,y:.04},softDistance:mode==='soft'?this.value*3:0,intensity:mode==='bloom'?6:1}},[0,mode==='soft'?.6:1.9,0]);s.burst(1);
      if(mode==='soft')this.box(0,.5,.2,1.5,1,.6,undefined,'#2e6f7c');
    }else if(mode==='flipbook'){const s=this.particle({texture:'atlas',flipbook:{columns:4,rows:4,fps:12},size:3});s.burst(1);}
    else if(mode==='collision'){
      const rain=this.particle({texture:'glow',rate:50,lifetime:3,speed:[3,5],size:.07,shape:{type:'box',width:4,height:0,depth:1},direction:{x:0,y:-1,z:0},spread:.04,collision:{planes:[{normal:{x:0,y:1,z:0},offset:0}],killOnCollision:true}},[0,3.8,.5]);
      const splash=this.particle({texture:'glow',maxParticles:1024,lifetime:[.2,.5],size:.1,speed:[1,3],spread:1.2,acceleration:{x:0,y:-8,z:0},colorOverLife:[{time:0,color:'#4be7ff'},{time:1,color:'#205b84'}]});
      rain.onEvent=(e:any)=>{if(e.type==='collision')this.events++;};this.links.push(new ZhudaParticleEventLink(rain,splash,{event:'collision',count:6}));rain.play();
    }else if(mode==='timeline'){
      const s=this.particle({rate:100,lifetime:.5,speed:[1,2],size:.12,spread:1.5},[-2,1.5,0]);
      this.director=this.makeDirector(this.timelineOverride||{version:1,duration:3,loop:true,tracks:[{target:'fx',parameter:'intensity',keys:[{time:0,value:0},{time:.5,value:1},{time:2,value:1},{time:3,value:0}]}],cues:[{time:0,target:'fx',action:'start'},{time:2.5,target:'fx',action:'stop'}],attachments:[{target:'fx',source:'rig',anchor:'hand'}]});this.director.play(true);
    }else if(mode==='budget'){
      for(let i=0;i<8;i++){const s=this.particle({rate:250,lifetime:2,size:.12,speed:.7,spread:1.4},[(i%4-1.5)*1.5,1+Math.floor(i/4)*1.3,0]);s.play();}
      this.applyBudget(this.budget.spec.maxParticles);
    }else if(mode==='pbr'){
      for(let i=0;i<3;i++){const spec=convertUnityVisualMaterial({id:'pbr-'+i,shader:'Standard',color:[.18,.7,.65,1],metallic:i/2,smoothness:.25+i*.3});const m=instantiateMigratedMaterial(spec,key=>this.texture(key));const n=new Laya.MeshSprite3D(Laya.PrimitiveMesh.createSphere(.65));n.transform.position=new Laya.Vector3((i-1)*1.8,1.8,0);n.meshRenderer.sharedMaterial=m;this.root.addChild(n);this.owned.push(m);}
    }
    const override=this.emitterOverrides.get(mode);if(override)this.configureEmitter(override,false);
    this.render();
  }
  makeDirector(spec:any){
    if(spec?.tracks?.some((t:any)=>t.parameter!=='intensity'))throw new Error('This workbench exposes only the intensity parameter.');
    const s=this.systems[0];
    return new ZhudaEffectDirector(spec,{fx:{reset:()=>s.stop(true),start:()=>s.play(),stop:()=>s.stop(),setParameter:(name,v)=>{if(name!=='intensity')throw new Error('This adapter exposes intensity.');s.intensity=v;},setTransform:p=>s.setTransform(p.x,p.y,p.z||0)},rig:{reset(){},resolveAnchor:()=>({x:Math.sin(this.time*2)*2,y:1.5+Math.cos(this.time*2)*.6,z:0})}});
  }
  configureTimeline(spec:any){if(this.mode!=='timeline')throw new Error('Select timeline mode first.');const next=this.makeDirector(spec);this.director.stop();this.director=next;this.timelineOverride=JSON.parse(JSON.stringify(spec));this.time=0;next.play(true);this.paused=false;}
  configureEmitter(spec:any,remember=true){
    if(!this.systems.length)throw new Error('This material scene has no particle emitter.');
    if(this.mode==='collision'&&spec?.space!=='world')throw new Error('The collision demo requires a world-space source emitter.');
    // Validate descriptors and resolve every texture before replacing the current scene object.
    const next=new ZhudaParticleSystem3D(spec);for(const key of [spec.texture,spec.material?.maskTexture,spec.material?.noiseTexture].filter(Boolean))if(!this.textures.has(key))throw new Error('Unknown application texture: '+key);
    const renderer=new ZhudaLayaParticleRenderer3D(next,this.root,key=>this.textures.get(key));
    const previous=this.systems[0];next.setTransform(previous.transform.x,previous.transform.y,previous.transform.z);next.burst(1);next.play();
    const timeline=this.director?.spec;for(const link of this.links)link.dispose();this.links=[];this.director?.stop();this.director=null;this.renderers[0].dispose();this.systems[0]=next;this.renderers[0]=renderer;this.time=0;this.paused=false;
    if(this.mode==='collision'){next.onEvent=(e:any)=>{if(e.type==='collision')this.events++;};this.links.push(new ZhudaParticleEventLink(next,this.systems[1],{event:'collision',count:6}));}
    if(timeline){this.director=this.makeDirector(timeline);this.director.play(true);}
    if(this.mode==='budget')this.applyBudget(this.budget.spec.maxParticles);
    if(remember)this.emitterOverrides.set(this.mode,JSON.parse(JSON.stringify(spec)));
  }
  applyBudget(limit:number){this.budget=new ZhudaEffectBudget({maxParticles:limit,maxCoverage:3});this.allocation=this.budget.allocate(this.systems.map((s,i)=>({id:String(i),particles:500,coverage:.3,priority:10-i})));this.systems.forEach((s,i)=>{s.particleLimit=this.allocation[i].particleLimit;s.intensity=this.allocation[i].emissionScale;});}
  setValue(value:number){this.value=value;if(this.mode==='dissolve')this.renderers[0].vfxMaterial?.configure({dissolve:value});else if(this.mode==='distortion')this.renderers[0].vfxMaterial?.configure({refraction:value*.15,uvDistortion:value*.1});else if(this.mode==='soft')this.renderers[0].vfxMaterial?.configure({softDistance:value*3});else if(this.mode==='budget')this.applyBudget(Math.round(200+value*1800));}
  advance(dt:number){this.time+=dt;this.director?.update(dt);for(const s of this.systems)s.update(dt);}
  seek(t:number){this.setMode(this.mode);this.paused=true;for(let i=0;i<Math.round(t/STEP);i++)this.advance(STEP);this.render();}
  render(){for(const r of this.renderers)r.render(this.camera);}
  stats(){return{mode:this.mode,time:this.time,events:this.events,particles:this.systems.reduce((n,s)=>n+s.aliveCount,0),finite:this.systems.every(s=>s.snapshot().every(p=>[p.x,p.y,p.z].every(Number.isFinite))),allocations:this.allocation,profiler:profiler.report(),materials:this.owned.map(m=>({metallic:m.metallic,smoothness:m.smoothness})),camera:{depth:this.camera.depthTextureMode,opaque:this.camera.opaquePass}};}
  exportJSON(){return JSON.stringify({version:1,mode:this.mode,value:this.value,effects:this.systems.map((s,i)=>({...s.spec,...(this.renderers[i].vfxMaterial?{material:this.renderers[i].vfxMaterial.descriptor()}:{} )})),timeline:this.director?.spec||null},null,2);}
}
(async()=>{await ZhudaEngine.boot({width:W,height:H,bgColor:'#0b121a',features:['core','2d','ui','3d','postProcess']});const lab=new CapabilityLab();await lab.init();
  if(new URLSearchParams(location.search).get('devicecheck')==='1'){
    const cases=[];
    for(const mode of ['dissolve','distortion','soft','bloom','flipbook','collision','timeline','budget','pbr']){
      lab.setMode(mode);lab.paused=false;const samples=[];let last=performance.now();
      for(let i=0;i<90;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const now=performance.now();if(i>=30)samples.push(now-last);last=now;}
      const stats=lab.stats(),sorted=samples.sort((a,b)=>a-b),drawCalls=stats.profiler.samples.at(-1)?.drawCalls;
      const passed=stats.finite&&drawCalls>0&&(mode!=='collision'||stats.events>0)&&(mode!=='budget'||stats.particles<=600);
      cases.push({mode,passed,finite:stats.finite,particles:stats.particles,events:stats.events,frameP95Ms:sorted[Math.ceil(sorted.length*.95)-1],drawCalls,samples:samples.length});
    }
    const passed=cases.every(c=>c.passed),result={kind:'zhuda-device-capabilities',passed,userAgent:navigator.userAgent,pixelRatio:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},cases};(window as any).deviceReport=result;
    await fetch('/__device-report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result)});
    lab.setMode('collision');const text=document.createElement('p');text.textContent=(passed?'實機驗證通過':'實機驗證失敗')+' · '+cases.length+' 種能力';Object.assign(text.style,{position:'fixed',left:'12px',top:'12px',color:passed?'#a5efd0':'#ff9966',background:'#0b121add',padding:'10px',font:'14px system-ui',zIndex:'999'});document.body.append(text);
  }
})().catch(e=>{document.body.dataset.error=e.message;console.error(e);});
