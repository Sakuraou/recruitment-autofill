import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, access } from 'node:fs/promises';

await viteBuild();
await build({ entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', bundle: true, format: 'iife', target: 'chrome114' });
await build({ entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', target: 'chrome114' });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('INSTALL.md', 'dist/README.md');
await copyFile('VERIFICATION.md', 'dist/VERIFICATION.md');
await copyFile('MOBILE_FIX.md', 'dist/MOBILE_FIX.md');
await mkdir('dist/examples', { recursive: true });
await cp('examples', 'dist/examples', { recursive: true });
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
for (const file of [manifest.action.default_popup, manifest.options_ui.page, manifest.background.service_worker, 'content.js']) {
  await access(`dist/${file}`);
}
console.info('MV3 安装包已生成：dist/');
