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
