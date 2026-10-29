import { drawLibraryTexture } from './LibraryTextures';
export function textureCanvas(kind: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  if (kind === 'ribbon') {
    const image = c.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const across = Math.abs((y - 63.5) / 63.5), age = x / 127;
      const a = Math.pow(1 - across, 1.8) * Math.pow(1 - age, 1.5);
      const i = (y * 128 + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(a * 220);
    }
    c.putImageData(image, 0, 0);
  } else if (drawLibraryTexture(c, kind)) {
    // Shape-specific application assets.
  } else if (kind === 'smoke') {
    let seed = 431;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 25; i++) {
      const a = random() * Math.PI * 2, r = random() * 27, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      const gradient = c.createRadialGradient(x, y, 1, x, y, 20 + random() * 19);
      gradient.addColorStop(0, 'rgba(255,255,255,.19)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gradient; c.fillRect(0, 0, 128, 128);
    }
  } else if (kind === 'flame') {
    const gradient = c.createLinearGradient(0, 8, 0, 122);
    gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(.25, 'rgba(255,255,255,.5)');
    gradient.addColorStop(.65, 'rgba(255,255,255,1)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    c.filter = 'blur(2px)'; c.fillStyle = gradient;
    c.beginPath(); c.moveTo(70, 5); c.bezierCurveTo(38, 27, 76, 43, 38, 65);
    c.bezierCurveTo(8, 89, 41, 123, 64, 121); c.bezierCurveTo(106, 119, 111, 90, 91, 68);
    c.bezierCurveTo(63, 44, 82, 33, 70, 5); c.fill();
  } else if (kind === 'coin') {
    c.fillStyle = '#b57d24'; c.beginPath(); c.ellipse(64, 67, 43, 48, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(28, 20, 99, 109); g.addColorStop(0, '#fff7cc'); g.addColorStop(.35, '#ffd66b'); g.addColorStop(1, '#b77a20');
    c.fillStyle = g; c.beginPath(); c.arc(64, 60, 43, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff0ad'; c.lineWidth = 4; c.beginPath(); c.arc(64, 60, 34, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#a27125'; c.font = 'bold 46px sans-serif'; c.textAlign = 'center'; c.fillText('Z', 64, 76);
  } else if (kind === 'snow') {
    c.translate(64, 64); c.strokeStyle = 'white'; c.lineWidth = 6; c.lineCap = 'round';
    for (let i = 0; i < 6; i++) { c.rotate(Math.PI / 3); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 44); c.moveTo(0, 27); c.lineTo(-13, 37); c.moveTo(0, 27); c.lineTo(13, 37); c.stroke(); }
  } else {
    c.save();
    if (kind === 'streak') { c.translate(64, 64); c.scale(1, .27); c.translate(-64, -64); }
    if (kind === 'flame') { c.translate(64, 68); c.scale(.62, 1); c.translate(-64, -64); }
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.18, 'rgba(255,255,255,.9)');
    g.addColorStop(.45, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128); c.restore();
  }
  return canvas;
}
