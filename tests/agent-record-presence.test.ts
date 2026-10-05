import { afterEach, expect, it } from 'vitest';
import { verifyRecordPresence } from '../src/agent/recordCompletion';
import { scanDocument } from '../src/content/scanner';
import { educationSessionProfile, installEducationSessionPage } from './fixtures/education-session-page';
afterEach(() => { document.body.innerHTML = ''; });
it('counts no records complete before any matching summaries exist and does not click Add', () => {
  const page = installEducationSessionPage(document); expect(verifyRecordPresence(scanDocument(), educationSessionProfile)).toEqual({ state: 'pending', total: 2, matched: 0 }); expect(page.counts.add).toBe(0);
});
it('proves only the source record present and keeps the other pending', () => {
  installEducationSessionPage(document, educationSessionProfile, [1]); expect(verifyRecordPresence(scanDocument(), educationSessionProfile)).toEqual({ state: 'pending', total: 2, matched: 1 });
});
it('proves every source record from current summary identities rather than array order', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); expect(verifyRecordPresence(scanDocument(), educationSessionProfile)).toEqual({ state: 'all-present', total: 2, matched: 2 }); expect(page.counts.save).toBe(0);
});
it('does not claim completion just because the page has as many cards as the profile', () => {
  installEducationSessionPage(document, educationSessionProfile, [1, 1]); expect(verifyRecordPresence(scanDocument(), educationSessionProfile)).toEqual({ state: 'pending', total: 2, matched: 1 });
});
it('freshly checks removed cards instead of trusting a previous complete status', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); expect(verifyRecordPresence(scanDocument(), educationSessionProfile).state).toBe('all-present');
  page.cards[0]!.remove(); expect(verifyRecordPresence(scanDocument(), educationSessionProfile)).toEqual({ state: 'pending', total: 2, matched: 1 });
});
it('a changed school name does not remain verified after a prior successful run', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); expect(verifyRecordPresence(scanDocument(), educationSessionProfile).state).toBe('all-present');
  page.cards[0]!.querySelector('h3')!.textContent = '无法核验的其他学校'; expect(verifyRecordPresence(scanDocument(), educationSessionProfile).state).toBe('unverified');
});
it('does not prove a detached or hidden original list', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); const scan = scanDocument(); page.list.hidden = true;
  expect(verifyRecordPresence(scan, educationSessionProfile).state).toBe('unverified'); page.list.remove(); expect(verifyRecordPresence(scan, educationSessionProfile).state).toBe('unverified');
});
it('rejects an open editor even if existing summary records were already present', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); page.add.click(); expect(verifyRecordPresence(scanDocument(), educationSessionProfile).state).toBe('unverified'); expect(page.counts.save).toBe(0);
});
it('rejects an editor opened after the observation without using its stale closed-list status', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); const scan = scanDocument(); page.add.click();
  expect(verifyRecordPresence(scan, educationSessionProfile).state).toBe('unverified'); expect(page.counts.save).toBe(0);
});
it('rejects replaced summary nodes even when their text is identical', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); const scan = scanDocument(); const card = page.cards[0]!;
  card.replaceWith(card.cloneNode(true)); expect(verifyRecordPresence(scan, educationSessionProfile).state).toBe('unverified');
});
it('rejects multiple competing lists and forged source IDs', () => {
  const page = installEducationSessionPage(document, educationSessionProfile, [1, 0]); expect(verifyRecordPresence(scanDocument(), { ...educationSessionProfile, education: [educationSessionProfile.education[0], educationSessionProfile.education[0]] }).state).toBe('unverified');
  page.list.closest('section')!.after(page.list.closest('section')!.cloneNode(true)); expect(verifyRecordPresence(scanDocument(), educationSessionProfile).state).toBe('unverified');
});
it('rejects invalid source ranges and empty source without pretending a section is complete', () => {
  installEducationSessionPage(document); expect(verifyRecordPresence(scanDocument(), { ...educationSessionProfile, education: [] }).state).toBe('unverified');
  expect(verifyRecordPresence(scanDocument(), { ...educationSessionProfile, education: [{ ...educationSessionProfile.education[0], startDate: '2028-01', endDate: '2027-01' }] }).state).toBe('unverified');
});
