// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createMv3CaptureBackgroundPortHandler, MV3_CAPTURE_PORT, type CapturePort } from '../src/visual/mv3CaptureBackgroundPort';
import { createCaptureRateLimiter } from '../src/visual/captureRateLimiter';
afterEach(() => vi.useRealTimers());
it('spaces concurrent slots so a burst cannot exceed two actual captures in a second', async () => {
  vi.useFakeTimers(); const wait = createCaptureRateLimiter(), times: number[] = [];
  const pending = [0, 1, 2, 3].map(async () => { await wait(new AbortController().signal); times.push(performance.now()); });
  await vi.advanceTimersByTimeAsync(1800); await Promise.all(pending);
  expect(times).toEqual([0, 600, 1200, 1800]);
});
it('settles a cancelled queued slot without a late success', async () => {
  vi.useFakeTimers(); const wait = createCaptureRateLimiter();
  const first = wait(new AbortController().signal); await vi.advanceTimersByTimeAsync(0); await first;
  const controller = new AbortController(), done = vi.fn();
  const queued = wait(controller.signal).then(done, () => 'cancelled'); controller.abort();
  expect(await queued).toBe('cancelled'); await vi.advanceTimersByTimeAsync(1000); expect(done).not.toHaveBeenCalled();
});
function setup(deadlineMs = 10_000) {
  let message!: (value: unknown) => void, disconnect!: () => void;
  const replies: unknown[] = [], captures: number[] = [];
  const target = { tabId: 1, windowId: 2, url: 'https://fictional.invalid/' };
  let actual = { ...target, revision: 1 };
  const port: CapturePort = { name: MV3_CAPTURE_PORT, sender: { id: 'extension', url: 'chrome-extension://extension/popup.html' },
    onMessage: { addListener: fn => { message = fn; } }, onDisconnect: { addListener: fn => { disconnect = fn; } },
    postMessage: value => { replies.push(value); }, disconnect: vi.fn(),
  };
  const handler = createMv3CaptureBackgroundPortHandler({ extensionId: 'extension', popupUrl: port.sender!.url!, deadlineMs,
    getActiveTabContext: async () => actual,
    captureVisibleTab: (_window, _options, callback) => { captures.push(performance.now()); callback('data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAA'); },
  });
  handler(port);
  return { handler, captures, replies, disconnect: () => disconnect(), move: () => { actual = { ...actual, tabId: 99, revision: 2 }; },
    capture: (id: string) => message({ type: 'capture', requestId: id, target }), stop: (id: string) => message({ type: 'stop', requestId: id }) };
}
it('applies the same rate gate to actual background port calls', async () => {
  vi.useFakeTimers(); const s = setup();
  for (const [index, at] of [0, 600, 1200].entries()) {
    s.capture('capture-' + index); await vi.advanceTimersByTimeAsync(index === 0 ? 0 : 600);
    expect(s.captures.at(-1)).toBe(at);
  }
  expect(s.replies).toHaveLength(3); s.handler.dispose();
});
it.each(['stop', 'disconnect', 'deadline', 'context'])('rechecks queued %s and does not capture the later page', async mode => {
  vi.useFakeTimers(); const s = setup(mode === 'deadline' ? 200 : 10_000);
  s.capture('capture-0'); await vi.advanceTimersByTimeAsync(0); s.capture('capture-1');
  if (mode === 'stop') s.stop('capture-1');
  else if (mode === 'disconnect') s.disconnect();
  else if (mode === 'context') s.move();
  await vi.advanceTimersByTimeAsync(1200); expect(s.captures).toEqual([0]); s.handler.dispose();
});
