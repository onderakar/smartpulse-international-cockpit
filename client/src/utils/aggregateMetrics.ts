import type { MetricDataPoint } from '@smartpulse-intl/shared';

/**
 * Bucket metric data points into fixed time intervals and average each bucket.
 * @param data  Sorted MetricDataPoint array
 * @param intervalMs  Bucket size in ms (e.g. 300000 for 5min). 0 = passthrough (no aggregation).
 */
export function aggregateByInterval(
  data: MetricDataPoint[],
  intervalMs: number,
): MetricDataPoint[] {
  if (intervalMs <= 0 || data.length === 0) return data;

  const buckets = new Map<number, { sum: number; count: number }>();

  for (const pt of data) {
    const bucket = Math.floor(pt.timestamp / intervalMs) * intervalMs;
    const existing = buckets.get(bucket);
    if (existing) {
      existing.sum += pt.value;
      existing.count += 1;
    } else {
      buckets.set(bucket, { sum: pt.value, count: 1 });
    }
  }

  return Array.from(buckets.entries())
    .map(([timestamp, { sum, count }]) => ({ timestamp, value: sum / count }))
    .sort((a, b) => a.timestamp - b.timestamp);
}
