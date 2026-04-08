export interface MetricDataPoint {
  timestamp: number  // Unix ms
  value: number
}

export interface PowerComponent {
  componentId: string
  displayName: string
  type: string
  data: MetricDataPoint[]
}

export interface LiveMonitoringData {
  powerComponents: PowerComponent[]
  batterySoc: MetricDataPoint[]
  batteryActivePower: MetricDataPoint[]
  netPower?: MetricDataPoint[]
}

export interface LiveSnapshot {
  socPercent: number | null
  socMwh: number | null
  bapMW: number | null
  timestamp: number | null
}

/** Raw metric point returned from DB query via REST API */
export interface RawMetricPoint {
  timestamp: number
  type: string    // 'SOC' | 'BAP' | 'POWER_3054' etc.
  value: number
}
