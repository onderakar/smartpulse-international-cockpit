import { describe, it, expect } from 'vitest'
import { sumForecastSeries } from '@smartpulse-intl/shared'

describe('sumForecastSeries', () => {
  it('returns empty array for no input', () => {
    expect(sumForecastSeries([])).toEqual([])
  })

  it('returns single series unchanged', () => {
    const pts = [{ timestamp: 1000, value: 10 }, { timestamp: 2000, value: 20 }]
    expect(sumForecastSeries([pts])).toEqual(pts)
  })

  it('sums two series with matching timestamps (positive + negative)', () => {
    const a = [{ timestamp: 1000, value: 100 }, { timestamp: 2000, value: 200 }]
    const b = [{ timestamp: 1000, value: -30 }, { timestamp: 2000, value: -50 }]
    const result = sumForecastSeries([a, b])
    expect(result).toEqual([
      { timestamp: 1000, value: 70 },
      { timestamp: 2000, value: 150 },
    ])
  })

  it('handles sparse timestamps (union)', () => {
    const a = [{ timestamp: 1000, value: 10 }]
    const b = [{ timestamp: 2000, value: 20 }]
    const result = sumForecastSeries([a, b])
    expect(result).toHaveLength(2)
    expect(result.find(p => p.timestamp === 1000)?.value).toBe(10)
    expect(result.find(p => p.timestamp === 2000)?.value).toBe(20)
  })

  it('ignores empty arrays in input', () => {
    const a = [{ timestamp: 1000, value: 5 }]
    const result = sumForecastSeries([[], a, []])
    expect(result).toEqual(a)
  })

  it('returns results sorted ascending by timestamp', () => {
    const a = [{ timestamp: 3000, value: 1 }, { timestamp: 1000, value: 2 }]
    const result = sumForecastSeries([a])
    expect(result[0].timestamp).toBe(1000)
    expect(result[1].timestamp).toBe(3000)
  })
})
