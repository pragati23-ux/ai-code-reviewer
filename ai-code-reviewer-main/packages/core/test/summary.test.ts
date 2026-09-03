import { describe, expect, it } from 'vitest';

import { renderSummaryMarkdown } from '../src/summary';
import type {
  CommentLanguage,
  Finding,
  ReviewResult,
  Severity,
  SkippedFile,
} from '../src/types';

function mkFinding(line: number, severity: Severity, message: string): Finding {
  return {
    file: `src/f${line}.ts`,
    line,
    severity,
    category: 'correctness',
    message,
    rationale: 'why',
    suggestion: null,
    confidence: 0.9,
  };
}

function mkResult(
  findings: readonly Finding[],
  skipped: readonly SkippedFile[] = [],
  filesReviewed = 2,
): ReviewResult {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] += 1;
  return {
    findings,
    summary: {
      totalFindings: findings.length,
      bySeverity,
      filesReviewed,
      skipped,
      usage: { inputTokens: 1200, outputTokens: 340 },
    },
  };
}

function render(result: ReviewResult, language: CommentLanguage = 'en'): string {
  return renderSummaryMarkdown(result, language);
}

describe('renderSummaryMarkdown', () => {
  it('renders totals, a severity table, and top issues in English', () => {
    const out = render(
      mkResult([mkFinding(3, 'critical', 'SQL injection'), mkFinding(7, 'medium', 'Naming')]),
    );
    expect(out).toContain('AI Code Review Summary');
    expect(out).toContain('**2**');
    expect(out).toContain('| 🔴 Critical | 1 |');
    expect(out).toContain('| 🟡 Medium | 1 |');
    expect(out).toContain('`src/f3.ts:3` SQL injection');
    expect(out).toContain('1200 in / 340 out');
  });

  it('shows a clean message when there are no findings', () => {
    const out = render(mkResult([]));
    expect(out).toContain('LGTM');
    expect(out).not.toContain('`src/');
  });

  it('caps top issues at five', () => {
    const many = Array.from({ length: 8 }, (_unused, i) =>
      mkFinding(i + 1, 'high', `issue ${i + 1}`),
    );
    const out = render(mkResult(many));
    expect(out).toContain('5. ');
    expect(out).not.toContain('6. ');
  });

  it('groups skipped files by reason and discloses truncation explicitly', () => {
    const out = render(
      mkResult(
        [],
        [
          { path: 'huge.ts', reason: 'too_large' },
          { path: 'z.ts', reason: 'max_files' },
          { path: 'a.png', reason: 'binary' },
        ],
      ),
    );
    expect(out).toContain('Skipped files');
    expect(out).toMatch(/Too large.*not reviewed/);
    expect(out).toContain('huge.ts');
    expect(out).toMatch(/file limit.*not reviewed/);
    expect(out).toContain('z.ts');
    expect(out).toContain('a.png');
  });

  it('omits the skipped section when nothing was skipped', () => {
    expect(render(mkResult([mkFinding(1, 'high', 'x')]))).not.toContain('Skipped files');
  });

  it('renders Chinese labels for zh-CN', () => {
    const out = render(
      mkResult(
        [mkFinding(3, 'critical', '空指针')],
        [{ path: 'big.ts', reason: 'too_large' }],
      ),
      'zh-CN',
    );
    expect(out).toContain('AI 代码审查摘要');
    expect(out).toContain('严重');
    expect(out).toContain('主要问题');
    expect(out).toContain('未审查');
    expect(out).toContain('big.ts');
  });

  it('shows the Chinese clean message when empty', () => {
    expect(render(mkResult([]), 'zh-CN')).toContain('LGTM');
  });
});
