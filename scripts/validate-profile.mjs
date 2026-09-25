import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/validate-profile.mjs <profile.json>');
const result = await build({ entryPoints: [resolve('src/profile/schema.ts')], bundle: true, write: false, platform: 'node', format: 'esm' });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
const { parseProfileJson } = await import(moduleUrl);
const profile = parseProfileJson(await readFile(resolve(input), 'utf8'));
console.info(JSON.stringify({ valid: true, education: profile.education.length, projects: profile.projects.length,
  internships: profile.internships.length, studentWork: profile.studentWork.length, awards: profile.awards.length,
  papers: profile.research.papers.length, certificates: profile.certificates.length }, null, 2));
