export type AgentPageLeaseEndReason = 'stop' | 'navigation' | 'disconnect';
export type AgentPageLeaseEndListener = (reason: AgentPageLeaseEndReason) => void;

/** Page-local ownership. Lease tokens never enter model requests or persistent storage. */
export class AgentPageLease {
  readonly #url: () => string;
  readonly #occupied: () => boolean;
  readonly #endListeners = new Set<AgentPageLeaseEndListener>();
  #token?: string;
  #originalUrl?: string;
  #navigationRevoked=false;
  constructor(url: () => string, occupied: () => boolean) { this.#url = url; this.#occupied = occupied; }
  begin(): string {
    const url = this.#url();
    if (this.#token || this.#occupied()) throw new Error('另一个填写任务尚未结束');
    if (!/^https?:\/\//u.test(url)) throw new Error('当前页面无法启动 Agent');
    this.#token = crypto.randomUUID(); this.#originalUrl = url; this.#navigationRevoked=false; return this.#token;
  }
  holdsPage(): boolean { return this.#token !== undefined; }
  onEnd(listener: AgentPageLeaseEndListener): () => void {
    this.#endListeners.add(listener);
    return () => { this.#endListeners.delete(listener); };
  }
  mayWrite(token?: string): boolean {
    if (token === undefined) return this.#token === undefined;
    if (token !== this.#token) return false;
    if (this.#navigationRevoked) return false;
    if (this.#url() !== this.#originalUrl) {
      this.#navigationRevoked=true; this.#notify('navigation');
      return false;
    }
    return true;
  }
  end(token: string, reason: AgentPageLeaseEndReason = 'stop'): boolean {
    // Navigation revokes writing but must not prevent the owner from releasing the stopped intent.
    if (!this.#token || token !== this.#token) return false;
    this.#finish(reason); return true;
  }
  #finish(reason: AgentPageLeaseEndReason): void {
    if (!this.#token) return;
    const alreadyNotified=this.#navigationRevoked;
    this.#token = undefined; this.#originalUrl = undefined; this.#navigationRevoked=false;
    if(!alreadyNotified)this.#notify(reason);
  }
  #notify(reason:AgentPageLeaseEndReason):void {
    for (const listener of [...this.#endListeners]) {
      try { listener(reason); } catch { /* cleanup is best effort per listener */ }
    }
  }
}
