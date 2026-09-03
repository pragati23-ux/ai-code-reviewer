import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type {
  LLMProvider,
  LLMUsage,
  StructuredRequest,
  StructuredResponse,
} from '@acr/llm';

import { DEFAULT_CONFIG } from '../src/types';
import type {
  ChangedFile,
  DiffLine,
  Hunk,
  PRMeta,
  ReviewConfig,
} from '../src/types';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Build a ReviewConfig from DEFAULT_CONFIG with overrides. */
export function reviewConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/** Build a ChangedFile with sensible defaults. */
export function changedFile(
  partial: Partial<ChangedFile> & { readonly path: string },
): ChangedFile {
  return {
    path: partial.path,
    oldPath: partial.oldPath ?? null,
    status: partial.status ?? 'modified',
    binary: partial.binary ?? false,
    hunks: partial.hunks ?? [],
  };
}

/** Build a single add DiffLine at a given new-file line number. */
export function addLine(newLine: number, content: string): DiffLine {
  return { kind: 'add', content, oldLine: null, newLine };
}

/** Build a Hunk from explicit lines. */
export function makeHunk(lines: readonly DiffLine[], header = '@@ -1 +1 @@'): Hunk {
  return { header, oldStart: 1, oldLines: 1, newStart: 1, newLines: lines.length, lines };
}

/** Build a hunk of `count` add lines, each padded to `width` chars. */
export function bigHunk(count: number, width: number, startLine = 1): Hunk {
  const lines: DiffLine[] = Array.from({ length: count }, (_unused, offset) =>
    addLine(startLine + offset, 'x'.repeat(width)),
  );
  return makeHunk(lines, `@@ -${startLine} +${startLine},${count} @@`);
}

export const sampleMeta: PRMeta = {
  title: 'Add sum helper',
  description: 'Refactor addition into a named helper.',
  baseSha: 'base123',
  headSha: 'head456',
};

/** Read a diff fixture by name (without extension). */
export function fixture(name: string): string {
  return readFileSync(path.join(dirname, 'fixtures', `${name}.diff`), 'utf8');
}

/** Assert a value is present and return it narrowed (for noUncheckedIndexedAccess). */
export function req<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

export type StubStep =
  | { readonly output: unknown; readonly usage?: LLMUsage | null }
  | { readonly throw: Error };

/** A provider whose responses are scripted per call; records every request. */
export function scriptedProvider(steps: readonly StubStep[]): {
  provider: LLMProvider;
  calls: StructuredRequest[];
} {
  const calls: StructuredRequest[] = [];
  let index = 0;
  const provider: LLMProvider = {
    name: 'stub',
    complete(request: StructuredRequest): Promise<StructuredResponse> {
      calls.push(request);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) throw new Error('no scripted step');
      if ('throw' in step) return Promise.reject(step.throw);
      return Promise.resolve({ output: step.output, usage: step.usage ?? null });
    },
  };
  return { provider, calls };
}

/** Build an LLMError-like object without importing the runtime class. */
export function llmErrorLike(code: string, message = 'stub llm error'): Error {
  const error = new Error(message);
  error.name = 'LLMError';
  Object.assign(error, { code, retryable: false });
  return error;
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
