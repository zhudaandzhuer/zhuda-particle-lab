import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve('dist'),out=path.resolve('evidence/devices');fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(req.method==='POST'&&pathname==='/__device-report'){
  let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e6)req.destroy();});req.on('end',()=>{try{const data=JSON.parse(raw);if(data.kind!=='zhuda-device-capabilities'||!Array.isArray(data.cases))throw Error();const name=crypto.createHash('sha256').update(String(data.userAgent)).digest('hex').slice(0,12);fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({...data,receivedAt:new Date().toISOString()},null,2));console.log('DEVICE REPORT',name,data.userAgent,data.cases.map(c=>c.mode+':'+c.frameP95Ms).join(' '));res.writeHead(200,{'content-type':'application/json'}).end('{"saved":true}');}catch{res.writeHead(400).end();}});return;
 }
 const file=path.resolve(root,'.'+(pathname==='/'?'/capabilities.html':decodeURIComponent(pathname)));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(data);});
}).listen(8898,'0.0.0.0',()=>console.log('Device QA http://localhost:8898/capability-stage.html?devicecheck=1'));
