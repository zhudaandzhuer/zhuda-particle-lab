import { ZhudaParticleSystem, ZhudaLayaParticleRenderer, ZhudaParticleSystem3D,
  ZhudaLayaParticleRenderer3D, validateParticleEffect, validateParticleEffect3D } from 'zhuda-laya-engine';
declare const Laya: any;
type Parameters = { density:number; velocity:number; lifetime:number; trails:boolean; ground:boolean; enabled:boolean };
const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v));
const motions = ['sway','sweep','spin','orbit','projectile','scan'];

// This scene adapter, its contextual props and every recipe live outside the engine.
export class LibraryScene {
  readonly root = new Laya.Sprite();
  readonly scene = new Laya.Scene3D();
  readonly camera = new Laya.Camera(0,.05,100);
  private background = new Laya.Sprite();
  private world = new Laya.Sprite();
  private actor = new Laya.Sprite();
  private layer = new Laya.Sprite();
  private systems:any[] = [];
  private renderers:any[] = [];
  private spec:any;
  private params:Parameters;
  private time=0;
  private running=false;
  private groups = new Map<string,any>();
  private floor:any;
  cameraMode='orbit';
  get dimension() { return this.spec?.dimension === 3 ? 3 : 2; }
  constructor(private readonly textures:Map<string,any>) {
    Laya.stage.addChild(this.root); this.root.name='Independent particle library 2D';
    this.root.addChild(this.background); this.root.addChild(this.world);
    this.world.addChild(this.actor); this.world.addChild(this.layer);
    Laya.stage.addChild(this.scene); this.scene.name='Independent particle library 3D';
    this.scene.addChild(this.camera); this.camera.fieldOfView=50;
    this.camera.clearColor=new Laya.Color(.025,.052,.08,1);
    this.scene.ambientMode=Laya.AmbientMode.SolidColor;this.scene.ambientColor=new Laya.Color(.55,.65,.75,1);
    const light=new Laya.Sprite3D('Library light');this.scene.addChild(light);
    light.addComponent(Laya.DirectionLightCom).intensity=1.2;light.transform.rotationEuler=new Laya.Vector3(-40,-25,0);
    this.make3DContext();this.deactivate();
  }
  configure(spec:any, params:Parameters):void {
    const issues=(spec?.dimension===3?validateParticleEffect3D:validateParticleEffect)(spec);
    if(issues.length)throw new Error(issues.join(' | '));
    for(const e of spec.emitters)if(!this.textures.has(e.texture))throw new Error(`Unknown demo texture: ${e.texture}`);
    const p=spec.labPreview;
    if(!p || p.version!==1 || !p.bindings || typeof p.bindings!=='object' || Array.isArray(p.bindings))throw new Error('Invalid scene preview.');
    if(p.zoom!==undefined && (!Number.isFinite(p.zoom)||p.zoom<.25||p.zoom>2))throw new Error('Preview zoom must be .25..2.');
    for(const b of Object.values(p.bindings) as any[]) {
      if(!b||typeof b!=='object')throw new Error('Invalid emitter binding.');
      if(b.motion && !motions.includes(b.motion))throw new Error('Unknown emitter motion.');
      for(const k of ['x','y','z','radius','frequency','phase','ellipse','period'])if(b[k]!==undefined&&(!Number.isFinite(b[k])||Math.abs(b[k])>10000))throw new Error('Invalid binding number.');
      if(b.period!==undefined && b.period<=0)throw new Error('Motion period must be positive.');
    }
    // All data is validated before replacing the visible effect.
    this.spec=clone(spec);this.params=params;this.rebuild();
    this.root.visible=this.dimension===2;this.scene.active=this.dimension===3;
    this.background2D();this.context2D();
    for(const [key,group] of this.groups)group.active=key===p.actor;
    this.floor.active=!['tunnel','sky'].includes(p.actor);
    this.reset();
  }
  deactivate():void {this.root.visible=false;this.scene.active=false;}
  descriptor():any {
    const s=clone(this.spec),p=this.params;
    const scale=(v:any,n:number)=>Array.isArray(v)?v.map(x=>x*n):v*n;
    for(const e of s.emitters){e.rate*=p.density;e.bursts?.forEach((b:any)=>b.count=Math.round(b.count*p.density));e.speed=scale(e.speed,p.velocity);e.lifetime=scale(e.lifetime,p.lifetime);}
    return s;
  }
  updateParameters(params:Parameters):void {this.params=params;this.rebuild();}
  private rebuild():void {
    for(const r of this.renderers)r.dispose();
    this.systems=this.descriptor().emitters.map((e:any)=>this.dimension===3?new ZhudaParticleSystem3D(e):new ZhudaParticleSystem(e));
    this.renderers=this.systems.map(s=>this.dimension===3?new ZhudaLayaParticleRenderer3D(s,this.scene,k=>this.textures.get(k)):new ZhudaLayaParticleRenderer(s,this.layer,k=>this.textures.get(k)));
  }
  reset():void {this.time=0;this.running=false;for(const s of this.systems){s.stop(true);this.position(s,0);}this.draw();}
  advance(dt:number,time:number):void {
    this.time=time;const running=time>=.7&&time<5.6;
    // Bursts retain full strength on the first frame, including short muzzle flashes.
    if(running&&!this.running)for(const s of this.systems)s.play();
    if(!running&&this.running)for(const s of this.systems)s.stop();
    this.running=running;
    for(const s of this.systems){this.position(s,Math.max(0,time-.7));s.update(dt);}
  }
  private position(s:any,t:number):void {
    const b=this.spec.labPreview.bindings[s.spec.id]||{},f=b.frequency??1,r=b.radius??(this.dimension===3?1:100),a=t*f+(b.phase||0);
    let x=b.x||0,y=b.y||0,z=b.z||0,angle=0;
    if(b.motion==='sway'||b.motion==='sweep')x+=Math.sin(a)*r;
    if(b.motion==='scan')y+=Math.sin(a)*r;
    if(b.motion==='spin')angle=a;
    if(b.motion==='orbit'){
      x+=Math.cos(a)*r;
      if(this.dimension===3 && this.spec.labPreview.actor!=='portal')z+=Math.sin(a)*r*(b.ellipse??1);
      else y+=Math.sin(a)*r*(b.ellipse??1);
      angle=a+(b.heading==='inward'?Math.PI:0);
    }
    if(b.motion==='projectile'){
      const u=(t%(b.period||2))/(b.period||2);x+=(u*2-1)*r;
      y+=(this.dimension===3?1:-1)*Math.sin(u*Math.PI)*r*.25;
    }
    if(this.dimension===3)s.setTransform(x,y,z,{x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)});
    else s.setTransform(x,y,angle);
  }
  private isGround(s:any):boolean {const b=this.spec.labPreview.bindings[s.spec.id]||{};return s.spec.billboard==='ground'||(this.dimension===2&&s.spec.texture==='ripple'&&(b.y||0)>=80);}
  private isTail(s:any):boolean {return this.spec.labPreview.bindings[s.spec.id]?.motion==='projectile'&&s.spec.texture!=='arrow';}
  draw():void {
    if(!this.spec)return;
    if(this.dimension===3){
      const tunnel=this.spec.labPreview.actor==='tunnel';
      const p=this.cameraMode==='side'?[7,3,1]:this.cameraMode==='front'?[0,2.8,-8]:tunnel?[0,2.1,7]:[4.5,3.4,7];
      this.camera.transform.position=new Laya.Vector3(...p);
      this.camera.transform.lookAt(new Laya.Vector3(0,tunnel?2:1.6,tunnel?-8:0),new Laya.Vector3(0,1,0),false);
    }
    for(let i=0;i<this.systems.length;i++){
      const s=this.systems[i],v=this.params.enabled&&(!this.isGround(s)||this.params.ground)&&(!this.isTail(s)||this.params.trails)?1:0;
      if(this.dimension===3)this.renderers[i].render(this.camera,v);else this.renderers[i].render(v);
    }
  }
  cycleCamera():void {const modes=['orbit','side','front'];this.cameraMode=modes[(modes.indexOf(this.cameraMode)+1)%modes.length];this.draw();}
  stats():any {
    const snapshots=this.systems.map(s=>s.snapshot());
    return {dimension:this.dimension,particles:this.systems.reduce((n,s)=>n+s.aliveCount,0),poolCapacity:this.systems.reduce((n,s)=>n+s.capacity,0),
      trailPoints:0,ribbonHistory:[],particleSnapshots:snapshots,positionsFinite:snapshots.every(g=>g.every(p=>[p.x,p.y,p.vx,p.vy,...(this.dimension===3?[p.z,p.vz]:[])].every(Number.isFinite))),
      meshSubmissions:this.renderers.reduce((n,r)=>n+r.submittedBatches,0),cameraMode:this.cameraMode,
      hasTrails:this.systems.some(s=>this.isTail(s)),hasGround:this.systems.some(s=>this.isGround(s)),
      effectNodes:this.dimension===3?this.renderers.length:this.layer.numChildren,
      sceneNodes:this.scene.numChildren,scene2DNodes:this.layer.numChildren};
  }
  private background2D():void {
    const p=this.spec.labPreview,g=this.background.graphics;g.clear();
    const backgrounds:any={weather:'#122b31',fire:'#211e27',water:'#102b3b',terrain:'#202d29',combat:'#272832',magic:'#201d35',tech:'#102a34',ui:'#1c2534',reward:'#2c2336',motion:'#152c39'};
    g.drawRect(0,0,960,660,backgrounds[p.scene]||'#182b36');
    for(let y=60;y<660;y+=60)g.drawLine(0,y,960,y,'#ffffff05',1);
    if(['weather','terrain'].includes(p.scene)){
      g.drawCircle(770,105,38,'#c4e4d515');
      for(let i=0;i<12;i++){const x=i*90-25,h=110+(i*67)%140;g.drawPoly(x,500,[-40,0,0,-h,42,0],'#0d2029');g.drawRect(x-5,460,10,130,'#0d2029');}
      g.drawPoly(0,580,[0,0,220,-30,410,12,700,-18,960,0,960,80,0,80],'#0c2027');
    }else if(p.scene==='water'){
      g.drawRect(0,465,960,195,'#173b4b');for(let i=0;i<12;i++)g.drawLine((i*79)%900,485+i*14,90+(i*79)%900,485+i*14,'#6dacc01c',2);
    }else if(!['ui','reward'].includes(p.scene)){
      g.drawEllipse(480,515,205,35,'#091822', '#52747b35',1);
      g.drawEllipse(480,515,170,24,null,'#52747b25',1);
    }
    const zoom=p.zoom||1;
    const bases:any={logs:220,candle:115,torch:150,chimney:255,workbench:160,basin:205,nozzle:235,rock:165,grass:175,mushroom:170,ground:165,stage:210};
    this.world.pos(480,bases[p.actor]?530-bases[p.actor]*zoom:330);this.world.scale(zoom,zoom);
  }
  private context2D():void {
    const a=this.spec.labPreview.actor,g=this.actor.graphics;g.clear();
    const rect=(x:number,y:number,w:number,h:number,c='#324753')=>g.drawRoundRect(x,y,w,h,6,6,6,6,c,'#6a879355',1);
    const line=(x:number,y:number,x2:number,y2:number,c='#6d8996',w=3)=>g.drawLine(x,y,x2,y2,c,w);
    if(a==='dummy'){g.drawCircle(0,-55,24,'#354c5c','#6e899a',2);rect(-29,-27,58,100);line(-28,-12,-62,40);line(28,-12,62,40);line(-15,73,-25,135);line(15,73,25,135);g.drawEllipse(0,145,62,9,'#0a1826');}
    else if(['card','button','item','gift','chest'].includes(a)){
      if(a==='card'){rect(-145,-150,290,300,'#263447');for(let i=0;i<3;i++)line(-50,95+i*11,50-i*14,95+i*11,'#526277',2);}
      if(a==='button')rect(-110,-45,220,90,'#2d5260');
      if(a==='item'){rect(-63,-63,126,126,'#2d3c51');g.drawPoly(0,0,[0,-34,27,0,0,34,-27,0],'#698596');}
      if(a==='gift'||a==='chest'){rect(-75,25,150,110,'#72563e');rect(-84,15,168,32,'#a47d4f');rect(-8,15,16,120,'#d8b77a');if(a==='gift'){g.drawEllipse(-24,7,27,12,null,'#d8b77a',4);g.drawEllipse(24,7,27,12,null,'#d8b77a',4);}}
    }else if(['basin','nozzle','candle','torch','chimney','logs','workbench','pipe','gun','stage','beacon'].includes(a)){
      if(a==='basin'){g.drawEllipse(0,180,155,28,'#263d49','#7196a3',3);g.drawEllipse(0,175,145,20,'#1b485a');}
      if(a==='nozzle'){rect(-30,170,60,65);g.drawEllipse(0,170,30,9,'#7196a3');}
      if(a==='candle'){rect(-19,-45,38,150,'#c3b599');line(0,-45,0,-59,'#292124',4);g.drawEllipse(0,110,60,10,'#645b52');}
      if(a==='torch'){line(-25,-50,0,140,'#806a50',24);line(-36,-35,-10,-39,'#ad9276',8);}
      if(a==='chimney'){rect(-55,65,110,190);rect(-64,55,128,24,'#64747c');}
      if(a==='logs'){line(-75,180,68,220,'#725a44',25);line(65,182,-68,218,'#907051',23);}
      if(a==='workbench'){rect(-190,-7,380,25);line(-160,18,-160,160);line(160,18,160,160);}
      if(a==='pipe'){rect(-340,-43,110,86);rect(-240,-30,30,60,'#778e98');}
      if(a==='gun'){rect(-250,-16,150,30);rect(-235,10,40,50);}
      if(a==='stage'){rect(-320,170,640,40);line(-260,170,-260,210);line(260,170,260,210);}
      if(a==='beacon'){rect(-36,30,72,110);g.drawCircle(0,0,32,'#674d55','#bd8a7a',2);}
    }else if(a==='crystal'){g.drawPoly(0,0,[0,-75,44,-12,28,70,-30,70,-44,-12],'#355367','#74a7ba',2);line(0,-75,5,70,'#6b98ac',2);}
    else if(a==='orb'){g.drawCircle(0,0,29,'#2f3752','#777ba2',2);g.drawCircle(-8,-8,7,'#b5c3ce88');}
    else if(a==='portal'){g.drawEllipse(0,0,112,148,'#0c1627','#4f5f7a',10);}
    else if(['panel','reactor','wall','target'].includes(a)){
      rect(-100,-120,200,240);for(let i=0;i<5;i++)line(-80,-85+i*42,80,-85+i*42,'#5f79873c',2);
      if(a==='reactor'){g.drawCircle(0,0,53,'#1a2e3a','#7796a8',5);g.drawCircle(0,0,26,'#41768d');}
      if(a==='target'){for(const r of [70,48,24])g.drawCircle(0,0,r,null,'#8b7578',3);}
    }else if(['cliff','rock','grass','mushroom','foot','ground'].includes(a)){
      if(a==='cliff'){rect(-180,-255,360,65);rect(-200,-200,100,400);rect(100,-200,100,400);}
      else if(a==='mushroom'){rect(-12,100,24,70,'#b2a07d');g.drawPie(0,110,70,180,360,'#7e6564');}
      else if(a==='grass'){for(let i=0;i<20;i++)line(-100+i*11,170,-110+i*12,110+(i*19)%40,'#688b67',4);}
      else if(a==='ground'){g.drawEllipse(0,170,210,18,'#4d5148','#8c8e7455',1);for(let i=0;i<15;i++)g.drawCircle(-185+i*26,165+(i*17)%15,2,'#a69b7b');}
      else{g.drawPoly(0,150,[-90,10,-70,-40,-10,-65,70,-30,90,15],'#53635c','#829189',2);}
    }
  }
  private material(hex:string):any {const n=parseInt(hex.slice(1),16),m=new Laya.UnlitMaterial();m.albedoColor=new Laya.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1);return m;}
  private box(parent:any,size:number[],position:number[],hex:string):any {const n=new Laya.MeshSprite3D(Laya.PrimitiveMesh.createBox(...size));parent.addChild(n);n.meshRenderer.sharedMaterial=this.material(hex);n.transform.localPosition=new Laya.Vector3(...position);return n;}
  private make3DContext():void {
    this.floor=new Laya.Sprite3D('Library stage');this.scene.addChild(this.floor);
    this.box(this.floor,[18,.15,18],[0,-.2,0],'#10212e');
    for(let i=-8;i<=8;i+=2){this.box(this.floor,[.015,.01,16],[i,-.115,0],'#233b49');this.box(this.floor,[16,.01,.015],[0,-.115,i],'#233b49');}
    const group=(name:string)=>{const n=new Laya.Sprite3D(name);this.scene.addChild(n);this.groups.set(name,n);return n;};
    let g=group('nozzle');this.box(g,[1,.8,1.2],[0,1,-.9],'#456074');this.box(g,[.7,.6,.15],[0,1,-.2],'#142b3e');
    g=group('basin');this.box(g,[3.6,.15,3.6],[0,0,0],'#26495c');for(const s of [-1,1]){this.box(g,[3.7,.3,.17],[0,.08,s*1.8],'#688393');this.box(g,[.17,.3,3.7],[s*1.8,.08,0],'#688393');}this.box(g,[.3,.5,.3],[0,.2,0],'#66838c');
    g=group('portal');for(const side of [-1,1])this.box(g,[.25,4,.35],[side*2,1.9,0],'#42546f');this.box(g,[4.3,.25,.35],[0,3.9,0],'#42546f');
    g=group('logs');for(const s of [-1,1]){const b=this.box(g,[1.8,.25,.3],[0,.1,s*.2],'#6b503a');b.transform.localRotationEulerY=s*30;}
    g=group('crate');this.box(g,[1.3,1.3,1.3],[0,.65,0],'#6e6252');this.box(g,[1.4,.12,1.4],[0,1,0],'#a58963');
    g=group('pines');for(const [x,z] of [[-3,-2],[3,-3],[2,2]]){this.box(g,[.2,1.8,.2],[x,.8,z],'#564f4b');for(let j=0;j<3;j++){const n=new Laya.MeshSprite3D(Laya.PrimitiveMesh.createCone(.9-j*.2,1.3,8));g.addChild(n);n.meshRenderer.sharedMaterial=this.material('#274854');n.transform.localPosition=new Laya.Vector3(x,1.3+j*.5,z);}}
    g=group('tunnel');for(let z=-10;z<=7;z+=3)for(const s of [-1,1]){this.box(g,[.08,5,.08],[s*4,2,z],'#354b68');this.box(g,[8,.08,.08],[0,4.5,z],'#354b68');}
    group('sky');
  }
}
