import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = process.env.ZHUDA_ENGINE_ROOT || path.resolve(root, '../Zhuda-LayaAir');
const { default: esbuild } = await import(pathToFileURL(path.join(engineRoot, 'node_modules/esbuild/lib/main.js')));
fs.mkdirSync(path.join(root, 'dist/libs'), { recursive: true });
for (const file of ['laya.core.js', 'laya.d3.js', 'laya.webgl_2D.js', 'laya.webgl_3D.js', 'laya.ui.js']) {
  fs.copyFileSync(path.join(engineRoot, 'vendor/laya-3.4.2/libs', file), path.join(root, 'dist/libs', file));
}
fs.cpSync(path.join(root, 'public'), path.join(root, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'assets'), path.join(root, 'dist/assets'), { recursive: true });
if (fs.existsSync(path.join(root, 'docs/media'))) fs.cpSync(path.join(root, 'docs/media'), path.join(root, 'dist/media'), { recursive: true });
for (const file of ['LICENSE','THIRD_PARTY_NOTICES.md']) if (fs.existsSync(path.join(root, file))) fs.copyFileSync(path.join(root,file),path.join(root,'dist',file));
fs.writeFileSync(path.join(root,'dist/.nojekyll'),'');
await esbuild.build({ entryPoints: [path.join(root, 'src/Main.ts')], bundle: true, format: 'iife', target: 'es2020',
  outfile: path.join(root, 'dist/app.js'), sourcemap: true,
  alias: { 'zhuda-laya-engine': path.join(engineRoot, 'dist/sdk/zhuda-laya-engine.esm.js') } });
console.log('Particle Lab built. Uses the public engine SDK; presets and scene remain in this project.');
