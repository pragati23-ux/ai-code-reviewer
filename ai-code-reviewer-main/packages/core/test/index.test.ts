import { describe, expect, it } from 'vitest';

import * as core from '../src/index';

describe('@acr/core public surface', () => {
  it('re-exports the contract values and engine functions', () => {
    expect(typeof core.parseUnifiedDiff).toBe('function');
    expect(typeof core.review).toBe('function');
    expect(typeof core.renderSummaryMarkdown).toBe('function');
    expect(typeof core.partitionFiles).toBe('function');
    expect(typeof core.chunkFiles).toBe('function');
    expect(typeof core.buildMessages).toBe('function');
    expect(typeof core.parseFindings).toBe('function');
    expect(typeof core.filterFindings).toBe('function');
    expect(typeof core.mapWithConcurrency).toBe('function');
    expect(typeof core.estimateTokens).toBe('function');
    expect(core.SCHEMA_NAME).toBe('report_findings');
    expect(core.SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low']);
    expect(core.DEFAULT_CONFIG.maxComments).toBe(20);
    expect(core.FINDINGS_SCHEMA).toHaveProperty('type', 'object');
  });
});
