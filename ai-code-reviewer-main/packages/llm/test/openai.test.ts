import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/openai';
import type { ProviderConfig, StructuredRequest } from '../src/types';

function mockResponse(status: number, json: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(''),
  };
}

const API_KEY = 'sk-openai-xyz';

const CONFIG: ProviderConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: API_KEY,
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
  choices: [
    {
      message: {
        tool_calls: [
          { function: { name: 'report_findings', arguments: '{"findings":[{"line":5}]}' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 8 },
};

let fetchMock: ReturnType<typeof vi.fn>;
const noWait = vi.fn().mockResolvedValue(undefined);

function lastInit() {
  return fetchMock.mock.calls.at(-1)![1] as {
    headers: Record<string, string>;
    method: string;
    body: string;
  };
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

describe('OpenAIProvider request', () => {
  it('POSTs to /chat/completions with bearer auth and json content type', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OpenAIProvider(CONFIG).complete(REQUEST);

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('builds a body with all messages, defaults, and forced function tool', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OpenAIProvider(CONFIG).complete(REQUEST);

    const body = lastBody();
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: 'Review this diff.' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'report_findings',
          description: expect.any(String),
          parameters: REQUEST.schema,
        },
      },
    ]);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'report_findings' },
    });
  });

  it('honors opts overrides and a custom baseUrl', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OpenAIProvider({ ...CONFIG, baseUrl: 'https://api.openai.com/v99' }).complete({
      ...REQUEST,
      opts: { maxTokens: 256, temperature: 0.3 },
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.openai.com/v99/chat/completions');
    const body = lastBody();
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0.3);
  });
});

describe('OpenAIProvider as openai-compatible', () => {
  it('reports the openai-compatible name and omits auth when no key is set', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    const provider = new OpenAIProvider({
      provider: 'openai-compatible',
      model: 'glm-4',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    });
    expect(provider.name).toBe('openai-compatible');

    await provider.complete(REQUEST);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
    expect(lastInit().headers.authorization).toBeUndefined();
  });

  it('adds bearer auth for a compatible endpoint that does provide a key', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    await new OpenAIProvider({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'ds-key',
    }).complete(REQUEST);

    expect(lastInit().headers.authorization).toBe('Bearer ds-key');
  });

  it('reports the openai name for the standard provider', () => {
    expect(new OpenAIProvider(CONFIG).name).toBe('openai');
  });
});

describe('OpenAIProvider response parsing', () => {
  it('parses tool_call arguments and usage', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, OK_PAYLOAD));

    const res = await new OpenAIProvider(CONFIG).complete(REQUEST);

    expect(res.output).toEqual({ findings: [{ line: 5 }] });
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  it('returns null usage when the provider omits it', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] } }],
      }),
    );

    const res = await new OpenAIProvider(CONFIG).complete(REQUEST);
    expect(res.usage).toBeNull();
  });

  it('throws bad_response when arguments are not valid JSON', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        choices: [{ message: { tool_calls: [{ function: { arguments: 'not-json' } }] } }],
      }),
    );

    await expect(new OpenAIProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
      retryable: false,
    });
  });

  it('throws bad_response when tool_calls are missing', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { choices: [{ message: {} }] }));

    await expect(new OpenAIProvider(CONFIG).complete(REQUEST)).rejects.toMatchObject({
      code: 'bad_response',
      retryable: false,
    });
  });
});

describe('OpenAIProvider transport', () => {
  it('routes HTTP failures through the retrying transport', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, {}));

    const provider = new OpenAIProvider({ ...CONFIG, maxRetries: 1 }, noWait);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      code: 'server',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
