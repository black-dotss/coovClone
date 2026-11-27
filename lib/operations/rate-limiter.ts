import { RateLimitCategory, RateLimitConfig, RateLimitResult } from "./types";
import { RateLimitError } from "@/lib/shared/errors";
import { logger } from "@/lib/shared/logger";

interface ClientBucket {
  timestamps: number[];
  strikes: number;
  blockedUntil?: number;
}

const DEFAULT_CONFIGS: Record<RateLimitCategory, RateLimitConfig> = {
  api: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    strikeThreshold: 5,
    blockDurationMs: 15 * 60 * 1000, // 15 mins
  },
  evaluation: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    strikeThreshold: 3,
    blockDurationMs: 15 * 60 * 1000,
  },
  auth: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    strikeThreshold: 3,
    blockDurationMs: 15 * 60 * 1000,
  },
  share_access: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    strikeThreshold: 5,
    blockDurationMs: 15 * 60 * 1000,
  },
  admin: {
    windowMs: 60 * 1000,
    maxRequests: 120,
    strikeThreshold: 10,
    blockDurationMs: 15 * 60 * 1000,
  },
};

class RateLimiter {
  private store = new Map<string, ClientBucket>();

  /**
   * Evaluates rate limit for a client key within a category.
   */
  public check(
    key: string,
    category: RateLimitCategory = "api",
    customConfig?: Partial<RateLimitConfig>
  ): RateLimitResult {
    const config: RateLimitConfig = {
      ...DEFAULT_CONFIGS[category],
      ...customConfig,
    };

    const now = Date.now();
    const storageKey = `${category}:${key}`;
    let bucket = this.store.get(storageKey);

    if (!bucket) {
      bucket = { timestamps: [], strikes: 0 };
      this.store.set(storageKey, bucket);
    }

    // 1. Check if currently blocked due to abuse strikes
    if (bucket.blockedUntil && bucket.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((bucket.blockedUntil - now) / 1000);
      logger.warn("Request rejected: Client IP/Key blocked for abuse", {
        key,
        category,
        retryAfterSeconds,
      });
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(bucket.blockedUntil),
        retryAfterSeconds,
        isBlocked: true,
      };
    }

    // 2. Clear timestamps outside window
    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < config.windowMs);

    // 3. Check rate limit
    if (bucket.timestamps.length >= config.maxRequests) {
      bucket.strikes++;
      const strikeThreshold = config.strikeThreshold ?? 5;

      if (bucket.strikes >= strikeThreshold) {
        const blockDuration = config.blockDurationMs ?? 15 * 60 * 1000;
        bucket.blockedUntil = now + blockDuration;
        const retryAfterSeconds = Math.ceil(blockDuration / 1000);
        logger.warn("Abuse strike threshold reached. Client blocked.", {
          key,
          category,
          strikes: bucket.strikes,
          retryAfterSeconds,
        });
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(bucket.blockedUntil),
          retryAfterSeconds,
          isBlocked: true,
        };
      }

      const oldestTs = bucket.timestamps[0];
      const windowRemainingMs = config.windowMs - (now - oldestTs);
      const retryAfterSeconds = Math.max(1, Math.ceil(windowRemainingMs / 1000));

      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(now + windowRemainingMs),
        retryAfterSeconds,
        isBlocked: false,
      };
    }

    // 4. Record current request timestamp
    bucket.timestamps.push(now);
    const remaining = config.maxRequests - bucket.timestamps.length;
    const resetAt = new Date(now + config.windowMs);

    return {
      allowed: true,
      remaining,
      resetAt,
      isBlocked: false,
    };
  }

  /**
   * Asserts rate limit, throwing standard RateLimitError if exceeded or blocked.
   */
  public assert(
    key: string,
    category: RateLimitCategory = "api",
    customConfig?: Partial<RateLimitConfig>
  ): RateLimitResult {
    const result = this.check(key, category, customConfig);
    if (!result.allowed) {
      throw new RateLimitError(
        result.isBlocked
          ? `Temporarily blocked due to repeated abuse. Retry in ${result.retryAfterSeconds}s.`
          : `Rate limit exceeded. Retry in ${result.retryAfterSeconds}s.`,
        result.retryAfterSeconds
      );
    }
    return result;
  }

  /**
   * Resets rate limit store (for testing or administrative unblocks).
   */
  public reset(key?: string): void {
    if (key) {
      for (const k of this.store.keys()) {
        if (k.endsWith(`:${key}`)) {
          this.store.delete(k);
        }
      }
    } else {
      this.store.clear();
    }
  }

  /**
   * Returns current abuse protection metrics.
   */
  public getMetrics(): { activeBlocks: number; totalStrikes: number } {
    const now = Date.now();
    let activeBlocks = 0;
    let totalStrikes = 0;

    for (const bucket of this.store.values()) {
      totalStrikes += bucket.strikes;
      if (bucket.blockedUntil && bucket.blockedUntil > now) {
        activeBlocks++;
      }
    }

    return { activeBlocks, totalStrikes };
  }
}

export const rateLimiter = new RateLimiter();

export function checkRateLimit(
  key: string,
  category: RateLimitCategory = "api",
  customConfig?: Partial<RateLimitConfig>
): RateLimitResult {
  return rateLimiter.check(key, category, customConfig);
}

export function assertRateLimit(
  key: string,
  category: RateLimitCategory = "api",
  customConfig?: Partial<RateLimitConfig>
): RateLimitResult {
  return rateLimiter.assert(key, category, customConfig);
}
