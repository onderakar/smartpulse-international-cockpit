export interface PlantResolution {
  plantId: number;
  resolution: number;
  availableResolutions: number[];
}

export type MTUResolution = 15 | 30 | 60;

export interface GridlineConfig {
  majorIntervalMinutes: number;
  minorIntervalMinutes: number | null;
}

export function getGridlineConfig(resolution: MTUResolution): GridlineConfig {
  switch (resolution) {
    case 60: return { majorIntervalMinutes: 60, minorIntervalMinutes: 15 };
    case 30: return { majorIntervalMinutes: 30, minorIntervalMinutes: 15 };
    case 15: return { majorIntervalMinutes: 15, minorIntervalMinutes: null };
  }
}
