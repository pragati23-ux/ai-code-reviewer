import { LLMError } from './types';

export interface RetryOpts {
  /** Maximum retry attempts after the initial try. */
  readonly maxRetries: number;
  /** Base backoff delay in milliseconds. Default 500. */
  readonly baseDelayMs?: number;
  /** Injectable delay, used by tests to avoid real waiting. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs `fn`, retrying only retryable {@link LLMError}s with full-jitter
 * exponential backoff. Non-retryable errors (and non-LLMErrors) throw at once;
 * exhausting the retry budget rethrows the last error.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LLMError) || !err.retryable || attempt >= opts.maxRetries) {
        throw err;
      }
      const ceiling = Math.min(MAX_DELAY_MS, baseDelayMs * 2 ** attempt);
      await sleep(Math.random() * ceiling);
    }
  }
}
