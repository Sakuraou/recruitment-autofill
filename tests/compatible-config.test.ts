// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCompanionModel } from '../src/companion/modelConfig';

const directory = resolve('artifacts', 'compatible-config-fixtures');
async function fixture(contents: string): Promise<string> {
  await mkdir(directory, { recursive: true }); const path = resolve(directory, randomUUID() + '.json');
  await writeFile(path, contents); return path;
}
const config = { provider: 'openai-compatible', baseUrl: 'https://fictional-api.example.test/v1',
  model: 'fictional', apiKey: 'fictional-private-key' };

it('an absent optional config preserves default disabled behavior', async () => {
  expect(await loadCompanionModel({}, resolve(directory, randomUUID() + '.json'))).toMatchObject({ kind: 'none' });
});
it('an explicitly selected missing config cannot use a different credential as fallback', async () => {
  await expect(loadCompanionModel({ OPENAI_API_KEY: 'fictional', RA_OPENAI_MODEL: 'fictional' },
    resolve(directory, randomUUID() + '.json'), true)).rejects.toThrow('无法读取模型配置');
});
it('UTF8 BOM local JSON works without exporting a credential into the extension connection', async () => {
  const model = await loadCompanionModel({}, await fixture('\uFEFF' + JSON.stringify(config)), true);
  expect(model.kind).toBe('openai-compatible'); expect(model.provider).toBeTypeOf('function');
  expect(JSON.stringify(model)).not.toContain(config.apiKey);
});
it('malformed JSON reports a finite generic error without its private contents', async () => {
  const error = await loadCompanionModel({}, await fixture('{"apiKey":"fictional-private-key"')).catch(error => error);
  expect(error.message).toContain('无法读取模型配置'); expect(String(error)).not.toContain(config.apiKey);
});
it('oversized model config is rejected before a provider is configured', async () => {
  await expect(loadCompanionModel({}, await fixture(' '.repeat(16_385) + JSON.stringify(config)), true)).rejects.toThrow('无法读取模型配置');
});
it('invalid model options do not echo their secret values or fall back to legacy settings', async () => {
  const error = await loadCompanionModel({ OPENAI_API_KEY: 'fictional', RA_OPENAI_MODEL: 'fictional' },
    await fixture(JSON.stringify({ ...config, provider: config.apiKey })), true).catch(error => error);
  expect(error.message).toContain('模型配置文件格式不正确'); expect(String(error)).not.toContain(config.apiKey);
});
