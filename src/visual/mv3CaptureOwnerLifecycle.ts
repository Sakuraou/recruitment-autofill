import type { Mv3CaptureLifecycle } from './mv3CaptureLifecycle';
export type CaptureOwnerEndReason = 'stop' | 'navigation' | 'disconnect';
export interface CaptureOwnerLease { onEnd(listener: (reason: CaptureOwnerEndReason) => void): () => void }
export function bindCaptureLifecycleToOwner(lease: CaptureOwnerLease, lifecycle: Mv3CaptureLifecycle): () => void { return lease.onEnd(reason => { lifecycle.cancelAll(reason); }); }
