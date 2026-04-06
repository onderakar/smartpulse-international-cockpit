export const DEFAULT_POLLING_INTERVAL_SECONDS = 60;
export const MIN_POLLING_INTERVAL_SECONDS = 15;
export const MAX_WINDOW_HOURS = 3;
export const INCREMENTAL_WINDOW_MINUTES = 10;

export const CHART_COLORS = {
  batteryActivePower: '#29B6F6',   // Bright Blue (Battery Power)
  batterySoc: '#4CAF50',           // Muted Green (SoC bars, subtle)
  netPower: '#B0BEC5',             // Blue-Gray (neutral aggregate)
  scheduleBap: '#EC407A',          // Rose Pink (schedule)
  scheduleMaxGen: '#AB47BC',       // Medium Purple (schedule cap)
} as const;

export const POWER_COLORS = [
  '#FFB300',  // Amber (Solar)
  '#00BFA5',  // Teal (Wind)
  '#5C6BC0',  // Indigo
  '#FF7043',  // Deep Orange
  '#66BB6A',  // Green
] as const;

export const FORECAST_COLORS = [
  '#00E676',  // Green A400
  '#00BCD4',  // Cyan
  '#7C4DFF',  // Deep Purple A200
  '#E040FB',  // Purple A200
  '#69F0AE',  // Green A200
  '#40C4FF',  // Light Blue A200
] as const;
