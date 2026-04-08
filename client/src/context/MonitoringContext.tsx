import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { monitoringApi } from '../api/monitoring.api';
import { useProfile } from './ProfileContext';
import { usePolling } from '../hooks/usePolling';
import {
  AssetMapping,
  getFirstGcp,
  GridConnectionPoint,
} from '@smartpulse-intl/shared';
import type {
  LiveMonitoringData,
  MetricDataPoint,
  PowerComponent,
  RawMetricPoint,
} from '@smartpulse-intl/shared';
import { io, Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Socket URL
// ---------------------------------------------------------------------------
const getSocketUrl = () => {
  try {
    const envUrl = (import.meta as any).env.VITE_API_URL;
    if (envUrl) return envUrl;
  } catch {
    // ignore
  }
  return window.location.origin;
};
const SOCKET_URL = getSocketUrl();

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

function toDateKeyInTz(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function dayStartInTz(d: Date, tz: string): number {
  const dateKey = toDateKeyInTz(d, tz);
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const probe = new Date(utcMidnight);
  const utcStr = probe.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = probe.toLocaleString('en-US', { timeZone: tz });
  const offsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
  return utcMidnight - offsetMs;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function sumMetrics(metricArrays: MetricDataPoint[][]): MetricDataPoint[] {
  if (metricArrays.length === 0) return [];
  if (metricArrays.length === 1) return metricArrays[0];
  const combinedMap = new Map<number, number>();
  for (const arr of metricArrays) {
    for (const point of arr) {
      const current = combinedMap.get(point.timestamp) || 0;
      combinedMap.set(point.timestamp, current + point.value);
    }
  }
  return Array.from(combinedMap.entries())
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function computeNetPower(
  renewable: MetricDataPoint[],
  bap: MetricDataPoint[],
): MetricDataPoint[] {
  if (renewable.length === 0 || bap.length === 0) return [];
  const bapMap = new Map(bap.map((p) => [p.timestamp, p.value]));
  return renewable
    .filter((p) => bapMap.has(p.timestamp))
    .map((p) => ({
      timestamp: p.timestamp,
      value: p.value + (bapMap.get(p.timestamp) || 0),
    }));
}

/**
 * Fetch metrics from DB and transform into LiveMonitoringData.
 * Uses the GCP-based API (gcpId + companyId).
 */
async function fetchAllMetricsV2(
  mapping: AssetMapping,
  startISO: string,
  endISO: string,
): Promise<LiveMonitoringData> {
  const gcp = getFirstGcp(mapping);
  if (!gcp) {
    return { powerComponents: [], batterySoc: [], batteryActivePower: [], netPower: [] };
  }

  const companyMatch = mapping.companies?.find(c =>
    c.gridConnectionPoints?.some(g => g.id === gcp.id)
  );
  const companyId = companyMatch?.companyId ?? 0;

  const rawMetrics = await monitoringApi.getLiveMetricsV2(gcp.id, companyId, startISO, endISO);

  const data: LiveMonitoringData = {
    powerComponents: [],
    batterySoc: [],
    batteryActivePower: [],
    netPower: [],
  };

  const compMap = new Map<string, MetricDataPoint[]>();

  rawMetrics.forEach((m: RawMetricPoint) => {
    const pt: MetricDataPoint = { timestamp: m.timestamp, value: m.value };
    if (m.type === 'SOC') {
      data.batterySoc.push(pt);
    } else if (m.type === 'BAP') {
      data.batteryActivePower.push(pt);
    } else if (m.type.includes('POWER')) {
      // Match POWER_3054 → component with nodeidentity 3054
      const matchedComp = gcp.components?.find(c =>
        c.monitoring?.metrics?.some(x => {
          const tagUp = x.tag.toUpperCase();
          if (tagUp === m.type) return true;
          if ('nodeidentity' in x && x.nodeidentity && m.type === `${tagUp}_${x.nodeidentity}`) return true;
          return false;
        })
      );

      const key = matchedComp?.componentId || 'power_agg';
      const arr = compMap.get(key) || [];
      arr.push(pt);
      compMap.set(key, arr);
    }
  });

  compMap.forEach((pts, compId) => {
    let cName = 'Aggregated Power';
    if (compId !== 'power_agg') {
      const c = gcp.components?.find(x => x.componentId === compId);
      if (c) cName = c.displayName || cName;
    }
    data.powerComponents.push({
      componentId: compId,
      displayName: cName,
      type: gcp.components?.find(x => x.componentId === compId)?.type || 'OTHER',
      data: pts.sort((a, b) => a.timestamp - b.timestamp),
    });
  });

  // Net power = sum of all renewable + battery
  const allComponentData = data.powerComponents.map(pc => pc.data);
  const totalRenewable = sumMetrics(allComponentData);
  data.netPower = computeNetPower(totalRenewable, data.batteryActivePower);

  return data;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface LiveSnapshot {
  bapMW: number | null;
  socMwh: number | null;
  powerComponents: PowerComponent[];
  lastUpdated: Date | null;
}

interface MonitoringContextValue {
  data: LiveMonitoringData | null;
  currentBapPowerMW: number | null;
  currentSocMwh: number | null;
  liveSnapshot: LiveSnapshot;
  lastUpdated: Date | null;
  error: string | null;
  isToday: boolean;
  isLoading: boolean;
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  refresh: () => void;
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;

  const gcp = useMemo(() => getFirstGcp(mapping), [mapping]);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Determine timezone from the company that owns the first GCP
  const tz = useMemo(() => {
    if (!mapping?.companies?.length || !gcp) return 'UTC';
    const company = mapping.companies.find(c =>
      c.gridConnectionPoints?.some(g => g.id === gcp.id)
    );
    return company?.timezone || gcp.timezone || 'UTC';
  }, [mapping, gcp]);

  // WebSocket setup
  useEffect(() => {
    const s = io(SOCKET_URL, { withCredentials: true });
    setSocket(s);

    s.on('connect', () => {
      console.log(`[WebSocket] Connected: ${s.id}`);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // Date state
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const dateKey = useMemo(
    () => toDateKeyInTz(selectedDate, tz),
    [selectedDate, tz],
  );
  const isToday = useMemo(
    () => dateKey === toDateKeyInTz(new Date(), tz),
    [dateKey, tz],
  );

  // Data state
  const emptyData: LiveMonitoringData = useMemo(() => ({
    powerComponents: [], batterySoc: [], batteryActivePower: [], netPower: [],
  }), []);
  const [data, setData] = useState<LiveMonitoringData | null>(emptyData);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Reset on date change
  useEffect(() => {
    setData(emptyData);
    setLastUpdated(null);
    setError(null);
  }, [dateKey, emptyData]);

  const startISO = useMemo(() => {
    const dayStart = dayStartInTz(selectedDate, tz);
    return new Date(dayStart).toISOString();
  }, [selectedDate, tz]);

  const getEndISO = useCallback(() => {
    const dayStart = dayStartInTz(selectedDate, tz);
    const now = new Date();
    const viewingToday = dayStartInTz(now, tz) === dayStart;
    return viewingToday ? now.toISOString() : new Date(dayStart + 24 * 60 * 60 * 1000).toISOString();
  }, [selectedDate, tz]);

  // Load data from DB
  const loadInitialData = useCallback(async () => {
    if (!mapping || !gcp) return;
    setIsLoading(true);
    setError(null);
    try {
      // Subscribe to WebSocket room for this GCP
      if (socket) {
        socket.emit('subscribe:asset', gcp.id);
      }

      const endISO = getEndISO();
      const newData = await fetchAllMetricsV2(mapping, startISO, endISO);
      setData(newData);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [mapping, gcp, startISO, getEndISO, socket]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const pollingMs = (profile?.polling?.intervalSeconds ?? 60) * 1000;

  usePolling({
    callback: loadInitialData,
    intervalMs: pollingMs,
    enabled: !error?.includes('NOT_AUTHENTICATED') && !isLoading,
    immediate: false,
  });

  // WebSocket live stream listener
  useEffect(() => {
    if (!socket || !isToday || !mapping) return;

    const handler = () => {
      // On new metrics ingested, just refresh from DB
      const endISO = getEndISO();
      fetchAllMetricsV2(mapping, startISO, endISO).then(newData => {
        setData(newData);
        setLastUpdated(new Date());
      }).catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      });
    };

    socket.on('live_metrics', handler);
    return () => {
      socket.off('live_metrics', handler);
    };
  }, [socket, isToday, mapping, startISO, getEndISO]);

  const refresh = useCallback(loadInitialData, [loadInitialData]);

  const currentBapPowerMW = useMemo(() => {
    if (!data?.batteryActivePower?.length) return null;
    return data.batteryActivePower[data.batteryActivePower.length - 1].value;
  }, [data?.batteryActivePower]);

  const currentSocMwh = useMemo(() => {
    if (!data?.batterySoc?.length) return null;
    return data.batterySoc[data.batterySoc.length - 1].value;
  }, [data?.batterySoc]);

  // ---------------------------------------------------------------------------
  // Live Snapshot — always real-time regardless of selectedDate
  // ---------------------------------------------------------------------------
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot>({
    bapMW: null, socMwh: null, powerComponents: [], lastUpdated: null,
  });

  // When viewing today, sync from main data
  useEffect(() => {
    if (isToday && data) {
      setLiveSnapshot({
        bapMW: currentBapPowerMW,
        socMwh: currentSocMwh,
        powerComponents: data.powerComponents,
        lastUpdated,
      });
    }
  }, [isToday, data, currentBapPowerMW, currentSocMwh, lastUpdated]);

  // When NOT today, poll independently
  const fetchLiveSnapshot = useCallback(async () => {
    if (!mapping) return;
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    try {
      const liveData = await fetchAllMetricsV2(mapping, tenMinAgo.toISOString(), now.toISOString());
      const lastBap = liveData.batteryActivePower.length > 0
        ? liveData.batteryActivePower[liveData.batteryActivePower.length - 1].value
        : null;
      const lastSoc = liveData.batterySoc.length > 0
        ? liveData.batterySoc[liveData.batterySoc.length - 1].value
        : null;
      setLiveSnapshot({
        bapMW: lastBap,
        socMwh: lastSoc,
        powerComponents: liveData.powerComponents,
        lastUpdated: new Date(),
      });
    } catch {
      // Silent fail for live snapshot
    }
  }, [mapping]);

  usePolling({
    callback: fetchLiveSnapshot,
    intervalMs: pollingMs,
    enabled: !isToday && !!mapping,
    immediate: true,
  });

  const value: MonitoringContextValue = useMemo(
    () => ({
      data,
      currentBapPowerMW,
      currentSocMwh,
      liveSnapshot,
      lastUpdated,
      error,
      isToday,
      isLoading,
      selectedDate,
      setSelectedDate,
      refresh,
    }),
    [data, currentBapPowerMW, currentSocMwh, liveSnapshot, lastUpdated, error, isToday, isLoading, selectedDate, refresh],
  );

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) {
    throw new Error('useMonitoring must be used within MonitoringProvider');
  }
  return ctx;
}
