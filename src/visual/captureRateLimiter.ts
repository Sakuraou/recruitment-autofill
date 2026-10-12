/** Chrome limits captureVisibleTab to two calls/second. Space local captures
 * across ports; cancellation consumes its slot but must never produce a late capture.
 * https://developer.chrome.com/docs/extensions/reference/api/tabs#property-MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND */
export function createCaptureRateLimiter(): (signal: AbortSignal) => Promise<void> {
  let next = 0;
  return signal => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('capture-cancelled')); return; }
    const now = performance.now(), at = Math.max(now, next); next = at + 600;
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('capture-cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, at - now);
    signal.addEventListener('abort', abort, { once: true });
  });
}
