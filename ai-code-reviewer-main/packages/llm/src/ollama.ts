import { withRetry } from './retry';
import {
  asRecord,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  extractUsage,
  parseJsonString,
  postJson,
} from './http';
import type { LLMProvider, ProviderConfig, StructuredRequest, StructuredResponse } from './types';

const DEFAULT_BASE_URL = 'http://localhost:11434';

type Sleep = (ms: number) => Promise<void>;

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly sleep?: Sleep;

  constructor(config: ProviderConfig, sleep?: Sleep) {
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
      url: `${this.baseUrl}/api/chat`,
      headers: {},
      body: this.buildBody(req),
      timeoutMs: req.opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return parseResponse(data);
  }

  private buildBody(req: StructuredRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      format: req.schema,
      options: { temperature: req.opts?.temperature ?? DEFAULT_TEMPERATURE },
    };
  }
}

function parseResponse(data: unknown): StructuredResponse {
  const message = asRecord(asRecord(data)?.message);
  const output = parseJsonString(message?.content, 'Ollama response had no valid message content');
  return { output, usage: extractUsage(data, 'prompt_eval_count', 'eval_count') };
}
