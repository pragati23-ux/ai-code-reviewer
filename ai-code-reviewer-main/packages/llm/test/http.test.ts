import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJson } from '../src/http';
import { LLMError } from '../src/types';

describe('postJson error normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an already-classified auth error when the timeout fires during body read', async () => {
    // 401 arrives before the deadline, but reading the error body straddles it:
    // the timeout timer fires (timedOut=true) while text() is still pending.
    const text = () => new Promise<string>((resolve) => setTimeout(() => resolve('unauthorized'), 30));
    const res = { ok: false, status: 401, text } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const err: unknown = await postJson({
      url: 'https://api.example.test/v1/messages',
      headers: {},
      body: {},
      timeoutMs: 5,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).code).toBe('auth');
    expect((err as LLMError).retryable).toBe(false);
  });

  it('labels a success-body read interrupted by the deadline as timeout, not bad_response', async () => {
    // 200 headers arrive before the deadline; the abort fires while the body
    // is being read, making json() reject with an AbortError.
    const json = () =>
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), 30);
      });
    const res = { ok: true, status: 200, json } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const err: unknown = await postJson({
      url: 'https://api.example.test/v1/messages',
      headers: {},
      body: {},
      timeoutMs: 5,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).code).toBe('timeout');
    expect((err as LLMError).retryable).toBe(true);
  });

  it('maps an abort caused by the deadline to a retryable timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );

    const err: unknown = await postJson({
      url: 'https://api.example.test/v1/messages',
      headers: {},
      body: {},
      timeoutMs: 5,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).code).toBe('timeout');
    expect((err as LLMError).retryable).toBe(true);
  });
});
