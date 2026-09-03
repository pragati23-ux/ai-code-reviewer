import { withRetry } from './retry';
import {
  asArray,
  asRecord,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  extractUsage,
  parseJsonString,
  postJson,
} from './http';
import type { LLMProvider, ProviderConfig, StructuredRequest, StructuredResponse } from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

type Sleep = (ms: number) => Promise<void>;

/** Serves both the `openai` and `openai-compatible` provider kinds. */
export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly sleep?: Sleep;

  constructor(config: ProviderConfig, sleep?: Sleep) {
    this.name = config.provider === 'openai-compatible' ? 'openai-compatible' : 'openai';
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.sleep = sleep;
  }

  complete(req: StructuredRequest): Promise<StructuredResponse> {
    return withRetry(() => this.send(req), { maxRetries: this.maxRetries, sleep: this.sleep });
  }

  private async send(req: StructuredRequest): Promise<StructuredResponse> {
    const data = await postJson({
      url: `${this.baseUrl}/chat/completions`,
      headers: this.buildHeaders(),
      body: this.buildBody(req),
      timeoutMs: req.opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      redact: this.apiKey ? [this.apiKey] : undefined,
    });
    return parseResponse(data);
  }

  private buildHeaders(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  private buildBody(req: StructuredRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.opts?.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: req.opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
      tools: [
        {
          type: 'function',
          function: {
            name: req.schemaName,
            description: `Report the result by calling ${req.schemaName}.`,
            parameters: req.schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: req.schemaName } },
    };
  }
}

function parseResponse(data: unknown): StructuredResponse {
  const root = asRecord(data);
  const choices = asArray(root?.choices);
  const message = choices ? asRecord(asRecord(choices[0])?.message) : null;
  const toolCalls = asArray(message?.tool_calls);
  const fn = toolCalls ? asRecord(asRecord(toolCalls[0])?.function) : null;
  const output = parseJsonString(fn?.arguments, 'OpenAI response had no valid tool_call arguments');
  return { output, usage: extractUsage(root?.usage, 'prompt_tokens', 'completion_tokens') };
}
