import { describe, expect, it } from 'vitest';

import { parseFindings } from '../src/response-parser';
import type { ReviewUnit } from '../src/chunker';
import { req } from './helpers';

const unit: ReviewUnit = {
  path: 'src/f.ts',
  status: 'modified',
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: 'context', content: 'a', oldLine: 1, newLine: 1 },
        { kind: 'add', content: 'b', oldLine: null, newLine: 2 },
        { kind: 'del', content: 'gone', oldLine: 2, newLine: null },
        { kind: 'context', content: 'c', oldLine: 3, newLine: 3 },
      ],
    },
  ],
};

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    line: 2,
    severity: 'high',
    category: 'correctness',
    message: 'Off-by-one',
    rationale: 'It reads past the end.',
    suggestion: 'return a - b;',
    confidence: 0.8,
    ...overrides,
  };
}

describe('parseFindings', () => {
  it('accepts a valid response and forces file to the unit path', () => {
    const { findings, error } = parseFindings(
      { findings: [finding({ file: 'MODEL-WRONG.ts' })] },
      unit,
    );
    expect(error).toBeNull();
    expect(findings).toHaveLength(1);
    const f = req(findings[0]);
    expect(f.file).toBe('src/f.ts');
    expect(f.line).toBe(2);
    expect(f.suggestion).toBe('return a - b;');
  });

  it('drops findings anchored to non-anchorable lines without erroring', () => {
    const { findings, error } = parseFindings(
      { findings: [finding({ line: 99 }), finding({ line: 3 })] },
      unit,
    );
    expect(error).toBeNull();
    expect(findings.map((f) => f.line)).toEqual([3]);
  });

  it('does not anchor to deleted lines', () => {
    // newLine of the deleted line is null, so line 2 stays anchorable via the add line only.
    const { findings } = parseFindings({ findings: [finding({ line: 1 })] }, unit);
    expect(findings.map((f) => f.line)).toEqual([1]);
  });

  it('clamps confidence into [0, 1]', () => {
    const { findings } = parseFindings(
      {
        findings: [
          finding({ line: 1, confidence: 1.7 }),
          finding({ line: 3, confidence: -0.4 }),
        ],
      },
      unit,
    );
    expect(req(findings[0]).confidence).toBe(1);
    expect(req(findings[1]).confidence).toBe(0);
  });

  it('accepts a null suggestion', () => {
    const { findings } = parseFindings({ findings: [finding({ suggestion: null })] }, unit);
    expect(req(findings[0]).suggestion).toBeNull();
  });

  it('nullifies a multi-line suggestion to enforce the single-line contract', () => {
    const { findings } = parseFindings(
      { findings: [finding({ suggestion: 'const x = 1;\nconst y = 2;' })] },
      unit,
    );
    expect(req(findings[0]).suggestion).toBeNull();
  });

  it('nullifies a suggestion with a trailing newline', () => {
    const { findings } = parseFindings(
      { findings: [finding({ suggestion: 'const x = 1;\n' })] },
      unit,
    );
    expect(req(findings[0]).suggestion).toBeNull();
  });

  it('nullifies an empty or whitespace-only suggestion', () => {
    const empty = parseFindings({ findings: [finding({ line: 1, suggestion: '' })] }, unit);
    expect(req(empty.findings[0]).suggestion).toBeNull();
    const whitespace = parseFindings({ findings: [finding({ line: 3, suggestion: '   ' })] }, unit);
    expect(req(whitespace.findings[0]).suggestion).toBeNull();
  });

  it('preserves a valid single-line suggestion including its indentation', () => {
    const { findings } = parseFindings(
      { findings: [finding({ suggestion: '    return a - b;' })] },
      unit,
    );
    expect(req(findings[0]).suggestion).toBe('    return a - b;');
  });

  it('returns an empty findings array for an empty response', () => {
    expect(parseFindings({ findings: [] }, unit)).toEqual({ findings: [], error: null });
  });

  it('reports an error when findings is missing', () => {
    const { findings, error } = parseFindings({}, unit);
    expect(findings).toEqual([]);
    expect(error).toBeTypeOf('string');
    expect(error).not.toBe('');
  });

  it('reports an error for an invalid severity enum', () => {
    const { error } = parseFindings({ findings: [finding({ severity: 'blocker' })] }, unit);
    expect(error).toBeTypeOf('string');
  });

  it('reports an error for a non-integer or sub-1 line', () => {
    expect(parseFindings({ findings: [finding({ line: 0 })] }, unit).error).toBeTypeOf('string');
    expect(parseFindings({ findings: [finding({ line: 1.5 })] }, unit).error).toBeTypeOf('string');
  });

  it('reports an error for non-object output', () => {
    expect(parseFindings(null, unit).error).toBeTypeOf('string');
    expect(parseFindings('nope', unit).error).toBeTypeOf('string');
  });
});
