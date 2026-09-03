import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../src/anthropic';
import { LLMError } from '../src/types';
import type { ProviderConfig, StructuredRequest } from '../src/types';

interface MockResponseInit {
  readonly status?: number;
  readonly json?: unknown;
  readonly jsonThrows?: boolean;
  readonly text?: string;
  readonly textThrows?: boolean;
}

function mockResponse(init: MockResponseInit) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: init.jsonThrows
      ? () => Promise.reject(new Error('bad json'))
      : () => Promise.resolve(init.json),
    text: init.textThrows
      ? () => Promise.reject(new Error('no text'))
      : () => Promise.resolve(init.text ?? ''),
  };
}

const API_KEY = 'sk-secret-abcdef';

const CONFIG: ProviderConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  apiKey: API_KEY,
};

const REQUEST: StructuredRequest = {
  messages: [
    { role: 'system', content: 'You are a reviewer.' },
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'Review this diff.' },
    { role: 'assistant', content: 'Understood.' },
  ],
  schema: { type: 'object', properties: { findings: { type: 'array' } } },
  schemaName: 'report_findings',
};

const OK_PAYLOAD = {
  content: [
    { type: 'text', text: 'reasoning' },
    { type: 'tool_use', name: 'report_findings', input: { findings: [{ line: 3 }] } },
  ],
  usage: { input_tokens: 12, output_tokens: 34 },
};

let fetchMock: ReturnType<typeof vi.fn>;
const noWait = vi.fn().mockResolvedValue(undefined);

function lastBody() {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse(call![1].body as string) as Record<string, unknown>;
}

function lastInit() {
  return fetchMock.mock.calls.at(-1)![1] as { headers: Record<string, string>; method: string };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  noWait.mockClear();
});

describe('AnthropicProvider request', () => {
  it('POSTs to the messages endpoint with the correct headers', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: OK_PAYLOAD }));

    await new AnthropicProvider(CONFIG).complete(REQUEST);

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe(API_KEY);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('builds a body with tool forcing, defaults, and merged system prompt', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: OK_PAYLOAD }));

    await new AnthropicProvider(CONFIG).complete(REQUEST);

    const body = lastBody();
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0);
    expect(body.system).toBe('You are a reviewer.\n\nBe terse.');
    expect(body.messages).toEqual([
      { role: 'user', content: 'Review this diff.' },
      { role: 'assistant', content: 'Understood.' },
    ]);
    expect(body.tools).toEqual([
      {
        name: 'report_findings',
        description: expect.any(String),
        input_schema: REQUEST.schema,
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_findings' });
  });

  it('omits the system field when there are no system messages', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: OK_PAYLOAD }));

    await new AnthropicProvider(CONFIG).complete({
      ...REQUEST,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(lastBody().system).toBeUndefined();
  });

  it('honors opts overrides and a custom baseUrl', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: OK_PAYLOAD }));

    await new AnthropicProvider({ ...CONFIG, baseUrl: 'https://proxy.example/api' }).complete({
      ...REQUEST,
      opts: { maxTokens: 100, temperature: 0.7, timeoutMs: 5000 },
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://proxy.example/api/v1/messages');
    const body = lastBody();
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.7);
  });
});

describe('AnthropicProvider response parsing', () => {
  it('extracts the tool_use input and usage', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: OK_PAYLOAD }));

    const res = await new AnthropicProvider(CONFIG).complete(REQUEST);

    expect(res.output).toEqual({ findings: [{ line: 3 }] });
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('returns null usage when the provider omits it', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ json: { content: [{ type: 'tool_use', name: 'report_findings', input: {} }] } }),
    );

    const res = await new AnthropicProvider(CONFIG).complete(REQUEST);
    expect(res.usage).toBeNull();
  });

  it('throws bad_response (not retryable) when no tool_use block is present', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { content: [{ type: 'text', text: 'no tool' }] } }));

    await expect(new AnthropicProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws bad_response when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse({ jsonThrows: true }));

    await expect(new AnthropicProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
      retryable: false,
    });
  });
});

describe('AnthropicProvider HTTP error mapping', () => {
  const cases: ReadonlyArray<{ status: number; code: string; retryable: boolean }> = [
    { status: 401, code: 'auth', retryable: false },
    { status: 403, code: 'auth', retryable: false },
    { status: 408, code: 'timeout', retryable: true },
    { status: 429, code: 'rate_limit', retryable: true },
    { status: 500, code: 'server', retryable: true },
    { status: 503, code: 'server', retryable: true },
    { status: 400, code: 'bad_response', retryable: false },
  ];

  for (const { status, code, retryable } of cases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      fetchMock.mockResolvedValue(mockResponse({ status, text: 'server said no' }));

      const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 0 }, noWait);
      await expect(provider.complete(REQUEST)).rejects.toMatchObject({ code, retryable });
    });
  }

  it('maps a fetch rejection to a retryable network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 0 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ code: 'network', retryable: true });
  });

  it('maps an aborted request to a retryable timeout error', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 0 }, noWait);
    await expect(
      provider.complete({ ...REQUEST, opts: { timeoutMs: 5 } }),
    ).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  it('tolerates a body reader that throws while building the error detail', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 500, textThrows: true }));

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 0 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ code: 'server' });
  });

  it('never leaks the api key in the thrown error', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 401, text: `denied for ${API_KEY}` }));

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 0 }, noWait);
    const err = await provider.complete(REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).message).not.toContain(API_KEY);
  });
});

describe('AnthropicProvider retry behavior', () => {
  it('retries retryable statuses up to maxRetries then throws the last error', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 429, text: 'slow down' }));

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 2 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ code: 'rate_limit' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(noWait).toHaveBeenCalledTimes(2);
  });

  it('recovers when a retryable failure is followed by success', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ status: 500, text: 'oops' }))
      .mockResolvedValueOnce(mockResponse({ json: OK_PAYLOAD }));

    const provider = new AnthropicProvider(CONFIG, noWait);
    const res = await provider.complete(REQUEST);

    expect(res.output).toEqual({ findings: [{ line: 3 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(noWait).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable status', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 401, text: 'bad key' }));

    const provider = new AnthropicProvider({ ...CONFIG, maxRetries: 3 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({ code: 'auth' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(noWait).not.toHaveBeenCalled();
  });
});
