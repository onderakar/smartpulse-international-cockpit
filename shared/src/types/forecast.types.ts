export interface ForecastRequest {
  companyId: number;
  powerPlantId: number;
  provider: string;
  startDate: string; // DD/MM/YYYY
  endDate: string;   // DD/MM/YYYY
  minute: number;
  hour?: string;
  columnId?: number[];
}

export interface ForecastPredictionEntry {
  PredictionDate: string;
  PredictionValue: number | null;
}

export interface ForecastResponse {
  CompanyId: number;
  PowerPlantId: number;
  Time: string[];
  Questions: {
    providerPrediction: ForecastPredictionEntry[] | null;
    lastPrediction: ForecastPredictionEntry[] | null;
    selectedPrediction: ForecastPredictionEntry[] | null;
    selectedProviderPrediction: ForecastPredictionEntry[] | null;
    systemRealProduction: ForecastPredictionEntry[] | null;
    [key: string]: any;
  };
  Providers: { ProviderId: string; ProviderName: string }[];
  isError: boolean;
  ErrorMessage: string | null;
}

// ==================== Forecast Submission (Production Forecast API) ====================

export interface ForecastSubmissionPrediction {
  deliveryStart: string;       // ISO 8601 local time, e.g. "2025-10-11T00:00:00"
  deliveryStartOffset: number; // UTC offset in minutes (Turkey = 180 for UTC+3)
  deliveryEnd: string;         // ISO 8601 local time
  deliveryEndOffset: number;   // UTC offset in minutes (Turkey = 180 for UTC+3)
  value: number;               // MW, can be negative (charging)
}

export interface ForecastSubmissionUnit {
  unitNo: number;                              // portalPlantId of the BESS component
  predictions: ForecastSubmissionPrediction[];
}

export interface ForecastSubmissionRequest {
  measureUnit: number;                  // always 1
  description: string;
  forecasts: ForecastSubmissionUnit[];
}

export interface ForecastSubmissionResponse {
  success: boolean;
  message?: string;
  data?: any;        // raw portal API response for diagnostics
}
