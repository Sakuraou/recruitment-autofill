import { afterEach, expect, it } from 'vitest';
import { createPublicationRecordSession, publicationRecordAvailability } from '../src/content/publicationRecordSession';
import type { RecordV2Session } from '../src/content/recordV2Gateway';
import { publicationSessionProfile, installPublicationSessionPage } from './fixtures/publication-session-page';
const sessions: RecordV2Session[] = [];
function create() { const session = createPublicationRecordSession(document, publicationSessionProfile); sessions.push(session); return session; }
async function run(session: RecordV2Session) { let result = await session.advance();
  for (let steps = 0; steps < 30 && result.status === 'advanced'; steps++) result = await session.advance(); return result; }
afterEach(() => { sessions.splice(0).forEach(session => session.stop()); document.head.innerHTML = ''; document.body.innerHTML = ''; window.history.replaceState({}, '', '/'); });
it('one explicit publication list offers a bounded record task', () => {
  installPublicationSessionPage(document); expect(publicationRecordAvailability(document)).toEqual({ eligible: true });
});
it('all three papers save independently, including same-titled papers with different DOI and status', async () => {
  const fixture = installPublicationSessionPage(document); expect((await run(create())).status).toBe('complete');
  expect(fixture.saved.map(p => p.doi)).toEqual(publicationSessionProfile.publications.map(p => p.doi));
  expect(fixture.saved.map(p => p.status)).toEqual(['published', 'submitted', 'published']);
  expect(fixture.saved.map(p => p.authorOrder)).toEqual(['two', 'three', 'one']);
  expect(fixture.saved.map(p => p.abstract)).toEqual(publicationSessionProfile.publications.map(p => p.abstract));
  expect(fixture.counts).toEqual({ add: 3, save: 3, remove: 0, submit: 0, cancel: 0 });
});
it('a restart verifies every card without duplicate Add or Save', async () => {
  const fixture = installPublicationSessionPage(document); expect((await run(create())).status).toBe('complete');
  expect((await run(create())).status).toBe('complete'); expect(fixture.counts.add).toBe(3); expect(fixture.counts.save).toBe(3);
});
it('an existing second paper does not skip a same-titled first paper', async () => {
  const fixture = installPublicationSessionPage(document, [1]); expect((await run(create())).status).toBe('complete');
  expect(fixture.saved.map(p => p.doi)).toEqual(['10.1234/fictional-a', '10.1234/fictional-c']); expect(fixture.counts.add).toBe(2);
});
it('unknown fields and existing conflicts preserve drafts without Save', async () => {
  for (const option of [{ unknown: true }, { existingConflict: true }]) {
    const fixture = installPublicationSessionPage(document, [], option); expect((await run(create())).status).toBe('request-human');
    expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
  }
});
it('refused Save is invoked once and never followed by another Add', async () => {
  const fixture = installPublicationSessionPage(document, [], { saveRefused: true }); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(1);
});
it('a saved card with the wrong identity stops further records even if its count increased', async () => {
  const fixture = installPublicationSessionPage(document, [], { corruptSummary: true }); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(1);
});
it('Stop after Add preserves the editor without Save', async () => {
  const fixture = installPublicationSessionPage(document), session = create(); expect((await session.advance()).status).toBe('advanced');
  session.stop(); expect((await session.advance()).status).not.toBe('advanced'); expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('a replaced list or changed URL invalidates the original run before Add', async () => {
  for (const mode of ['replace', 'url']) {
    window.history.replaceState({}, '', '/'); const fixture = installPublicationSessionPage(document), session = create();
    if (mode === 'replace') fixture.list.replaceWith(fixture.list.cloneNode(true)); else window.history.replaceState({}, '', '/changed');
    expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
  }
});
it('profile changes stop before Add', async () => {
  const fixture = installPublicationSessionPage(document); let projection = publicationSessionProfile;
  const session = createPublicationRecordSession(document, projection, async () => projection); sessions.push(session);
  projection = { ...projection, profileRevision: 'changed' }; expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
});
it('source with insufficient identity stops before Add', async () => {
  const fixture = installPublicationSessionPage(document); const projection = { ...publicationSessionProfile, publications: [{ id: 'unknown', title: '虚构在投论文', status: '在投' }] };
  const session = createPublicationRecordSession(document, projection); sessions.push(session);
  expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.add).toBe(0);
});
it('a foreign open editor prevents starting a new run', () => {
  const fixture = installPublicationSessionPage(document); fixture.add.click(); expect(publicationRecordAvailability(document).eligible).toBe(false);
  expect(() => create()).toThrow(); expect(fixture.counts.add).toBe(1);
});
it('known venue fields revealed by status selection are filled before Save', async () => {
  const fixture = installPublicationSessionPage(document, [], { dynamicVenue: true }); const result = await run(create()); expect(result.status, JSON.stringify(result)).toBe('complete');
  expect(fixture.saved.map(p => p.venue)).toEqual(publicationSessionProfile.publications.map(p => p.venue)); expect(fixture.counts.save).toBe(3);
}, 15_000); // Three records each wait for both the status answer and the expanded venue.
it('an unknown dynamic field preserves the draft and stops Save', async () => {
  const fixture = installPublicationSessionPage(document, [], { dynamicUnknown: true }); expect((await run(create())).status).toBe('request-human');
  expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('Stop during status selection prevents Save and further Add', async () => {
  const fixture = installPublicationSessionPage(document, [], { onStatus: () => session.stop() }); const session = create();
  expect((await run(session)).status).not.toBe('complete'); expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('a changed profile during status selection cannot authorize Save', async () => {
  let projection = publicationSessionProfile;
  const fixture = installPublicationSessionPage(document, [], { onStatus: () => { projection = { ...projection, profileRevision: 'changed-during-fill' }; } });
  const session = createPublicationRecordSession(document, projection, async () => projection); sessions.push(session);
  expect((await run(session)).status).toBe('request-human'); expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
});
it('manual edits after verified filling stay visible and prevent Save', async () => {
  const fixture = installPublicationSessionPage(document), session = create();
  expect((await session.advance()).status).toBe('advanced'); expect((await session.advance()).status).toBe('advanced');
  fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!.value = '用户手改论文标题';
  expect((await session.advance()).status).toBe('request-human'); expect(fixture.counts.save).toBe(0);
  expect(fixture.list.querySelector<HTMLInputElement>('[data-key="title"]')!.value).toBe('用户手改论文标题');
});
it('a paper abstract over the website limit remains pending rather than truncated', async () => {
  const fixture = installPublicationSessionPage(document);
  const projection = { ...publicationSessionProfile, publications: [{ ...publicationSessionProfile.publications[0]!, abstract: '字'.repeat(51) }] };
  const session = createPublicationRecordSession(document, projection); sessions.push(session);
  expect((await run(session)).status).toBe('request-human'); expect(fixture.counts.add).toBe(1); expect(fixture.counts.save).toBe(0);
  expect(fixture.list.querySelector<HTMLTextAreaElement>('[data-key="abstract"]')!.value).toBe('');
});
it('a changed existing paper status prevents Add rather than silently treating it as complete', async () => {
  const fixture = installPublicationSessionPage(document, [0]);
  const status = [...fixture.cards[0]!.querySelectorAll('p')].find(p => p.textContent!.startsWith('发表状态'))!; status.textContent = '发表状态：在投';
  expect((await run(create())).status).toBe('request-human'); expect(fixture.counts.add).toBe(0); expect(fixture.counts.save).toBe(0);
});
