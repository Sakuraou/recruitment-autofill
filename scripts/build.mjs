import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, access } from 'node:fs/promises';

await viteBuild();
const recordV2TestBuild = process.env.RA_RECORD_V2_TEST_BUILD === '1';
await build({ entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', bundle: true, format: 'iife', target: 'chrome114',
  define: { __RA_RECORD_V2_TEST_BUILD__: JSON.stringify(recordV2TestBuild) } });
await build({ entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', target: 'chrome114' });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('INSTALL.md', 'dist/README.md');
await copyFile('VERIFICATION.md', 'dist/VERIFICATION.md');
await copyFile('MOBILE_FIX.md', 'dist/MOBILE_FIX.md');
await mkdir('dist/docs', { recursive: true });
await copyFile('docs/COMPATIBLE_API_SETUP.md', 'dist/docs/COMPATIBLE_API_SETUP.md');
await copyFile('docs/AGENT_NEXT_STEP.md', 'dist/docs/AGENT_NEXT_STEP.md');
await copyFile('docs/UNIVERSAL_AWARDS_PROGRESS.md', 'dist/docs/UNIVERSAL_AWARDS_PROGRESS.md');
await copyFile('docs/UNIVERSAL_PUBLICATIONS_PROGRESS.md', 'dist/docs/UNIVERSAL_PUBLICATIONS_PROGRESS.md');
await copyFile('docs/UNIVERSAL_STUDENT_WORK_PROGRESS.md', 'dist/docs/UNIVERSAL_STUDENT_WORK_PROGRESS.md');
await mkdir('dist/examples', { recursive: true });
await cp('examples', 'dist/examples', { recursive: true });
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
for (const file of [manifest.action.default_popup, manifest.options_ui.page, manifest.background.service_worker, 'content.js']) {
  await access(`dist/${file}`);
}
console.info('MV3 安装包已生成：dist/');
