import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../src/ollama';
import type { ProviderConfig, StructuredRequest } from '../src/types';

function mockResponse(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(''),
  };
}

const CONFIG: ProviderConfig = {
  provider: 'ollama',
  model: 'qwen2.5-coder',
};

const REQUEST: StructuredRequest = {
  messages: [
    { role: 'system', content: 'You are a reviewer.' },
    { role: 'user', content: 'Review this diff.' },
  ],
  schema: { type: 'object', properties: { findings: { type: 'array' } } },
  schemaName: 'report_findings',
};

const OK_PAYLOAD = {
  message: { role: 'assistant', content: '{"findings":[{"line":9}]}' },
  prompt_eval_count: 42,
  eval_count: 7,
};

let fetchMock: ReturnType<typeof vi.fn>;
const noWait = vi.fn().mockResolvedValue(undefined);

function lastInit() {
  return fetchMock.mock.calls.at(-1)![1] as { headers: Record<string, string>; body: string };
}

function lastBody() {
  return JSON.parse(lastInit().body) as Record<string, unknown>;
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

describe('OllamaProvider request', () => {
  it('POSTs to /api/chat on localhost by default with no auth header', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    const provider = new OllamaProvider(CONFIG);
    expect(provider.name).toBe('ollama');

    await provider.complete(REQUEST);

    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:11434/api/chat');
    expect(lastInit().headers.authorization).toBeUndefined();
    expect(lastInit().headers['content-type']).toBe('application/json');
  });

  it('builds a non-streaming body with the schema as the format', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OllamaProvider(CONFIG).complete(REQUEST);

    const body = lastBody();
    expect(body.model).toBe('qwen2.5-coder');
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(REQUEST.schema);
    expect(body.options).toEqual({ temperature: 0 });
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: 'Review this diff.' },
    ]);
  });

  it('honors a custom baseUrl and temperature override', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OllamaProvider({ ...CONFIG, baseUrl: 'http://ollama.internal:8080' }).complete({
      ...REQUEST,
      opts: { temperature: 0.9 },
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('http://ollama.internal:8080/api/chat');
    expect((lastBody().options as Record<string, unknown>).temperature).toBe(0.9);
  });
});

describe('OllamaProvider response parsing', () => {
  it('parses message.content JSON and maps eval counts to usage', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    const res = await new OllamaProvider(CONFIG).complete(REQUEST);

    expect(res.output).toEqual({ findings: [{ line: 9 }] });
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
  });

  it('returns null usage when eval counts are absent', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { message: { content: '{"findings":[]}' } }),
    );

    const res = await new OllamaProvider(CONFIG).complete(REQUEST);
    expect(res.usage).toBeNull();
  });

  it('throws bad_response when message.content is not valid JSON', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { message: { content: 'oops' } }));

    await expect(new OllamaProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
      retryable: false,
    });
  });

  it('throws bad_response when the message is missing', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {}));

    await expect(new OllamaProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
    });
  });
});

describe('OllamaProvider transport', () => {
  it('routes retryable failures through the transport', async () => {
    fetchMock.mockResolvedValue(mockResponse(503, {}));

    const provider = new OllamaProvider({ ...CONFIG, maxRetries: 1 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      code: 'server',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
