import { describe, expect, it } from 'vitest';

import { chunkFiles, estimateTokens } from '../src/chunker';
import { renderHunk, renderHunks } from '../src/prompt-builder';
import { bigHunk, changedFile, reviewConfig } from './helpers';

describe('estimateTokens', () => {
  it('is ceil(length / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('chunkFiles', () => {
  it('keeps a file that fits the budget as a single unit', () => {
    const file = changedFile({ path: 'src/a.ts', hunks: [bigHunk(1, 20, 1)] });
    const { units, skipped } = chunkFiles([file], reviewConfig({ maxTokensPerCall: 10_000 }));
    expect(skipped).toEqual([]);
    expect(units).toHaveLength(1);
    expect(units[0]?.path).toBe('src/a.ts');
    expect(units[0]?.hunks).toHaveLength(1);
  });

  it('carries file path and status onto units', () => {
    const file = changedFile({ path: 'src/r.ts', status: 'renamed', hunks: [bigHunk(1, 5)] });
    const { units } = chunkFiles([file], reviewConfig());
    expect(units[0]?.status).toBe('renamed');
  });

  it('splits an oversized file into one unit per hunk when each hunk fits', () => {
    const h1 = bigHunk(1, 400, 11);
    const h2 = bigHunk(1, 400, 22);
    const perHunk = estimateTokens(renderHunk(h1));
    const whole = estimateTokens(renderHunks([h1, h2]));
    expect(whole).toBeGreaterThan(perHunk);

    const file = changedFile({ path: 'src/big.ts', hunks: [h1, h2] });
    const { units, skipped } = chunkFiles([file], reviewConfig({ maxTokensPerCall: whole - 1 }));
    expect(skipped).toEqual([]);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.path === 'src/big.ts')).toBe(true);
    expect(units[0]?.hunks).toHaveLength(1);
    expect(units[1]?.hunks).toHaveLength(1);
  });

  it('packs multiple small hunks into as few units as fit the budget', () => {
    const h1 = bigHunk(1, 40, 11);
    const h2 = bigHunk(1, 40, 22);
    const h3 = bigHunk(1, 40, 33);
    // Budget that fits exactly two of the (equal-width) hunks.
    const budget = estimateTokens(`${renderHunk(h1)}\n${renderHunk(h2)}`);
    const file = changedFile({ path: 'src/pack.ts', hunks: [h1, h2, h3] });
    const { units } = chunkFiles([file], reviewConfig({ maxTokensPerCall: budget }));
    expect(units).toHaveLength(2);
    expect(units[0]?.hunks).toHaveLength(2);
    expect(units[1]?.hunks).toHaveLength(1);
    const total = units.reduce((n, u) => n + u.hunks.length, 0);
    expect(total).toBe(3);
  });

  it('skips a file whose single hunk exceeds the budget as too_large', () => {
    const hunk = bigHunk(1, 400, 1);
    const perHunk = estimateTokens(renderHunk(hunk));
    const file = changedFile({ path: 'src/huge.ts', hunks: [hunk] });
    const { units, skipped } = chunkFiles([file], reviewConfig({ maxTokensPerCall: perHunk - 1 }));
    expect(units).toEqual([]);
    expect(skipped).toEqual([{ path: 'src/huge.ts', reason: 'too_large' }]);
  });

  it('processes multiple files independently', () => {
    const small = changedFile({ path: 'small.ts', hunks: [bigHunk(1, 5)] });
    const huge = changedFile({ path: 'huge.ts', hunks: [bigHunk(1, 400)] });
    const perHunk = estimateTokens(renderHunk(bigHunk(1, 400)));
    const { units, skipped } = chunkFiles(
      [small, huge],
      reviewConfig({ maxTokensPerCall: perHunk - 1 }),
    );
    expect(units.map((u) => u.path)).toEqual(['small.ts']);
    expect(skipped).toEqual([{ path: 'huge.ts', reason: 'too_large' }]);
  });
});
