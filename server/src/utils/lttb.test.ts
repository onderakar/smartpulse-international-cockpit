import { describe, it, expect } from 'vitest';
import { lttbDownsample, type LttbPoint } from './lttb';

function makePoints(count: number): LttbPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: i * 10000,
    value: Math.sin(i * 0.1) * 100,
  }));
}

describe('lttbDownsample', () => {
  it('returns input unchanged when length <= targetCount', () => {
    const pts = makePoints(5);
    expect(lttbDownsample(pts, 10)).toEqual(pts);
    expect(lttbDownsample(pts, 5)).toEqual(pts);
  });

  it('returns empty array for empty input', () => {
    expect(lttbDownsample([], 10)).toEqual([]);
  });

  it('preserves first and last points', () => {
    const pts = makePoints(1000);
    const result = lttbDownsample(pts, 50);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('returns exactly targetCount points', () => {
    const pts = makePoints(10000);
    const result = lttbDownsample(pts, 500);
    expect(result).toHaveLength(500);
  });

  it('preserves chronological order', () => {
    const pts = makePoints(5000);
    const result = lttbDownsample(pts, 200);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });

  it('preserves spikes better than uniform sampling', () => {
    const pts: LttbPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: i * 1000,
      value: i === 500 ? 1000 : 1,
    }));
    const result = lttbDownsample(pts, 50);
    const maxVal = Math.max(...result.map(p => p.value));
    expect(maxVal).toBe(1000);
  });

  it('handles targetCount < 3 by returning first and last', () => {
    const pts = makePoints(100);
    const result = lttbDownsample(pts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(pts[0]);
    expect(result[1]).toEqual(pts[pts.length - 1]);
  });
});
