import { describe, expect, it } from 'vitest';

import { filterFindings } from '../src/finding-filter';
import type { Finding } from '../src/types';
import { reviewConfig } from './helpers';

function mkFinding(
  over: Partial<Finding> & { readonly line: number },
): Finding {
  return {
    file: over.file ?? 'src/a.ts',
    line: over.line,
    severity: over.severity ?? 'high',
    category: over.category ?? 'correctness',
    message: over.message ?? 'msg',
    rationale: over.rationale ?? 'why',
    suggestion: over.suggestion ?? null,
    confidence: over.confidence ?? 0.9,
  };
}

describe('filterFindings', () => {
  it('drops findings below the severity threshold', () => {
    const findings = [
      mkFinding({ line: 1, severity: 'critical' }),
      mkFinding({ line: 2, severity: 'medium' }),
      mkFinding({ line: 3, severity: 'low' }),
    ];
    const kept = filterFindings(findings, reviewConfig({ severityThreshold: 'medium' }));
    expect(kept.map((f) => f.severity)).toEqual(['critical', 'medium']);
  });

  it('drops findings below minConfidence', () => {
    const findings = [
      mkFinding({ line: 1, confidence: 0.9 }),
      mkFinding({ line: 2, confidence: 0.4 }),
    ];
    const kept = filterFindings(findings, reviewConfig({ minConfidence: 0.5 }));
    expect(kept.map((f) => f.line)).toEqual([1]);
  });

  it('dedupes by file:line:category, keeping the higher severity', () => {
    const findings = [
      mkFinding({ line: 5, severity: 'medium', confidence: 0.9, message: 'lower' }),
      mkFinding({ line: 5, severity: 'critical', confidence: 0.6, message: 'higher' }),
    ];
    const kept = filterFindings(findings, reviewConfig());
    expect(kept).toHaveLength(1);
    expect(kept[0]?.severity).toBe('critical');
    expect(kept[0]?.message).toBe('higher');
  });

  it('breaks dedupe ties on confidence', () => {
    const findings = [
      mkFinding({ line: 5, severity: 'high', confidence: 0.6, message: 'lo' }),
      mkFinding({ line: 5, severity: 'high', confidence: 0.95, message: 'hi' }),
    ];
    const kept = filterFindings(findings, reviewConfig());
    expect(kept).toHaveLength(1);
    expect(kept[0]?.message).toBe('hi');
  });

  it('keeps findings on the same line but different category', () => {
    const findings = [
      mkFinding({ line: 5, category: 'security' }),
      mkFinding({ line: 5, category: 'performance' }),
    ];
    expect(filterFindings(findings, reviewConfig())).toHaveLength(2);
  });

  it('sorts by severity, then file, then line', () => {
    const findings = [
      mkFinding({ line: 20, file: 'b.ts', severity: 'high' }),
      mkFinding({ line: 5, file: 'a.ts', severity: 'high' }),
      mkFinding({ line: 1, file: 'a.ts', severity: 'critical' }),
      mkFinding({ line: 2, file: 'a.ts', severity: 'high' }),
    ];
    const kept = filterFindings(findings, reviewConfig());
    expect(kept.map((f) => `${f.severity}:${f.file}:${f.line}`)).toEqual([
      'critical:a.ts:1',
      'high:a.ts:2',
      'high:a.ts:5',
      'high:b.ts:20',
    ]);
  });

  it('caps the number of findings at maxComments', () => {
    const findings: Finding[] = Array.from({ length: 10 }, (_unused, i) =>
      mkFinding({ line: i + 1, severity: 'critical' }),
    );
    const kept = filterFindings(findings, reviewConfig({ maxComments: 3 }));
    expect(kept).toHaveLength(3);
  });

  it('returns an empty array for no input', () => {
    expect(filterFindings([], reviewConfig())).toEqual([]);
  });
});
