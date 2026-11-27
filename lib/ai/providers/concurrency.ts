/**
 * Bounded concurrency limiter ensuring no more than `concurrency`
 * asynchronous tasks execute concurrently.
 */
export class ConcurrencyLimiter {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error("Concurrency limit must be at least 1");
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get pending(): number {
    return this.queue.length;
  }
}
