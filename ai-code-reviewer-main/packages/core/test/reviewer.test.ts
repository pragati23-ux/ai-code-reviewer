import { describe, expect, it } from 'vitest';

import type { LLMProvider, StructuredResponse } from '@acr/llm';

import { parseUnifiedDiff } from '../src/diff-parser';
import { review } from '../src/reviewer';
import type { ReviewRequest } from '../src/types';
import {
  addLine,
  changedFile,
  delay,
  fixture,
  llmErrorLike,
  makeHunk,
  reviewConfig,
  sampleMeta,
  scriptedProvider,
} from './helpers';

const validFinding = {
  line: 2,
  severity: 'high',
  category: 'correctness',
  message: 'Off-by-one error',
  rationale: 'The loop reads one element past the end.',
  suggestion: null,
  confidence: 0.9,
};

function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    meta: sampleMeta,
    files: parseUnifiedDiff(fixture('modify')),
    config: reviewConfig(),
    ...overrides,
  };
}

describe('review', () => {
  it('reviews a unit and aggregates findings on the happy path', async () => {
    const { provider, calls } = scriptedProvider([
      { output: { findings: [validFinding] }, usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    const result = await review(request(), provider);
    expect(calls).toHaveLength(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('src/math.ts');
    expect(result.summary.filesReviewed).toBe(1);
    expect(result.summary.totalFindings).toBe(1);
    expect(result.summary.bySeverity.high).toBe(1);
    expect(result.summary.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('treats null usage as zero', async () => {
    const { provider } = scriptedProvider([{ output: { findings: [] }, usage: null }]);
    const result = await review(request(), provider);
    expect(result.summary.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('repairs once after a validation failure and succeeds', async () => {
    const { provider, calls } = scriptedProvider([
      { output: { findings: 'not-an-array' }, usage: { inputTokens: 4, outputTokens: 1 } },
      { output: { findings: [validFinding] }, usage: { inputTokens: 6, outputTokens: 2 } },
    ]);
    const result = await review(request(), provider);
    expect(calls).toHaveLength(2);
    const repair = calls[1]?.messages.at(-1)?.content ?? '';
    expect(repair).toContain('failed validation');
    expect(result.findings).toHaveLength(1);
    expect(result.summary.filesReviewed).toBe(1);
    // Usage accrues across both attempts.
    expect(result.summary.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
  });

  it('skips the file as llm_error when validation fails twice', async () => {
    const { provider, calls } = scriptedProvider([
      { output: { bad: true } },
      { output: { still: 'bad' } },
    ]);
    const result = await review(request(), provider);
    expect(calls).toHaveLength(2);
    expect(result.findings).toEqual([]);
    expect(result.summary.filesReviewed).toBe(0);
    expect(result.summary.skipped).toContainEqual({ path: 'src/math.ts', reason: 'llm_error' });
  });

  it('skips the file as llm_error when the provider throws an LLMError', async () => {
    const { provider, calls } = scriptedProvider([{ throw: llmErrorLike('rate_limit') }]);
    const result = await review(request(), provider);
    expect(calls).toHaveLength(1);
    expect(result.findings).toEqual([]);
    expect(result.summary.skipped).toContainEqual({ path: 'src/math.ts', reason: 'llm_error' });
  });

  it('propagates non-LLM errors instead of swallowing them', async () => {
    const provider: LLMProvider = {
      name: 'boom',
      complete: () => Promise.reject(new TypeError('unexpected bug')),
    };
    await expect(review(request(), provider)).rejects.toThrow('unexpected bug');
  });

  it('carries partition/chunk skips into the summary and reviews the rest', async () => {
    const { provider } = scriptedProvider([{ output: { findings: [] } }]);
    const result = await review(
      request({ files: parseUnifiedDiff(fixture('multi-file')) }),
      provider,
    );
    // multi-file: src/a.ts + src/keep.ts reviewed; pic.png binary; removed.ts deleted.
    expect(result.summary.filesReviewed).toBe(2);
    expect(result.summary.skipped).toContainEqual({ path: 'assets/pic.png', reason: 'binary' });
    expect(result.summary.skipped).toContainEqual({ path: 'src/removed.ts', reason: 'deleted' });
  });

  it('respects the concurrency limit across many units', async () => {
    let inFlight = 0;
    let max = 0;
    const provider: LLMProvider = {
      name: 'tracking',
      async complete(): Promise<StructuredResponse> {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await delay(4);
        inFlight -= 1;
        return { output: { findings: [] }, usage: null };
      },
    };
    const files = Array.from({ length: 8 }, (_unused, i) =>
      changedFile({ path: `src/f${i}.ts`, hunks: [makeHunk([addLine(1, 'x')])] }),
    );
    const result = await review(
      request({ files, config: reviewConfig({ concurrency: 2 }) }),
      provider,
    );
    expect(max).toBe(2);
    expect(result.summary.filesReviewed).toBe(8);
  });
});
