import { describe, expect, it } from 'vitest';

import {
  FINDINGS_SCHEMA,
  SCHEMA_NAME,
  buildMessages,
  renderHunk,
  renderHunks,
} from '../src/prompt-builder';
import type { ReviewUnit } from '../src/chunker';
import type { Hunk } from '../src/types';
import { req, reviewConfig, sampleMeta } from './helpers';

const hunk: Hunk = {
  header: '@@ -1,3 +1,4 @@',
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [
    { kind: 'context', content: 'function f() {', oldLine: 1, newLine: 1 },
    { kind: 'del', content: '  return a + b;', oldLine: 2, newLine: null },
    { kind: 'add', content: '  return a - b;', oldLine: null, newLine: 2 },
    { kind: 'context', content: '}', oldLine: 3, newLine: 3 },
  ],
};

const unit: ReviewUnit = { path: 'src/f.ts', status: 'modified', hunks: [hunk] };

describe('renderHunk', () => {
  it('renders anchorable line numbers for add/context and blanks for del', () => {
    const text = renderHunk(hunk);
    expect(text).toBe(
      [
        '@@ -1,3 +1,4 @@',
        'L1   function f() {',
        '     -   return a + b;',
        'L2 +   return a - b;',
        'L3   }',
      ].join('\n'),
    );
  });

  it('joins multiple hunks with newlines', () => {
    expect(renderHunks([hunk, hunk])).toBe(`${renderHunk(hunk)}\n${renderHunk(hunk)}`);
  });

  it('renders a header-only hunk when it has no lines', () => {
    const empty: Hunk = {
      header: '@@ -0,0 +0,0 @@',
      oldStart: 0,
      oldLines: 0,
      newStart: 0,
      newLines: 0,
      lines: [],
    };
    expect(renderHunk(empty)).toBe('@@ -0,0 +0,0 @@');
  });

  it('falls back to the old line number when a line lacks a new line', () => {
    const odd: Hunk = {
      header: '@@ -5,1 +5,1 @@',
      oldStart: 5,
      oldLines: 1,
      newStart: 5,
      newLines: 1,
      lines: [{ kind: 'context', content: 'x', oldLine: 5, newLine: null }],
    };
    expect(renderHunk(odd)).toContain('L5   x');
  });
});

describe('SCHEMA_NAME and FINDINGS_SCHEMA', () => {
  it('uses the frozen tool name', () => {
    expect(SCHEMA_NAME).toBe('report_findings');
  });

  it('describes a findings array with the expected enums and bounds', () => {
    const schema = FINDINGS_SCHEMA as {
      properties: {
        findings: {
          items: {
            properties: Record<string, Record<string, unknown>>;
            required: string[];
            additionalProperties: boolean;
          };
        };
      };
    };
    const items = schema.properties.findings.items;
    const props = items.properties;
    expect(req(props.severity).enum).toEqual(['critical', 'high', 'medium', 'low']);
    expect(req(props.category).enum).toEqual([
      'correctness',
      'security',
      'performance',
      'maintainability',
      'style',
      'testing',
      'docs',
    ]);
    expect(req(props.line)).toMatchObject({ type: 'integer', minimum: 1 });
    expect(req(props.confidence)).toMatchObject({ minimum: 0, maximum: 1 });
    expect(req(props.suggestion).type).toEqual(['string', 'null']);
    expect(items.required).toContain('rationale');
    expect(items.additionalProperties).toBe(false);
  });
});

describe('buildMessages', () => {
  it('produces a system then user message', () => {
    const messages = buildMessages(unit, sampleMeta, reviewConfig());
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('includes PR meta, file path, and rendered diff in the user message', () => {
    const user = buildMessages(unit, sampleMeta, reviewConfig())[1]?.content ?? '';
    expect(user).toContain(sampleMeta.title);
    expect(user).toContain(sampleMeta.description);
    expect(user).toContain('src/f.ts (modified)');
    expect(user).toContain('L2 +   return a - b;');
  });

  it('instructs English output by default and Chinese when configured', () => {
    const en = buildMessages(unit, sampleMeta, reviewConfig({ language: 'en' }))[0]?.content ?? '';
    expect(en).toContain('English');
    const zh =
      buildMessages(unit, sampleMeta, reviewConfig({ language: 'zh-CN' }))[0]?.content ?? '';
    expect(zh).toContain('Chinese');
  });

  it('injects guidelines only when provided', () => {
    const without = buildMessages(unit, sampleMeta, reviewConfig({ guidelines: null }))[1]
      ?.content ?? '';
    expect(without).not.toContain('review guidelines');
    const withRules =
      buildMessages(unit, sampleMeta, reviewConfig({ guidelines: 'Prefer const.' }))[1]?.content ??
      '';
    expect(withRules).toContain('Prefer const.');
  });
});
