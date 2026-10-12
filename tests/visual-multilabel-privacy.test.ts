// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { createEmptyProfile } from '../src/profile/schema';
import { prepareLocalVisualCandidate } from '../src/popup/localVisualCandidate';
import { semanticRedactor } from '../src/ai/semanticPrivacy';

afterEach(() => { document.body.replaceChildren(); });
function attemptFor(name: string, labels: string[]) {
  document.body.innerHTML = '<form><section><h2>个人信息</h2>' + labels.map(text=>`<label for="opaque">${text}</label>`).join('') + '<input id="opaque"></section></form>';
  const context = { scan:scanDocument().result, profile:createEmptyProfile() }; context.profile.basic.name = name;
  const attempt = prepareLocalVisualCandidate(context,context.scan.fields[0]!.id,()=>context,()=>true);
  return {attempt,label:context.scan.fields[0]!.label};
}
it.each([
  ['青岚岭城',['青岚','岭城']],
  ['青岚岭城',['青 岚','岭 城']],
  ['AzureVale',['Azure','Vale']],
  ['Azure Vale',['Az ure','Va le']],
])('rejects a known private fact split between labels: %s', (name,labels) => {
  const f = attemptFor(name,labels);
  // An entirely redacted field may be excluded before a handshake is created.
  expect(f.attempt?.authorizeLabel(f.label) ?? false).toBe(false);
});
it('keeps ordinary aggregate label authorization and its one-use receipt', () => {
  const f = attemptFor('青岚岭城',['陌生问题甲','附加问题甲']);
  expect(f.attempt!.authorizeLabel(f.label)).toBe(true); expect(f.attempt!.authorizeLabel(f.label)).toBe(false);
});
it.each([
  ['青岚岭城','青岚 岭城'], ['Azure Vale','Az ure Va le'], ['AzureVale','Azure Vale'], ['C++','C + +'],
])('redacts split facts before text metadata or image permission leaves the local profile: %s', (fact,label) => {
  expect(semanticRedactor({name:fact})(label)).toBe('[redacted]');
});
it('preserves short Latin field words while masking their standalone private literal', () => {
  const redact = semanticRedactor({skill:'C',grade:'AI'});
  expect(redact('Contact Candidate Mail')).toBe('Contact Candidate Mail');
  expect(redact('C A I')).toBe('[redacted] [redacted]');
});
