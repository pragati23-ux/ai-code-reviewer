import { describe, expect, it } from 'vitest';

import { chunkFiles } from '../src/chunker';
import { buildMessages, estimatePromptOverhead } from '../src/prompt-builder';
import { review } from '../src/reviewer';
import { bigHunk, changedFile, reviewConfig, sampleMeta, scriptedProvider } from './helpers';

describe('estimatePromptOverhead', () => {
  it('accounts for the fixed prompt scaffolding plus a safety margin', () => {
    const overhead = estimatePromptOverhead(sampleMeta, reviewConfig());
    expect(overhead).toBeGreaterThanOrEqual(128);
  });

  it('grows with the size of the injected guidelines', () => {
    const base = estimatePromptOverhead(sampleMeta, reviewConfig());
    const withGuidelines = estimatePromptOverhead(
      sampleMeta,
      reviewConfig({ guidelines: 'g'.repeat(4000) }),
    );
    expect(withGuidelines - base).toBeGreaterThanOrEqual(1000);
  });
});

describe('prompt injection hardening', () => {
  it('declares the PR title, description and diff as untrusted data', () => {
    const unit = { path: 'a.ts', status: 'modified' as const, hunks: [bigHunk(1, 10)] };
    const [system] = buildMessages(unit, sampleMeta, reviewConfig());
    expect(system?.role).toBe('system');
    expect(system?.content).toMatch(/untrusted data/i);
    expect(system?.content).toMatch(/not instructions/i);
  });
});

describe('chunkFiles with prompt overhead', () => {
  // bigHunk(20, 100) renders to roughly 540 estimated tokens.
  const file = changedFile({ path: 'src/a.ts', hunks: [bigHunk(20, 100)] });

  it('keeps a fitting file as one unit when there is no overhead', () => {
    const { units, skipped } = chunkFiles([file], reviewConfig({ maxTokensPerCall: 600 }), 0);
    expect(units).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it('subtracts the overhead from the per-call budget', () => {
    const { units, skipped } = chunkFiles([file], reviewConfig({ maxTokensPerCall: 600 }), 500);
    expect(units).toHaveLength(0);
    expect(skipped).toEqual([{ path: 'src/a.ts', reason: 'too_large' }]);
  });

  it('never lets overhead shrink the budget below the minimum floor', () => {
    const small = changedFile({ path: 'src/b.ts', hunks: [bigHunk(5, 100)] });
    const { units, skipped } = chunkFiles([small], reviewConfig({ maxTokensPerCall: 300 }), 10000);
    expect(units).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});

describe('review applies prompt overhead to the chunk budget', () => {
  it('skips a file as too_large when huge guidelines exhaust the call budget', async () => {
    const { provider, calls } = scriptedProvider([{ output: { findings: [] } }]);
    const result = await review(
      {
        meta: sampleMeta,
        files: [changedFile({ path: 'src/a.ts', hunks: [bigHunk(20, 100)] })],
        config: reviewConfig({ guidelines: 'g'.repeat(60000) }),
      },
      provider,
    );
    expect(calls).toHaveLength(0);
    expect(result.summary.skipped).toEqual([{ path: 'src/a.ts', reason: 'too_large' }]);
    expect(result.summary.filesReviewed).toBe(0);
  });
});
