import { MetricDataPoint } from '../types/monitoring.types'

/**
 * Algebraically sum multiple forecast series by timestamp.
 * Portal values are already correctly signed (gen positive, con negative) — just add them.
 * Takes a union of all timestamps. Returns points sorted ascending by timestamp.
 */
export function sumForecastSeries(series: MetricDataPoint[][]): MetricDataPoint[] {
  const map = new Map<number, number>()
  for (const pts of series) {
    for (const pt of pts) {
      map.set(pt.timestamp, (map.get(pt.timestamp) ?? 0) + pt.value)
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, value]) => ({ timestamp, value }))
}
