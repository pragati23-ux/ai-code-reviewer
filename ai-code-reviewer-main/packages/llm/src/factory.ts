import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';
import { LLMError } from './types';
import type { LLMProvider, ProviderConfig } from './types';

/** Builds a provider for the given config, validating required credentials. */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      requireApiKey(config);
      return new AnthropicProvider(config);
    case 'openai':
      requireApiKey(config);
      return new OpenAIProvider(config);
    case 'openai-compatible':
      requireBaseUrl(config);
      return new OpenAIProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default:
      return unknownProvider(config.provider);
  }
}

function requireApiKey(config: ProviderConfig): void {
  if (!config.apiKey) {
    throw new LLMError(`Missing apiKey for provider "${config.provider}"`, 'config', false);
  }
}

function requireBaseUrl(config: ProviderConfig): void {
  if (!config.baseUrl) {
    throw new LLMError('Missing baseUrl for provider "openai-compatible"', 'config', false);
  }
}

function unknownProvider(provider: never): never {
  throw new LLMError(`Unknown provider kind "${String(provider)}"`, 'config', false);
}
