import { describe, expect, it } from 'vitest';
import * as api from '../src/index';

describe('@acr/llm public contract', () => {
  it('re-exports the factory and retry helpers', () => {
    expect(typeof api.createProvider).toBe('function');
    expect(typeof api.withRetry).toBe('function');
  });

  it('re-exports the three provider classes', () => {
    expect(typeof api.AnthropicProvider).toBe('function');
    expect(typeof api.OpenAIProvider).toBe('function');
    expect(typeof api.OllamaProvider).toBe('function');
  });

  it('re-exports the LLMError class from the frozen contract', () => {
    const err = new api.LLMError('x', 'config', false);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('config');
    expect(err.retryable).toBe(false);
  });

  it('wires createProvider to a working provider instance', () => {
    const provider = api.createProvider({ provider: 'ollama', model: 'qwen2.5-coder' });
    expect(provider.name).toBe('ollama');
    expect(typeof provider.complete).toBe('function');
  });
});
