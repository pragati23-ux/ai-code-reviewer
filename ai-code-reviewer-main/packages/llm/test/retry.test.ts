import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/retry';
import { LLMError } from '../src/types';

const retryable = (): LLMError => new LLMError('boom', 'server', true);
const nonRetryable = (): LLMError => new LLMError('nope', 'auth', false);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withRetry', () => {
  it('returns the result and never sleeps when fn succeeds first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 3, sleep })).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a retryable LLMError and resolves once fn succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(retryable()).mockResolvedValue('done');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 3, sleep })).resolves.toBe('done');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable LLMError', async () => {
    const err = nonRetryable();
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 3, sleep })).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a non-LLMError and rethrows it immediately', async () => {
    const err = new Error('plain');
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 3, sleep })).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('exhausts retries and throws the last error', async () => {
    const last = retryable();
    const fn = vi.fn().mockRejectedValueOnce(retryable()).mockRejectedValue(last);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 2, sleep })).rejects.toBe(last);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('applies full-jitter exponential backoff capped at 8000ms (default base 500)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fn = vi.fn().mockRejectedValue(retryable());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 6, sleep })).rejects.toBeInstanceOf(LLMError);

    const delays = sleep.mock.calls.map((c) => c[0] as number);
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('honors a custom baseDelayMs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fn = vi.fn().mockRejectedValue(retryable());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 100, sleep })).rejects.toBeInstanceOf(LLMError);

    const delays = sleep.mock.calls.map((c) => c[0] as number);
    expect(delays).toEqual([100, 200]);
  });

  it('multiplies the ceiling by the jitter factor (random 0.5 -> half)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = vi.fn().mockRejectedValue(retryable());
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(fn, { maxRetries: 2, sleep })).rejects.toBeInstanceOf(LLMError);

    const delays = sleep.mock.calls.map((c) => c[0] as number);
    expect(delays).toEqual([250, 500]);
  });

  it('uses a real timer when no sleep is injected', async () => {
    const fn = vi.fn().mockRejectedValueOnce(retryable()).mockResolvedValue('late');

    // baseDelayMs 0 -> ceiling 0 -> real setTimeout(0), keeps the test fast.
    await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 0 })).resolves.toBe('late');

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
