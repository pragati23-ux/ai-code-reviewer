import { LLMError } from './types';
import type { LLMErrorCode, LLMUsage } from './types';

export const DEFAULT_TIMEOUT_MS = 120000;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0;
export const DEFAULT_MAX_RETRIES = 3;

const MAX_ERROR_DETAIL = 200;

export interface HttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly timeoutMs: number;
  /** Secret strings to strip from any error detail (e.g. the API key). */
  readonly redact?: readonly string[];
}

interface StatusMapping {
  readonly code: LLMErrorCode;
  readonly retryable: boolean;
}

/** Maps an HTTP status to an {@link LLMError} code and retryability. */
function classifyStatus(status: number): StatusMapping {
  if (status === 401 || status === 403) return { code: 'auth', retryable: false };
  if (status === 408) return { code: 'timeout', retryable: true };
  if (status === 429) return { code: 'rate_limit', retryable: true };
  if (status >= 500) return { code: 'server', retryable: true };
  return { code: 'bad_response', retryable: false };
}

/** POSTs JSON and returns the parsed body, translating failures to LLMError. */
export async function postJson(req: HttpRequest): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, req.timeoutMs);

  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...req.headers },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) throw await statusError(res, req.redact);
    return await parseJson(res, controller.signal);
  } catch (err) {
    throw normalizeError(err, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

async function statusError(res: Response, redact?: readonly string[]): Promise<LLMError> {
  const { code, retryable } = classifyStatus(res.status);
  const detail = await readDetail(res, redact);
  return new LLMError(`HTTP ${res.status}${detail}`, code, retryable);
}

function normalizeError(err: unknown, timedOut: boolean): LLMError {
  // An already-classified error (e.g. auth from a 401) must win over the
  // timeout label: the deadline timer may fire while the error body is read,
  // and relabeling auth as a retryable timeout would trigger useless retries.
  if (err instanceof LLMError) return err;
  // A caught fetch/abort error is client-side and never carries the API key,
  // so preserving it as `cause` is safe and aids diagnosis.
  if (timedOut) return new LLMError('Request timed out', 'timeout', true, { cause: err });
  return new LLMError('Network request failed', 'network', true, { cause: err });
}

async function parseJson(res: Response, signal: AbortSignal): Promise<unknown> {
  try {
    const data: unknown = await res.json();
    return data;
  } catch (err) {
    // A body read interrupted by our own deadline is a timeout, not a malformed
    // response: rethrow untouched so normalizeError applies the timeout label.
    if (signal.aborted) throw err;
    throw new LLMError('Failed to parse response body as JSON', 'bad_response', false);
  }
}

async function readDetail(res: Response, redact?: readonly string[]): Promise<string> {
  try {
    const text = scrub(await res.text(), redact);
    if (!text) return '';
    const trimmed = text.length > MAX_ERROR_DETAIL ? `${text.slice(0, MAX_ERROR_DETAIL)}…` : text;
    return `: ${trimmed}`;
  } catch {
    return '';
  }
}

/** Replaces every occurrence of each non-empty secret with a placeholder. */
function scrub(text: string, redact?: readonly string[]): string {
  if (!redact) return text;
  return redact.reduce((acc, secret) => (secret ? acc.split(secret).join('[REDACTED]') : acc), text);
}

/** Narrows an unknown value to a plain object, or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** Narrows an unknown value to an array, or null. */
export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

/** Parses a JSON string field, throwing bad_response when absent or invalid. */
export function parseJsonString(value: unknown, message: string): unknown {
  if (typeof value !== 'string') throw new LLMError(message, 'bad_response', false);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new LLMError(message, 'bad_response', false);
  }
}

/** Reads two token counts from a record, returning null when either is absent. */
export function extractUsage(value: unknown, inputKey: string, outputKey: string): LLMUsage | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const inputTokens = usage[inputKey];
  const outputTokens = usage[outputKey];
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
  return { inputTokens, outputTokens };
}
