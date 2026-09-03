import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from '../src/diff-parser';
import { fixture, req } from './helpers';

describe('parseUnifiedDiff', () => {
  it('returns [] for empty or whitespace input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n  \n')).toEqual([]);
  });

  it('parses a single modified file with correct line accounting', () => {
    const files = parseUnifiedDiff(fixture('modify'));
    expect(files).toHaveLength(1);
    const file = req(files[0]);
    expect(file.path).toBe('src/math.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('modified');
    expect(file.binary).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = req(file.hunks[0]);
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);

    expect(hunk.lines.map((l) => l.kind)).toEqual([
      'context',
      'del',
      'add',
      'add',
      'context',
    ]);
    const firstContext = req(hunk.lines[0]);
    expect(firstContext.oldLine).toBe(1);
    expect(firstContext.newLine).toBe(1);
    const del = req(hunk.lines[1]);
    expect(del.oldLine).toBe(2);
    expect(del.newLine).toBeNull();
    const firstAdd = req(hunk.lines[2]);
    expect(firstAdd.oldLine).toBeNull();
    expect(firstAdd.newLine).toBe(2);
    expect(firstAdd.content).toBe('  const sum = a + b;');
    const secondAdd = req(hunk.lines[3]);
    expect(secondAdd.newLine).toBe(3);
    const closeBrace = req(hunk.lines[4]);
    expect(closeBrace.oldLine).toBe(3);
    expect(closeBrace.newLine).toBe(4);
  });

  it('treats a space-prefixed blank line as an empty context line', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,3 @@',
      ' first',
      ' ',
      '+added',
    ].join('\n');
    const hunk = req(req(parseUnifiedDiff(diff)[0]).hunks[0]);
    const blank = req(hunk.lines[1]);
    expect(blank.kind).toBe('context');
    expect(blank.content).toBe('');
    expect(blank.oldLine).toBe(2);
    expect(blank.newLine).toBe(2);
  });

  it('parses an added file (oldPath null, all add lines)', () => {
    const file = req(parseUnifiedDiff(fixture('add'))[0]);
    expect(file.path).toBe('src/new.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('added');
    const hunk = req(file.hunks[0]);
    expect(hunk.oldStart).toBe(0);
    expect(hunk.oldLines).toBe(0);
    expect(hunk.newLines).toBe(3);
    expect(hunk.lines.every((l) => l.kind === 'add')).toBe(true);
    expect(req(hunk.lines[1]).content).toBe('');
    expect(req(hunk.lines[2]).newLine).toBe(3);
  });

  it('parses a deleted file', () => {
    const file = req(parseUnifiedDiff(fixture('delete'))[0]);
    expect(file.path).toBe('src/old.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('deleted');
    const hunk = req(file.hunks[0]);
    expect(hunk.newStart).toBe(0);
    expect(hunk.lines.every((l) => l.kind === 'del')).toBe(true);
    expect(req(hunk.lines[0]).oldLine).toBe(1);
    expect(req(hunk.lines[1]).oldLine).toBe(2);
  });

  it('parses a rename with modifications', () => {
    const file = req(parseUnifiedDiff(fixture('rename'))[0]);
    expect(file.path).toBe('src/new-name.ts');
    expect(file.oldPath).toBe('src/old-name.ts');
    expect(file.status).toBe('renamed');
    expect(file.hunks).toHaveLength(1);
  });

  it('marks binary files with no hunks', () => {
    const file = req(parseUnifiedDiff(fixture('binary'))[0]);
    expect(file.path).toBe('assets/logo.png');
    expect(file.binary).toBe(true);
    expect(file.status).toBe('modified');
    expect(file.hunks).toEqual([]);
  });

  it('parses multiple hunks in one file with independent line numbers', () => {
    const file = req(parseUnifiedDiff(fixture('multi-hunk'))[0]);
    expect(file.hunks).toHaveLength(2);
    const second = req(file.hunks[1]);
    expect(second.oldStart).toBe(10);
    expect(second.newStart).toBe(11);
    const added = req(second.lines.find((l) => l.kind === 'add'));
    expect(added.content).toBe('line11new');
    expect(added.newLine).toBe(12);
  });

  it('ignores the no-newline marker without emitting a diff line', () => {
    const file = req(parseUnifiedDiff(fixture('no-newline'))[0]);
    const hunk = req(file.hunks[0]);
    expect(hunk.lines.map((l) => l.kind)).toEqual(['context', 'del', 'add']);
    const add = req(hunk.lines[2]);
    expect(add.content).toBe("const last = 'b'");
    expect(add.newLine).toBe(2);
  });

  it('parses a multi-file diff preserving order and statuses', () => {
    const files = parseUnifiedDiff(fixture('multi-file'));
    expect(files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/keep.ts',
      'assets/pic.png',
      'src/removed.ts',
    ]);
    expect(files.map((f) => f.status)).toEqual([
      'modified',
      'added',
      'modified',
      'deleted',
    ]);
    expect(req(files[2]).binary).toBe(true);
  });

  it('ignores content before the first diff --git header', () => {
    const diff = [
      'commit abc123',
      'Author: Someone <s@example.com>',
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n');
    const file = req(parseUnifiedDiff(diff)[0]);
    expect(file.path).toBe('x.ts');
    expect(file.hunks).toHaveLength(1);
  });

  it('skips malformed segments without throwing', () => {
    const diff = 'diff --git garbage-with-no-paths\nsome noise\n';
    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  it('tolerates an unparseable hunk header and keeps the file', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ not-a-valid-header @@',
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+added',
    ].join('\n');
    const file = req(parseUnifiedDiff(diff)[0]);
    expect(file.path).toBe('x.ts');
    expect(file.hunks).toHaveLength(1);
    expect(req(file.hunks[0]).newStart).toBe(1);
  });

  it('handles paths that contain spaces via the +++ marker', () => {
    const diff = [
      'diff --git a/src/a b.ts b/src/a b.ts',
      '--- a/src/a b.ts',
      '+++ b/src/a b.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
    ].join('\n');
    const file = req(parseUnifiedDiff(diff)[0]);
    expect(file.path).toBe('src/a b.ts');
  });
});
