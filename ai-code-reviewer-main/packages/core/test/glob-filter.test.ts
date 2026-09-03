import { describe, expect, it } from 'vitest';

import { partitionFiles } from '../src/glob-filter';
import { changedFile, reviewConfig } from './helpers';

describe('partitionFiles', () => {
  it('keeps everything when include is empty and nothing matches exclude', () => {
    const files = [changedFile({ path: 'src/a.ts' }), changedFile({ path: 'src/b.ts' })];
    const { kept, skipped } = partitionFiles(files, reviewConfig({ exclude: [] }));
    expect(kept).toHaveLength(2);
    expect(skipped).toEqual([]);
  });

  it('excludes files matching an exclude glob (dot files included)', () => {
    const files = [
      changedFile({ path: 'src/a.ts' }),
      changedFile({ path: 'dist/bundle.js' }),
      changedFile({ path: '.github/secret.lock' }),
    ];
    const { kept, skipped } = partitionFiles(
      files,
      reviewConfig({ exclude: ['dist/**', '**/*.lock'] }),
    );
    expect(kept.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(skipped).toEqual([
      { path: 'dist/bundle.js', reason: 'excluded' },
      { path: '.github/secret.lock', reason: 'excluded' },
    ]);
  });

  it('drops files not matching a non-empty include list as excluded', () => {
    const files = [
      changedFile({ path: 'src/a.ts' }),
      changedFile({ path: 'docs/readme.md' }),
    ];
    const { kept, skipped } = partitionFiles(
      files,
      reviewConfig({ include: ['src/**'], exclude: [] }),
    );
    expect(kept.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(skipped).toEqual([{ path: 'docs/readme.md', reason: 'excluded' }]);
  });

  it('applies exclude before include', () => {
    const files = [changedFile({ path: 'src/gen/big.ts' })];
    const { kept, skipped } = partitionFiles(
      files,
      reviewConfig({ include: ['src/**'], exclude: ['**/gen/**'] }),
    );
    expect(kept).toEqual([]);
    expect(skipped).toEqual([{ path: 'src/gen/big.ts', reason: 'excluded' }]);
  });

  it('skips deleted and binary files with the right reasons', () => {
    const files = [
      changedFile({ path: 'src/a.ts' }),
      changedFile({ path: 'src/gone.ts', status: 'deleted' }),
      changedFile({ path: 'img/logo.png', binary: true }),
    ];
    const { kept, skipped } = partitionFiles(files, reviewConfig({ exclude: [] }));
    expect(kept.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(skipped).toEqual([
      { path: 'src/gone.ts', reason: 'deleted' },
      { path: 'img/logo.png', reason: 'binary' },
    ]);
  });

  it('prefers the excluded reason over deleted/binary', () => {
    const files = [
      changedFile({ path: 'dist/gone.ts', status: 'deleted' }),
      changedFile({ path: 'dist/logo.png', binary: true }),
    ];
    const { kept, skipped } = partitionFiles(files, reviewConfig({ exclude: ['dist/**'] }));
    expect(kept).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['excluded', 'excluded']);
  });

  it('truncates beyond maxFiles with a max_files reason, preserving order', () => {
    const files = [
      changedFile({ path: 'a.ts' }),
      changedFile({ path: 'b.ts' }),
      changedFile({ path: 'c.ts' }),
    ];
    const { kept, skipped } = partitionFiles(
      files,
      reviewConfig({ exclude: [], maxFiles: 2 }),
    );
    expect(kept.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(skipped).toEqual([{ path: 'c.ts', reason: 'max_files' }]);
  });

  it('counts only surviving files against maxFiles', () => {
    const files = [
      changedFile({ path: 'a.ts' }),
      changedFile({ path: 'skip.png', binary: true }),
      changedFile({ path: 'b.ts' }),
      changedFile({ path: 'c.ts' }),
    ];
    const { kept, skipped } = partitionFiles(
      files,
      reviewConfig({ exclude: [], maxFiles: 2 }),
    );
    expect(kept.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(skipped).toContainEqual({ path: 'skip.png', reason: 'binary' });
    expect(skipped).toContainEqual({ path: 'c.ts', reason: 'max_files' });
  });
});
