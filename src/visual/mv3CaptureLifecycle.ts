export type CaptureCancelReason = 'disconnect' | 'navigation' | 'stop' | 'expired';
export interface CaptureCancellation { readonly requestId: string; readonly reason: CaptureCancelReason }
/** Owns cancellation callbacks outside the page so disconnect/navigation cannot leave a capture alive. */
export class Mv3CaptureLifecycle {
  readonly #active = new Map<string, (reason: CaptureCancelReason) => void>();
  register(requestId: string, cancel: (reason: CaptureCancelReason) => void): boolean {
    if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(requestId) || this.#active.has(requestId)) return false;
    this.#active.set(requestId, cancel); return true;
  }
  complete(requestId: string): boolean { return this.#active.delete(requestId); }
  cancel(requestId: string, reason: CaptureCancelReason): boolean {
    const callback = this.#active.get(requestId); if (!callback) return false;
    this.#active.delete(requestId); try { callback(reason); } catch { /* cancellation remains consumed */ } return true;
  }
  cancelAll(reason: CaptureCancelReason): number {
    const callbacks = [...this.#active.entries()]; this.#active.clear();
    for (const [, callback] of callbacks) { try { callback(reason); } catch { /* best effort per request */ } }
    return callbacks.length;
  }
  size(): number { return this.#active.size; }
}
