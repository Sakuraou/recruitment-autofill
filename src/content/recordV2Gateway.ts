export type RecordV2GatewayState = 'disabled' | 'idle' | 'ready' | 'running' | 'paused'
  | 'request-human' | 'complete' | 'stopped';

export interface RecordV2GatewayStatus {
  readonly enabled: boolean;
  readonly state: RecordV2GatewayState;
  readonly snapshotVersion: number;
  readonly reason?: string;
}

export interface RecordV2SessionResult {
  readonly status: 'advanced' | 'complete' | 'paused' | 'stopped' | 'busy' | 'request-human';
  readonly snapshotVersion: number;
  readonly reason?: string;
}

export interface RecordV2Session {
  readonly state: Exclude<RecordV2GatewayState, 'disabled' | 'idle'>;
  readonly snapshotVersion: number;
  advance(): Promise<RecordV2SessionResult>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface RecordV2GatewayOptions {
  readonly enabled: boolean;
  readonly createSession?: () => RecordV2Session;
  readonly currentPageKey?: () => string;
}

function pageKey(): string { return `${location.origin}${location.pathname}${location.search}`; }

const resultStatuses = new Set<RecordV2SessionResult['status']>([
  'advanced', 'complete', 'paused', 'stopped', 'busy', 'request-human',
]);

/** Rebuilds the public result so internal planner properties cannot cross the message boundary. */
function publicResult(result: RecordV2SessionResult): RecordV2SessionResult {
  const status = resultStatuses.has(result?.status) ? result.status : 'request-human';
  const snapshotVersion = Number.isSafeInteger(result?.snapshotVersion) && result.snapshotVersion >= 0
    ? result.snapshotVersion : 0;
  const suppliedReason = typeof result?.reason === 'string' && /^[a-z0-9-]{1,80}$/u.test(result.reason)
    ? result.reason : undefined;
  const reason = status === 'request-human' ? suppliedReason ?? 'invalid-session-result' : suppliedReason;
  return Object.freeze({ status, snapshotVersion, ...(reason ? { reason } : {}) });
}

/** Trusted content-script lifecycle boundary. No external request data reaches the session factory. */
export class RecordV2Gateway {
  readonly #enabled: boolean;
  readonly #factory?: () => RecordV2Session;
  readonly #pageKey: () => string;
  #session?: RecordV2Session;
  #sessionPageKey?: string;
  #reason?: string;

  constructor(options: RecordV2GatewayOptions) {
    this.#enabled = options.enabled === true;
    this.#factory = options.createSession;
    this.#pageKey = options.currentPageKey ?? pageKey;
  }

  status(): RecordV2GatewayStatus {
    this.#invalidateNavigation();
    if (!this.#enabled) return Object.freeze({ enabled: false, state: 'disabled', snapshotVersion: 0 });
    if (!this.#session) return Object.freeze({ enabled: true, state: this.#reason ? 'request-human' : 'idle',
      snapshotVersion: 0, ...(this.#reason ? { reason: this.#reason } : {}) });
    return Object.freeze({ enabled: true, state: this.#reason ? 'request-human' : this.#session.state,
      snapshotVersion: this.#session.snapshotVersion, ...(this.#reason ? { reason: this.#reason } : {}) });
  }

  start(): RecordV2GatewayStatus {
    if (!this.#enabled) throw new Error('通用多记录填写功能尚未启用');
    if (!this.#factory) throw new Error('通用多记录填写驱动尚未安装');
    this.#invalidateNavigation();
    if (this.#session && !['complete', 'stopped', 'request-human'].includes(this.#session.state)) {
      throw new Error('通用多记录填写会话已经存在');
    }
    const session = this.#factory();
    if (!session || typeof session.advance !== 'function') throw new Error('通用多记录填写驱动无效');
    this.#session = session;
    this.#sessionPageKey = this.#pageKey();
    this.#reason = undefined;
    return this.status();
  }

  async advance(): Promise<RecordV2SessionResult> {
    this.#requireSession();
    const session = this.#session!;
    const internalResult = await session.advance();
    if (session !== this.#session || this.#sessionPageKey !== this.#pageKey()) {
      if (session === this.#session) {
        session.stop();
        this.#session = undefined;
        this.#sessionPageKey = undefined;
      }
      this.#reason = 'page-changed';
      return Object.freeze({ status: 'request-human', snapshotVersion: 0, reason: 'page-changed' });
    }
    const result = publicResult(internalResult);
    if (result.status === 'request-human') this.#reason = result.reason ?? 'manual-review-required';
    return Object.freeze({ ...result });
  }

  pause(): RecordV2GatewayStatus {
    this.#requireSession();
    this.#session!.pause();
    return this.status();
  }

  resume(): RecordV2GatewayStatus {
    this.#requireSession();
    this.#session!.resume();
    return this.status();
  }

  stop(): RecordV2GatewayStatus {
    if (this.#session) this.#session.stop();
    this.#reason = undefined;
    return this.status();
  }

  #requireSession(): void {
    if (!this.#enabled) throw new Error('通用多记录填写功能尚未启用');
    this.#invalidateNavigation();
    if (!this.#session) throw new Error(this.#reason === 'page-changed' ? '页面已变化，请重新启动' : '请先启动通用多记录填写');
    if (this.#reason) throw new Error('当前会话需要人工处理，请停止后重新启动');
  }

  #invalidateNavigation(): void {
    if (!this.#session || this.#sessionPageKey === this.#pageKey()) return;
    this.#session.stop();
    this.#session = undefined;
    this.#sessionPageKey = undefined;
    this.#reason = 'page-changed';
  }
}
