import { expect, it } from 'vitest';
import { AgentPageLease } from '../src/agent/pageLease';
it('ordinary writes remain available while no Agent owns the page', () => { const lease = new AgentPageLease(() => 'https://fixture.example/', () => false); expect(lease.mayWrite()).toBe(true); });
it('only the issued Agent token can write during its run', () => {
  const lease = new AgentPageLease(() => 'https://fixture.example/', () => false); const token = lease.begin(); expect(lease.holdsPage()).toBe(true);
  expect(lease.mayWrite(token)).toBe(true); expect(lease.mayWrite()).toBe(false); expect(lease.mayWrite(crypto.randomUUID())).toBe(false);
});
it('rejects a second Agent and refuses a start during existing field or record work', () => {
  const lease = new AgentPageLease(() => 'https://fixture.example/', () => false); lease.begin(); expect(() => lease.begin()).toThrow();
  expect(() => new AgentPageLease(() => 'https://fixture.example/', () => true).begin()).toThrow();
});
it('old tagged commands cannot restart writing after their lease ends', () => {
  const lease = new AgentPageLease(() => 'https://fixture.example/', () => false); const old = lease.begin(); expect(lease.end(old)).toBe(true);
  expect(lease.mayWrite(old)).toBe(false); expect(lease.mayWrite()).toBe(true); const current = lease.begin(); expect(lease.mayWrite(old)).toBe(false); expect(lease.mayWrite(current)).toBe(true);
});
it('cannot release a different user intent with a stale token', () => {
  const lease = new AgentPageLease(() => 'https://fixture.example/', () => false); const old = lease.begin(); lease.end(old); const current = lease.begin();
  expect(lease.end(old)).toBe(false); expect(lease.mayWrite(current)).toBe(true); expect(lease.holdsPage()).toBe(true);
});
it('navigation immediately revokes writes and still permits releasing the stopped intent', () => {
  let url = 'https://fixture.example/start'; const lease = new AgentPageLease(() => url, () => false); const token = lease.begin(); url = 'https://fixture.example/next';
  expect(lease.mayWrite(token)).toBe(false); expect(lease.mayWrite()).toBe(false); expect(lease.end(token)).toBe(true); expect(lease.mayWrite()).toBe(true);
});
it.each(['file:///profile.html', 'chrome://extensions/', 'javascript:alert(1)', 'about:blank'])('does not start page automation on %s', url => { expect(() => new AgentPageLease(() => url, () => false).begin()).toThrow(); });
