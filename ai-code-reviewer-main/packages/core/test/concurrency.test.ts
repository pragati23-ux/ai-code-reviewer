import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../src/concurrency';
import { delay } from './helpers';

describe('mapWithConcurrency', () => {
  it('returns [] for empty input', async () => {
    expect(await mapWithConcurrency([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it('preserves input order regardless of completion order', async () => {
    const items = [30, 5, 15];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await delay(ms);
      return ms;
    });
    expect(results).toEqual([30, 5, 15]);
  });

  it('passes the index to the mapper', async () => {
    const results = await mapWithConcurrency(['a', 'b', 'c'], 2, (item, index) =>
      Promise.resolve(`${index}:${item}`),
    );
    expect(results).toEqual(['0:a', '1:b', '2:c']);
  });

  it('never exceeds the concurrency limit and reaches it', async () => {
    let inFlight = 0;
    let max = 0;
    const items = Array.from({ length: 10 }, (_unused, i) => i);
    const results = await mapWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await delay(4);
      inFlight -= 1;
      return n * 2;
    });
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBe(3);
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it('runs sequentially when limit is 1', async () => {
    const order: number[] = [];
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      order.push(n);
      await delay(1);
      return n;
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('handles a limit larger than the item count', async () => {
    expect(await mapWithConcurrency([1, 2], 10, (n) => Promise.resolve(n))).toEqual([1, 2]);
  });
});
