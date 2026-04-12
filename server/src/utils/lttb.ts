export interface LttbPoint {
  timestamp: number;
  value: number;
}

export function lttbDownsample(data: LttbPoint[], targetCount: number): LttbPoint[] {
  throw new Error('Not implemented');
}
