/** Page-local ownership. Lease tokens never enter model requests or persistent storage. */
export class AgentPageLease {
  readonly #url: () => string;
  readonly #occupied: () => boolean;
  #token?: string;
  #originalUrl?: string;
  constructor(url: () => string, occupied: () => boolean) { this.#url = url; this.#occupied = occupied; }
  begin(): string {
    const url = this.#url();
    if (this.#token || this.#occupied()) throw new Error('另一个填写任务尚未结束');
    if (!/^https?:\/\//u.test(url)) throw new Error('当前页面无法启动 Agent');
    this.#token = crypto.randomUUID(); this.#originalUrl = url; return this.#token;
  }
  holdsPage(): boolean { return this.#token !== undefined; }
  mayWrite(token?: string): boolean {
    if (token === undefined) return this.#token === undefined;
    return token === this.#token && this.#url() === this.#originalUrl;
  }
  end(token: string): boolean {
    // Navigation revokes writing but must not prevent the owner from releasing the stopped intent.
    if (!this.#token || token !== this.#token) return false;
    this.#token = undefined; this.#originalUrl = undefined; return true;
  }
}
