export interface TokenBucketOptions {
  capacity: number;
  refillTokensPerSecond: number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillTokensPerMs: number;
  private tokens: number;
  private lastRefillMs: number;

  constructor(options: TokenBucketOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.refillTokensPerMs = Math.max(
      0.0001,
      options.refillTokensPerSecond / 1000,
    );
    this.tokens = this.capacity;
    this.lastRefillMs = Date.now();
  }

  consume(cost = 1, nowMs = Date.now()): boolean {
    const safeCost = Math.max(1, cost);
    this.refill(nowMs);
    if (this.tokens < safeCost) {
      return false;
    }
    this.tokens -= safeCost;
    return true;
  }

  getTokens(nowMs = Date.now()): number {
    this.refill(nowMs);
    return this.tokens;
  }

  private refill(nowMs: number) {
    if (nowMs <= this.lastRefillMs) {
      return;
    }
    const elapsedMs = nowMs - this.lastRefillMs;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedMs * this.refillTokensPerMs,
    );
    this.lastRefillMs = nowMs;
  }
}
