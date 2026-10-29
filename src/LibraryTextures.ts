export const LIBRARY_TEXTURE_KEYS = ['ring','drop','bubble','leaf','petal','star','confetti','paper','heart','cross','bolt','hex','diamond','feather','shard','triangle','pixel','arc','rune','arrow','flower','spark','dust','ripple','check','lock','shield','snowflake','raindrop','beam','column'];
export function drawLibraryTexture(c: CanvasRenderingContext2D, kind: string): boolean {
  if (!LIBRARY_TEXTURE_KEYS.includes(kind)) return false;
  c.save(); c.translate(64,64); c.fillStyle='white'; c.strokeStyle='white'; c.lineCap='round';c.lineJoin='round';
  const poly=(n:number,r:number,inner=0)=>{c.beginPath();for(let i=0;i<n*(inner?2:1);i++){const a=i*Math.PI*2/(n*(inner?2:1))-Math.PI/2,d=inner&&i%2?inner:r;const x=Math.cos(a)*d,y=Math.sin(a)*d;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();};
  const glow=()=>{const g=c.createRadialGradient(0,0,1,0,0,60);g.addColorStop(0,'#ffffffcc');g.addColorStop(.25,'#ffffff55');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(-64,-64,128,128);c.fillStyle='white';};
  if(['ring','ripple','bubble'].includes(kind)) {
    if(kind==='bubble'){c.lineWidth=2;c.globalAlpha=.6;c.beginPath();c.arc(0,0,44,0,Math.PI*2);c.stroke();c.globalAlpha=.9;c.lineWidth=6;c.beginPath();c.arc(-7,-7,27,3.7,4.8);c.stroke();c.globalAlpha=.12;c.beginPath();c.arc(0,0,43,0,Math.PI*2);c.fill();}
    else {c.shadowColor='#ffffff';c.shadowBlur=kind==='ring'?5:1;c.lineWidth=kind==='ring'?5:2;c.beginPath();c.arc(0,0,45,0,Math.PI*2);c.stroke();if(kind==='ripple'){c.globalAlpha=.4;c.beginPath();c.arc(0,0,34,0,Math.PI*2);c.stroke();}}
  } else if(['drop','raindrop'].includes(kind)){c.scale(kind==='raindrop'?.5:1,1);c.beginPath();c.moveTo(0,-54);c.bezierCurveTo(-10,-25,-40,9,-33,28);c.bezierCurveTo(-18,64,31,48,32,22);c.bezierCurveTo(31,-4,10,-31,0,-54);c.fill();}
  else if(['leaf','petal','feather'].includes(kind)){c.rotate(-.5);c.beginPath();c.moveTo(0,-54);c.bezierCurveTo(58,-20,35,40,0,54);c.bezierCurveTo(-25,30,-45,-20,0,-54);c.fill();c.globalCompositeOperation='destination-out';c.lineWidth=2;c.beginPath();c.moveTo(0,-36);c.lineTo(0,47);for(let i=-20;i<35;i+=12){c.moveTo(0,i);c.lineTo(19,i-10);if(kind==='feather'){c.moveTo(0,i);c.lineTo(-19,i-12);}}c.stroke();}
  else if(kind==='star'){glow();poly(4,54,11);c.fill();}
  else if(kind==='confetti'){c.rotate(.4);c.fillRect(-22,-39,44,78);}
  else if(kind==='paper'){c.rotate(-.3);c.beginPath();c.moveTo(-39,-30);c.quadraticCurveTo(0,-8,41,-37);c.lineTo(25,38);c.quadraticCurveTo(-10,12,-40,34);c.closePath();c.fill();}
  else if(kind==='heart'){c.beginPath();c.moveTo(0,45);c.bezierCurveTo(-10,30,-56,-3,-45,-28);c.bezierCurveTo(-32,-53,-6,-42,0,-24);c.bezierCurveTo(14,-50,51,-42,48,-16);c.bezierCurveTo(43,9,12,32,0,45);c.fill();}
  else if(kind==='cross'){c.fillRect(-10,-44,20,88);c.fillRect(-44,-10,88,20);}
  else if(kind==='bolt'){glow();c.beginPath();c.moveTo(19,-60);c.lineTo(-28,-8);c.lineTo(-1,0);c.lineTo(-21,59);c.lineTo(33,-12);c.lineTo(7,-18);c.closePath();c.fill();}
  else if(kind==='hex'){poly(6,47);c.lineWidth=5;c.stroke();c.globalAlpha=.12;c.fill();}
  else if(kind==='diamond'){poly(4,51);c.fill();c.globalCompositeOperation='destination-out';c.globalAlpha=.45;c.beginPath();c.moveTo(0,-50);c.lineTo(0,50);c.lineTo(50,0);c.closePath();c.fill();}
  else if(kind==='shard'){poly(3,53);c.fill();c.globalCompositeOperation='destination-out';c.globalAlpha=.5;c.beginPath();c.moveTo(0,0);c.lineTo(0,-53);c.lineTo(43,25);c.closePath();c.fill();}
  else if(kind==='triangle'){poly(3,47);c.lineWidth=5;c.stroke();}
  else if(kind==='pixel'){c.fillRect(-34,-34,68,68);}
  else if(kind==='arc'){for(let i=0;i<10;i++){c.globalAlpha=(10-i)/10;c.lineWidth=9-i*.7;c.beginPath();c.ellipse(0,0,54-i*2,30-i*.8,-.5,-2.7,1.3);c.stroke();}}
  else if(kind==='rune'){poly(6,48);c.lineWidth=2;c.stroke();poly(3,34);c.stroke();c.beginPath();c.arc(0,0,19,0,Math.PI*2);c.stroke();for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.fillRect(-3,-43,6,9);}}
  else if(kind==='arrow'){c.beginPath();c.moveTo(-54,-4);c.lineTo(16,-4);c.lineTo(6,-20);c.lineTo(55,0);c.lineTo(6,20);c.lineTo(16,4);c.lineTo(-54,4);c.fill();}
  else if(kind==='flower'){for(let i=0;i<5;i++){c.rotate(Math.PI*2/5);c.beginPath();c.ellipse(0,-24,16,29,0,0,Math.PI*2);c.fill();}}
  else if(kind==='spark'){glow();poly(4,54,4);c.fill();}
  else if(kind==='dust'){let r=91;for(let i=0;i<30;i++){r=(r*1664525+1013904223)>>>0;const x=r%105-52;r=(r*1664525+1013904223)>>>0;const y=r%105-52;c.globalAlpha=.1;c.beginPath();c.arc(x,y,8+r%12,0,Math.PI*2);c.fill();}}
  else if(kind==='check'){c.lineWidth=14;c.beginPath();c.moveTo(-38,0);c.lineTo(-9,30);c.lineTo(41,-32);c.stroke();}
  else if(kind==='lock'){c.lineWidth=8;c.beginPath();c.arc(0,-16,25,Math.PI,Math.PI*2);c.stroke();c.fillRect(-36,-15,72,60);c.globalCompositeOperation='destination-out';c.beginPath();c.arc(0,7,7,0,Math.PI*2);c.fill();c.fillRect(-3,10,6,15);}
  else if(kind==='shield'){c.lineWidth=7;c.beginPath();c.moveTo(0,-48);c.lineTo(39,-29);c.quadraticCurveTo(42,22,0,51);c.quadraticCurveTo(-42,22,-39,-29);c.closePath();c.stroke();c.globalAlpha=.15;c.fill();}
  else if(kind==='snowflake'){c.lineWidth=5;for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(0,48);c.moveTo(0,29);c.lineTo(13,38);c.moveTo(0,29);c.lineTo(-13,38);c.stroke();}}
  else if(kind==='column'){const g=c.createLinearGradient(-60,0,60,0);g.addColorStop(0,'#ffffff00');g.addColorStop(.35,'#ffffff44');g.addColorStop(.5,'#ffffffbb');g.addColorStop(.65,'#ffffff44');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.beginPath();c.moveTo(-52,-64);c.lineTo(52,-64);c.lineTo(28,64);c.lineTo(-28,64);c.closePath();c.fill();c.globalCompositeOperation='destination-in';const fade=c.createLinearGradient(0,-64,0,64);fade.addColorStop(0,'#ffffff00');fade.addColorStop(.25,'#ffffffff');fade.addColorStop(.85,'#ffffffff');fade.addColorStop(1,'#ffffff00');c.fillStyle=fade;c.fillRect(-64,-64,128,128);}
  else if(kind==='beam'){const g=c.createLinearGradient(0,-60,0,60);g.addColorStop(0,'#ffffff00');g.addColorStop(.45,'#ffffff88');g.addColorStop(.5,'#ffffffff');g.addColorStop(.55,'#ffffff88');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(-64,-64,128,128);}
  c.restore();return true;
}
