import { describe, expect, it } from 'vitest';
import { createProvider } from '../src/factory';
import { AnthropicProvider } from '../src/anthropic';
import { OpenAIProvider } from '../src/openai';
import { OllamaProvider } from '../src/ollama';
import { LLMError } from '../src/types';
import type { ProviderConfig } from '../src/types';

describe('createProvider dispatch', () => {
  it('creates an AnthropicProvider when an api key is present', () => {
    const provider = createProvider({ provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'k' });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('creates an OpenAIProvider when an api key is present', () => {
    const provider = createProvider({ provider: 'openai', model: 'gpt-4o', apiKey: 'k' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('creates an OpenAIProvider named openai-compatible when a baseUrl is present', () => {
    const provider = createProvider({
      provider: 'openai-compatible',
      model: 'glm-4',
      baseUrl: 'https://example.com/v1',
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai-compatible');
  });

  it('creates an OllamaProvider without requiring credentials', () => {
    const provider = createProvider({ provider: 'ollama', model: 'qwen2.5-coder' });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });
});

describe('createProvider validation', () => {
  const expectConfigError = (config: ProviderConfig) => {
    try {
      createProvider(config);
      throw new Error('expected createProvider to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      expect(err).toMatchObject({ code: 'config', retryable: false });
      return err as LLMError;
    }
  };

  it('rejects anthropic without an api key', () => {
    expectConfigError({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('rejects openai without an api key', () => {
    expectConfigError({ provider: 'openai', model: 'gpt-4o' });
  });

  it('rejects openai-compatible without a baseUrl', () => {
    expectConfigError({ provider: 'openai-compatible', model: 'glm-4' });
  });

  it('rejects an unknown provider kind', () => {
    expectConfigError({ provider: 'gemini', model: 'x' } as unknown as ProviderConfig);
  });

  it('never includes the api key in the thrown message', () => {
    const err = expectConfigError({ provider: 'anthropic', model: 'm', apiKey: '' });
    expect(err.message).not.toContain('sk-');
  });
});
