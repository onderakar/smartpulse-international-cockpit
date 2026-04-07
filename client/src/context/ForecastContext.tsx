import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { useProfile } from './ProfileContext';
import { useMonitoring } from './MonitoringContext';
import { useAuth } from './AuthContext';
import { getAllGcps } from '@shared/types/assetMapping.types';
import { MetricDataPoint, FORECAST_COLORS } from '@smartpulse-intl/shared';
import { ForecastResponse } from '@smartpulse-intl/shared';
import { forecastApi } from '../api/forecast.api';
// TODO: Uncomment when LiveMonitoringWidget/LiveChart is implemented
// import type { ForecastSeriesItem } from '../components/widgets/LiveMonitoringWidget/LiveChart';

// Temporary type definition until widget is implemented
interface ForecastSeriesItem {
  seriesId: string;
  displayName: string;
  data: MetricDataPoint[];
}

/** Forecasts are refreshed from SmartPulse Portal every 15 minutes */
const FORECAST_POLL_INTERVAL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cache — keyed by "gcpId::dateKey" so data is reused across screens
// ---------------------------------------------------------------------------

interface CachedForecastData {
  series: ForecastSeriesItem[];
  ilkKgup?: MetricDataPoint[];
  rkgup?: MetricDataPoint[];
  osos?: MetricDataPoint[];
}

const forecastCache = new Map<string, CachedForecastData>();

function buildCacheKey(gcpId: string, dateKey: string): string {
  return `${gcpId}::${dateKey}`;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ForecastContextValue {
  /** Forecast series for the active GCP + selected date */
  forecastSeries: ForecastSeriesItem[];
  /** True while a fetch is in progress */
  loading: boolean;
  /** Force re-fetch (bypasses cache) */
  refetch: () => void;
  ilkKgupData?: MetricDataPoint[];
  rkgupData?: MetricDataPoint[];
  ososData?: MetricDataPoint[];
}

const ForecastContext = createContext<ForecastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePredictions(
  predictions: { PredictionDate: string; PredictionValue: number | null }[],
  tzOffsetMs: number,
): MetricDataPoint[] {
  return predictions
    .filter(p => p.PredictionValue !== null && p.PredictionValue !== undefined)
    .map(p => {
      const raw = p.PredictionDate;
      const hasTz = raw.endsWith('Z') || raw.includes('+');
      // If PredictionDate already has timezone info, parse directly (already real UTC).
      // If no timezone, treat the bare string as plant-local time:
      //   append 'Z' to force UTC parsing, then subtract plant tz offset.
      const ts = hasTz
        ? new Date(raw).getTime()
        : new Date(raw + 'Z').getTime() - tzOffsetMs;
      return { timestamp: ts, value: p.PredictionValue! };
    });
}

function parseNumberArray(
  times: string[],
  values: (number | null)[],
  tzOffsetMs: number,
): MetricDataPoint[] {
  if (!times || !values) return [];
  const res: MetricDataPoint[] = [];
  const len = Math.min(times.length, values.length);
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    const raw = times[i];
    if (!raw) continue;
    const hasTz = raw.endsWith('Z') || raw.includes('+');
    const ts = hasTz ? new Date(raw).getTime() : new Date(raw + 'Z').getTime() - tzOffsetMs;
    res.push({ timestamp: ts, value: v });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ForecastProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const { companies } = useAuth();
  const { selectedDate } = useMonitoring();

  const mapping = profile?.assetMapping ?? null;
  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);
  const activeGcp = allGcps[0] ?? null;

  const companyId = companies.length > 0 ? companies[0].id : null;

  const tz = activeGcp?.timezone || 'UTC';
  const dateKey = useMemo(
    () => selectedDate.toLocaleDateString('en-CA', { timeZone: tz }),
    [selectedDate, tz],
  );

  const [forecastSeries, setForecastSeries] = useState<ForecastSeriesItem[]>([]);
  const [ilkKgupData, setIlkKgupData] = useState<MetricDataPoint[]>();
  const [rkgupData, setRkgupData] = useState<MetricDataPoint[]>();
  const [ososData, setOsosData] = useState<MetricDataPoint[]>();
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  // Stable refetch trigger
  const [refetchCount, setRefetchCount] = useState(0);
  const refetch = useMemo(() => () => setRefetchCount(c => c + 1), []);

  useEffect(() => {
    if (!companyId || !activeGcp) {
      setForecastSeries([]);
      return;
    }

    const gcpId = String(activeGcp.id);

    // Check cache first (skip on explicit refetch)
    if (refetchCount === 0) {
      const cacheKey = buildCacheKey(gcpId, dateKey);
      const cached = forecastCache.get(cacheKey);
      if (cached) {
        setForecastSeries(cached.series);
        setIlkKgupData(cached.ilkKgup);
        setRkgupData(cached.rkgup);
        setOsosData(cached.osos);
        return;
      }
    }

    const [y, m, d] = dateKey.split('-');
    const dayStr = `${d}/${m}/${y}`; // DD/MM/YYYY

    // Compute TZ offset for timestamp conversion
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = now.toLocaleString('en-US', { timeZone: tz });
    const tzOffsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();

    const fetchId = ++fetchIdRef.current;
    setLoading(true);

    const requests: { label: string; promise: Promise<ForecastResponse> }[] = [];

    // Component forecasts
    for (const comp of activeGcp.components) {
      const plantId = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId ?? 0
      if (comp.forecastPreference?.sourceName && plantId > 0) {
        requests.push({
          label: `${comp.displayName} Forecast`,
          promise: forecastApi.getValues({
            companyId,
            powerPlantId: plantId,
            provider: comp.forecastPreference.sourceName,
            startDate: dayStr,
            endDate: dayStr,
            minute: 0,
            hour: '12:30',
            columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
          }),
        });
      }
    }

    Promise.allSettled(requests.map(r => r.promise)).then(results => {
      if (fetchId !== fetchIdRef.current) return; // stale

      const series: ForecastSeriesItem[] = [];
      let foundIlkKgup: MetricDataPoint[] | undefined;
      let foundRkgup: MetricDataPoint[] | undefined;
      let foundOsos: MetricDataPoint[] | undefined;

      results.forEach((result, idx) => {
        if (result.status !== 'fulfilled') return;
        const res = result.value;
        if (res.isError) return;

        // Extract firstKgup / latestKgup from *any* successful response
        const times = res.Time || [];
        if (!foundIlkKgup && res.Questions?.firstKgup) {
          const pts = Array.isArray(res.Questions.firstKgup) && res.Questions.firstKgup.length > 0 && typeof res.Questions.firstKgup[0] !== 'object'
            ? parseNumberArray(times, res.Questions.firstKgup, tzOffsetMs)
            : parsePredictions(res.Questions.firstKgup, tzOffsetMs);
          if (pts.length > 0) foundIlkKgup = pts;
        }
        if (!foundRkgup && res.Questions?.latestKgup) {
          const pts = Array.isArray(res.Questions.latestKgup) && res.Questions.latestKgup.length > 0 && typeof res.Questions.latestKgup[0] !== 'object'
            ? parseNumberArray(times, res.Questions.latestKgup, tzOffsetMs)
            : parsePredictions(res.Questions.latestKgup, tzOffsetMs);
          if (pts.length > 0) foundRkgup = pts;
        }

        if (!foundOsos && res.Questions?.osos) {
          const pts = Array.isArray(res.Questions.osos) && res.Questions.osos.length > 0 && typeof res.Questions.osos[0] !== 'object'
            ? parseNumberArray(times, res.Questions.osos, tzOffsetMs)
            : parsePredictions(res.Questions.osos, tzOffsetMs);
          if (pts.length > 0) foundOsos = pts;
        }

        const predictions = res.Questions?.providerPrediction
          ?? res.Questions?.selectedProviderPrediction
          ?? res.Questions?.lastPrediction
          ?? [];
        if (!predictions || predictions.length === 0) return;
        const points = parsePredictions(predictions, tzOffsetMs);
        if (points.length > 0) {
          series.push({
            label: requests[idx].label,
            data: points,
            color: FORECAST_COLORS[idx % FORECAST_COLORS.length],
          });
        }
      });

      // Aggregate component forecasts into a GCP total series when more than one
      if (series.length > 1) {
        const aggregateMap = new Map<number, number>();
        for (const s of series) {
          for (const pt of s.data) {
            aggregateMap.set(pt.timestamp, (aggregateMap.get(pt.timestamp) ?? 0) + pt.value);
          }
        }
        const aggregateData = [...aggregateMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([timestamp, value]) => ({ timestamp, value }));
        series.unshift({
          label: `${activeGcp.name} Total`,
          data: aggregateData,
          color: FORECAST_COLORS[series.length % FORECAST_COLORS.length],
        });
      }

      // Store in cache (including KGUP/OSOS data)
      const cacheKey = buildCacheKey(gcpId, dateKey);
      forecastCache.set(cacheKey, {
        series,
        ilkKgup: foundIlkKgup,
        rkgup: foundRkgup,
        osos: foundOsos,
      });

      setForecastSeries(series);
      setIlkKgupData(foundIlkKgup);
      setRkgupData(foundRkgup);
      setOsosData(foundOsos);
      setLoading(false);
    });

    return () => { fetchIdRef.current++; }; // cancel stale
  }, [companyId, activeGcp, dateKey, tz, refetchCount]);

  const value = useMemo<ForecastContextValue>(
    () => ({ forecastSeries, ilkKgupData, rkgupData, ososData, loading, refetch }),
    [forecastSeries, ilkKgupData, rkgupData, ososData, loading, refetch],
  );

  return (
    <ForecastContext.Provider value={value}>
      {children}
    </ForecastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useForecast(): ForecastContextValue {
  const context = useContext(ForecastContext);
  if (!context) {
    throw new Error('useForecast must be used within ForecastProvider');
  }
  return context;
}
