import { useState, useEffect, useMemo, useCallback, useRef, KeyboardEvent, ClipboardEvent } from 'react';
import toast from 'react-hot-toast';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useProfile } from '../context/ProfileContext';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { forecastApi } from '../api/forecast.api';
import { monitoringApi } from '../api/monitoring.api';
import type { ForecastSubmissionPrediction } from '@smartpulse-intl/shared';
import { DateNav } from '../components/common/DateNav';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForecastPlantItem {
  companyId: number;
  plantId: number;
  displayName: string;
  isParent: boolean;
  resolutionMinutes: number;
}

interface ForecastGcpGroup {
  gcpId: number;
  gcpName: string;
  companyId: number;
  resolutionMinutes: number;
  children: ForecastPlantItem[];
}

interface SlotRow {
  deliveryStart: string;
  deliveryEnd: string;
  value: number | null;
  edited: boolean;
}

/** A loaded forecast series for the viewer */
interface ForecastSeries {
  providerId: string;
  providerName: string;
  color: string;
  data: { deliveryStart: string; value: number }[];
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slotLabel(iso: string): string {
  return iso.slice(11, 16);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Compute the UTC offset in ms for a given IANA timezone at the current moment. */
function getTzOffsetMs(timezone: string): number {
  const utcStr = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC' });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

function buildEmptyRows(dateKey: string, resolutionMinutes: number): SlotRow[] {
  const rows: SlotRow[] = [];
  const count = Math.round((24 * 60) / resolutionMinutes);
  for (let i = 0; i < count; i++) {
    const totalMinutesStart = i * resolutionMinutes;
    const totalMinutesEnd = (i + 1) * resolutionMinutes;
    const sH = Math.floor(totalMinutesStart / 60);
    const sM = totalMinutesStart % 60;
    const eDay = totalMinutesEnd >= 24 * 60 ? 1 : 0;
    const eH = Math.floor(totalMinutesEnd / 60) % 24;
    const eM = totalMinutesEnd % 60;
    const startStr = `${dateKey}T${pad2(sH)}:${pad2(sM)}:00`;
    let endStr: string;
    if (eDay) {
      const nd = new Date(`${dateKey}T12:00:00`);
      nd.setDate(nd.getDate() + 1);
      endStr = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}-${pad2(nd.getDate())}T${pad2(eH)}:${pad2(eM)}:00`;
    } else {
      endStr = `${dateKey}T${pad2(eH)}:${pad2(eM)}:00`;
    }
    rows.push({ deliveryStart: startStr, deliveryEnd: endStr, value: 0, edited: false });
  }
  return rows;
}

function toDDMMYYYY(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

function nowLocalIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}T${pad2(n.getHours())}:${pad2(n.getMinutes())}:00`;
}

/** Extract the best non-empty prediction array from a forecast response Questions object. */
function extractPredictions(questions: any): { PredictionDate: string; PredictionValue: number | null }[] {
  if (!questions) return [];
  // Try well-known fields first, then scan all dynamic fields
  // selectedProviderPrediction preserves null (= never submitted)
  // providerPrediction always returns 0 for null hours — masks the real state
  const KNOWN_KEYS = [
    'selectedProviderPrediction',
    'providerPrediction',
    'selectedPrediction',
    'lastPrediction',
  ];
  for (const key of KNOWN_KEYS) {
    const arr = questions[key];
    if (Array.isArray(arr) && arr.length > 0) return arr;
  }
  // Fallback: scan all keys for the first array with PredictionDate entries
  for (const key of Object.keys(questions)) {
    if (KNOWN_KEYS.includes(key)) continue;
    const val = questions[key];
    if (Array.isArray(val) && val.length > 0 && val[0]?.PredictionDate !== undefined) {
      return val;
    }
  }
  return [];
}

// Distinct colors for series
const SERIES_PALETTE = [
  '#38b2ac', '#f6ad55', '#63b3ed', '#f87171', '#a78bfa',
  '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#4ade80',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ForecastPage() {
  const { profile } = useProfile();
  const { companies } = useAuth();
  const { t } = useLocale();
  const mapping = profile?.assetMapping ?? null;

  // Build hierarchical GCP groups: child components only (no portal plant at GCP level)
  const gcpGroups = useMemo<ForecastGcpGroup[]>(() => {
    if (!mapping?.companies) return [];
    const groups: ForecastGcpGroup[] = [];
    for (const company of mapping.companies) {
      for (const gcp of company.gridConnectionPoints) {
        const children: ForecastPlantItem[] = [];
        const seenIds = new Set<number>();

        // Add child components
        for (const comp of gcp.components) {
          if (comp.portalPlantId > 0 && !seenIds.has(comp.portalPlantId)) {
            seenIds.add(comp.portalPlantId);
            children.push({
              companyId: company.companyId,
              plantId: comp.portalPlantId,
              displayName: comp.displayName,
              isParent: false,
              resolutionMinutes: gcp.resolutionMinutes ?? 60,
            });
          }
        }

        if (children.length > 0) {
          groups.push({
            gcpId: gcp.id,
            gcpName: gcp.name,
            companyId: company.companyId,
            resolutionMinutes: gcp.resolutionMinutes ?? 60,
            children,
          });
        }
      }
    }
    return groups;
  }, [mapping]);

  // Flat list for lookups — only component-level plants (no parent at GCP level)
  const allPlants = useMemo<ForecastPlantItem[]>(() => {
    const result: ForecastPlantItem[] = [];
    for (const g of gcpGroups) {
      result.push(...g.children);
    }
    return result;
  }, [gcpGroups]);

  const fallbackCompanyId = companies.length > 0 ? companies[0].id : null;
  const RESERVED_PROVIDERS = ['UserForecast', 'FinalForecast', 'EpiasForecast'];

  // Shared state
  const [selectedPlantId, setSelectedPlantId] = useState<number | null>(null);
  const [dateKey, setDateKey] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [providers, setProviders] = useState<{ ProviderId: string; ProviderName: string }[]>([]);

  const selectedPlant = allPlants.find(b => b.plantId === selectedPlantId) ?? null;
  const resolution = selectedPlant?.resolutionMinutes ?? 60;

  // Live clock
  const [nowStr, setNowStr] = useState(nowLocalIso);
  useEffect(() => {
    const id = setInterval(() => setNowStr(nowLocalIso()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedPlantId && gcpGroups.length > 0) {
      // Auto-select first component of first group
      const first = gcpGroups[0];
      setSelectedPlantId(first.children[0]?.plantId ?? null);
    }
  }, [gcpGroups, selectedPlantId]);

  // Actual production data from monitoring API
  const [actualProduction, setActualProduction] = useState<{ timestamp: number; value: number }[]>([]);

  // Fetch providers when plant/date changes
  useEffect(() => {
    if (!selectedPlant) return;
    const companyId = selectedPlant.companyId || fallbackCompanyId;
    if (!companyId) return;
    const dayStr = toDDMMYYYY(dateKey);
    forecastApi.getValues({
      companyId, powerPlantId: selectedPlant.plantId, provider: 'UserForecast',
      startDate: dayStr, endDate: dayStr, minute: 0, hour: '12:30', columnId: [6],
    }).then(res => {
      if (res.Providers?.length) setProviders(res.Providers);
    }).catch(() => {});
  }, [selectedPlant, fallbackCompanyId, dateKey]);

  // Fetch actual production from monitoring API
  useEffect(() => {
    if (!selectedPlantId || !mapping?.companies) { setActualProduction([]); return; }

    // Find the GCP group containing this plant
    let gcpId = 0;
    let companyId = 0;
    let gcpTimezone = 'UTC';
    let targetComponentId: string | null = null;

    for (const group of gcpGroups) {
      const child = group.children.find(c => c.plantId === selectedPlantId);
      if (child) {
        gcpId = group.gcpId;
        companyId = group.companyId;
        // Find the component's componentId and timezone
        for (const company of mapping.companies) {
          for (const gcp of company.gridConnectionPoints) {
            if (gcp.id === gcpId) {
              gcpTimezone = gcp.timezone || 'UTC';
              const comp = gcp.components.find(c => c.portalPlantId === selectedPlantId);
              if (comp) targetComponentId = comp.componentId;
            }
          }
        }
        break;
      }
    }

    if (!gcpId || !companyId) { setActualProduction([]); return; }

    // Build date range for the selected day using the GCP's timezone
    const [_y, _m, _d] = dateKey.split('-').map(Number);
    const tzOffsetMs = getTzOffsetMs(gcpTimezone);
    const midnightUtcMs = Date.UTC(_y, _m - 1, _d) - tzOffsetMs;
    const startISO = new Date(midnightUtcMs).toISOString();
    const endISO = new Date(midnightUtcMs + 86_400_000).toISOString();

    monitoringApi.getLiveMetricsV2(gcpId, companyId, startISO, endISO).then(rawMetrics => {
      let points: { timestamp: number; value: number }[] = [];

      if (!targetComponentId) {
        // Aggregate all POWER_* + BAP metrics as net production
        const powerMetrics = rawMetrics.filter(m => m.type.startsWith('POWER') || m.type === 'BAP');
        const tsMap = new Map<number, number>();
        for (const m of powerMetrics) {
          tsMap.set(m.timestamp, (tsMap.get(m.timestamp) ?? 0) + m.value);
        }
        points = [...tsMap.entries()].map(([timestamp, value]) => ({ timestamp, value }));
      } else {
        // Child component: find matching POWER metric using component's monitoring config
        let matchTypes: string[] = [];
        for (const company of mapping!.companies) {
          for (const gcp of company.gridConnectionPoints) {
            if (gcp.id === gcpId) {
              const comp = gcp.components.find(c => c.componentId === targetComponentId);
              if (comp?.monitoring?.metrics) {
                for (const metric of comp.monitoring.metrics) {
                  if ('nodeidentity' in metric) {
                    matchTypes.push(`POWER_${metric.nodeidentity}`);
                    matchTypes.push(metric.tag.toUpperCase());
                  }
                  if ('source' in metric && metric.tag === 'ActivePower') {
                    matchTypes.push('BAP');
                  }
                }
              }
            }
          }
        }
        // Filter metrics matching this component
        if (matchTypes.length > 0) {
          points = rawMetrics
            .filter(m => matchTypes.includes(m.type))
            .map(m => ({ timestamp: m.timestamp, value: m.value }));
        } else {
          // Fallback: if component is BESS, use BAP
          const compType = mapping!.companies.flatMap(c => c.gridConnectionPoints).flatMap(gcp => gcp.components).find(c => c.componentId === targetComponentId)?.type;
          if (compType === 'BESS') {
            points = rawMetrics.filter(m => m.type === 'BAP').map(m => ({ timestamp: m.timestamp, value: m.value }));
          }
        }
      }

      points.sort((a, b) => a.timestamp - b.timestamp);
      setActualProduction(points);
    }).catch(() => setActualProduction([]));
  }, [selectedPlantId, dateKey, mapping, gcpGroups]);

  const handleDateChange = useCallback((delta: number) => {
    setDateKey(prev => {
      const d = new Date(prev + 'T12:00:00');
      d.setDate(d.getDate() + delta);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    });
  }, []);

  const todayStr = new Date().toLocaleDateString('en-CA');
  const isToday = dateKey === todayStr;
  const isPast = dateKey < todayStr;

  // =====================================================================
  // SECTION 1: Forecast Viewer (multi-series chart + table)
  // =====================================================================

  const [viewerSeries, setViewerSeries] = useState<ForecastSeries[]>([]);
  const [viewerMode, setViewerMode] = useState<'chart' | 'table'>('chart');
  const [addingProvider, setAddingProvider] = useState('');

  // Add a series — use ProviderId for API, ProviderName for display
  const handleAddSeries = useCallback(async (provId: string) => {
    if (!provId || !selectedPlant) return;
    if (viewerSeries.some(s => s.providerId === provId)) return; // already loaded

    // Look up display name from providers list
    const provEntry = providers.find(p => p.ProviderId === provId);
    const displayName = provEntry?.ProviderName ?? provId;

    const color = SERIES_PALETTE[viewerSeries.length % SERIES_PALETTE.length];
    const newSeries: ForecastSeries = { providerId: provId, providerName: displayName, color, data: [], loading: true };
    setViewerSeries(prev => [...prev, newSeries]);

    const companyId = selectedPlant.companyId || fallbackCompanyId;
    if (!companyId) return;

    try {
      const dayStr = toDDMMYYYY(dateKey);
      const res = await forecastApi.getValues({
        companyId, powerPlantId: selectedPlant.plantId, provider: provId,
        startDate: dayStr, endDate: dayStr, minute: 0, hour: '12:30',
        columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
      });

      const predictions = extractPredictions(res.Questions);

      const data: { deliveryStart: string; value: number }[] = [];
      for (const p of predictions) {
        if (p.PredictionValue === null || p.PredictionValue === undefined) continue;
        const raw = p.PredictionDate;
        const hasTz = raw.endsWith('Z') || raw.includes('+');
        let predLocal: string;
        if (hasTz) {
          const d = new Date(raw);
          predLocal = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
        } else {
          predLocal = raw.slice(0, 19);
          if (predLocal.length === 16) predLocal += ':00';
        }
        data.push({ deliveryStart: predLocal, value: p.PredictionValue });
      }

      setViewerSeries(prev => prev.map(s =>
        s.providerId === provId ? { ...s, data, loading: false } : s
      ));
    } catch {
      setViewerSeries(prev => prev.map(s =>
        s.providerId === provId ? { ...s, loading: false } : s
      ));
      toast.error(`${displayName}: ${t('forecast.fetchFailed')}`);
    }
  }, [selectedPlant, fallbackCompanyId, dateKey, viewerSeries, providers, t]);

  const handleRemoveSeries = useCallback((provId: string) => {
    setViewerSeries(prev => prev.filter(s => s.providerId !== provId));
  }, []);

  // Re-fetch viewer series data when date or plant changes (keep selections)
  const prevDateRef = useRef(dateKey);
  const prevPlantRef = useRef(selectedPlantId);
  useEffect(() => {
    const dateChanged = prevDateRef.current !== dateKey;
    const plantChanged = prevPlantRef.current !== selectedPlantId;
    prevDateRef.current = dateKey;
    prevPlantRef.current = selectedPlantId;

    if (plantChanged) {
      // Plant changed → clear everything
      setViewerSeries([]);
      return;
    }
    if (!dateChanged || viewerSeries.length === 0 || !selectedPlant) return;

    // Date changed → re-fetch each series for the new date
    const compId = selectedPlant.companyId || fallbackCompanyId;
    if (!compId) return;

    const dayStr = toDDMMYYYY(dateKey);

    // Mark all as loading
    setViewerSeries(prev => prev.map(s => ({ ...s, loading: true, data: [] })));

    viewerSeries.forEach(s => {
      forecastApi.getValues({
        companyId: compId, powerPlantId: selectedPlant.plantId, provider: s.providerId,
        startDate: dayStr, endDate: dayStr, minute: 0, hour: '12:30',
        columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
      }).then(res => {
        const predictions = extractPredictions(res.Questions);
        const data: { deliveryStart: string; value: number }[] = [];
        for (const p of predictions) {
          if (p.PredictionValue === null || p.PredictionValue === undefined) continue;
          const raw = p.PredictionDate;
          const hasTz = raw.endsWith('Z') || raw.includes('+');
          let predLocal: string;
          if (hasTz) {
            const d = new Date(raw);
            predLocal = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
          } else {
            predLocal = raw.slice(0, 19);
            if (predLocal.length === 16) predLocal += ':00';
          }
          data.push({ deliveryStart: predLocal, value: p.PredictionValue });
        }
        setViewerSeries(prev => prev.map(existing =>
          existing.providerId === s.providerId ? { ...existing, data, loading: false } : existing
        ));
      }).catch(() => {
        setViewerSeries(prev => prev.map(existing =>
          existing.providerId === s.providerId ? { ...existing, loading: false } : existing
        ));
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, selectedPlantId]);

  // Viewer chart option — time axis with "fake UTC" approach (same as LiveChart)
  // All timestamps are shifted by TZ offset and chart uses useUTC:true
  // This ensures monitoring data aligns correctly regardless of server timezone

  const viewerChartOption = useMemo<EChartsOption>(() => {
    // Fixed x-axis: selected day 00:00 to next day 00:00 in fake-UTC
    const [y, mo, d] = dateKey.split('-').map(Number);
    const xMin = Date.UTC(y, mo - 1, d);
    const xMax = Date.UTC(y, mo - 1, d + 1);

    // Determine timezone from selected plant's GCP
    const selectedGcpTimezone = (() => {
      if (!selectedPlantId || !mapping?.companies) return 'UTC';
      for (const company of mapping.companies) {
        for (const gcp of company.gridConnectionPoints) {
          if (gcp.components.some(c => c.portalPlantId === selectedPlantId)) {
            return gcp.timezone || 'UTC';
          }
        }
      }
      return 'UTC';
    })();
    const tzOffsetMs = getTzOffsetMs(selectedGcpTimezone);

    // Forecast provider series — deliveryStart is local time, convert to fake-UTC
    const provSeries = viewerSeries.filter(s => !s.loading).map(s => {
      const timeData: [number, number][] = s.data
        .map(d => {
          const localMs = new Date(d.deliveryStart).getTime();
          // Convert local epoch ms to fake-UTC: add offset so UTC display shows local time
          const fakeUtc = localMs + tzOffsetMs;
          return [fakeUtc, d.value] as [number, number];
        })
        .sort((a, b) => a[0] - b[0]);
      return {
        name: s.providerName,
        type: 'line' as const,
        step: 'middle' as const,
        data: timeData,
        lineStyle: { color: s.color, width: 2, type: 'dashed' as const },
        itemStyle: { color: s.color },
        showSymbol: false,
      };
    });

    // Actual production series — monitoring timestamps + TZ offset (same as LiveChart)
    const actualProdData: [number, number][] = actualProduction
      .map(d => [d.timestamp + tzOffsetMs, d.value] as [number, number])
      .sort((a, b) => a[0] - b[0]);

    const allSeries: any[] = [];

    // Actual production first — prominent white/yellow line
    if (actualProdData.length > 0) {
      allSeries.push({
        name: t('forecast.actualProduction'),
        type: 'line',
        step: 'middle',
        data: actualProdData,
        lineStyle: { color: '#ffffff', width: 2.5 },
        itemStyle: { color: '#ffffff' },
        showSymbol: false,
        z: 5,
      });
    }

    allSeries.push(...provSeries);

    // NOW mark on first series (fake-UTC)
    if (isToday && allSeries.length > 0) {
      const nowTs = Date.now() + tzOffsetMs;
      allSeries[0].markLine = {
        symbol: 'none',
        silent: true,
        data: [{ xAxis: nowTs, lineStyle: { color: '#63b3ed', width: 2, type: 'solid' }, label: { show: true, formatter: 'NOW', color: '#63b3ed', fontSize: 10, position: 'insideStartTop' } }],
      };
    }

    return {
      useUTC: true,
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: '#e0e0e0' },
      grid: { top: 30, right: 12, bottom: 28, left: 50, containLabel: false },
      legend: {
        top: 4,
        textStyle: { color: '#ccc', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(30, 30, 50, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        textStyle: { color: '#e0e0e0', fontSize: 12 },
        axisPointer: { type: 'cross' },
      },
      xAxis: {
        type: 'time',
        min: xMin,
        max: xMax,
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisTick: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: { color: '#e0e0e0', fontSize: 10, formatter: '{HH}:{mm}' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'MW',
        nameTextStyle: { color: '#999', fontSize: 10 },
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: { color: '#e0e0e0', fontSize: 10 },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      series: allSeries.length > 0 ? allSeries : [{
        type: 'line',
        data: [],
        showSymbol: false,
      }],
    };
  }, [viewerSeries, actualProduction, dateKey, isToday, t, selectedPlantId, mapping]);

  // Viewer table data — merge all series + actual production timestamps
  const viewerTableRows = useMemo(() => {
    const timeSet = new Set<string>();
    for (const s of viewerSeries) {
      for (const d of s.data) timeSet.add(d.deliveryStart);
    }
    for (const d of actualProduction) {
      const iso = new Date(d.timestamp).toISOString().slice(0, 16);
      timeSet.add(iso);
    }
    const sortedTimes = [...timeSet].sort();

    const actualMap = new Map(actualProduction.map(d => [new Date(d.timestamp).toISOString().slice(0, 16), d.value]));

    return sortedTimes.map(ts => {
      const values: Record<string, number | null> = {};
      values['__actual__'] = actualMap.get(ts) ?? null;
      for (const s of viewerSeries) {
        const match = s.data.find(d => d.deliveryStart === ts);
        values[s.providerName] = match?.value ?? null;
      }
      return { deliveryStart: ts, values };
    });
  }, [viewerSeries, actualProduction]);

  // =====================================================================
  // SECTION 2: Forecast Submission (editable grid)
  // =====================================================================

  const [submitProviderName, setSubmitProviderName] = useState('');
  const [submitDescription, setSubmitDescription] = useState('');
  const [submitRows, setSubmitRows] = useState<SlotRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [isNewProvider, setIsNewProvider] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nowRowRef = useRef<HTMLDivElement>(null);

  // Rebuild empty rows when date/plant changes
  useEffect(() => {
    setSubmitRows(buildEmptyRows(dateKey, resolution));
  }, [dateKey, selectedPlantId, resolution]);

  useEffect(() => {
    cellRefs.current = cellRefs.current.slice(0, submitRows.length);
  }, [submitRows.length]);

  // Scroll to now
  useEffect(() => {
    const timer = setTimeout(() => nowRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
    return () => clearTimeout(timer);
  }, [submitRows.length, dateKey]);

  // Fetch existing forecast into submission grid
  const handleFetchIntoGrid = useCallback(async () => {
    if (!selectedPlant || !submitProviderName.trim()) return;
    const companyId = selectedPlant.companyId || fallbackCompanyId;
    if (!companyId) return;

    try {
      const dayStr = toDDMMYYYY(dateKey);
      const res = await forecastApi.getValues({
        companyId, powerPlantId: selectedPlant.plantId, provider: submitProviderName.trim(),
        startDate: dayStr, endDate: dayStr, minute: 0, hour: '12:30',
        columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
      });

      // selectedProviderPrediction preserves null; providerPrediction has actual submitted values
      const selectedPreds = extractPredictions(res.Questions);
      const provArr: any[] = res.Questions?.providerPrediction || [];

      const parsePL = (raw: string) => {
        const hasTz = raw.endsWith('Z') || raw.includes('+');
        if (hasTz) {
          const d = new Date(raw);
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
        }
        let pl = raw.slice(0, 19);
        if (pl.length === 16) pl += ':00';
        return pl;
      };

      // Build providerPrediction lookup
      const provMap: Record<string, number | null> = {};
      for (const p of provArr) {
        if (!p?.PredictionDate) continue;
        provMap[parsePL(p.PredictionDate)] = p.PredictionValue ?? null;
      }

      // Check if selectedProviderPrediction is ALL null
      const allSelectedNull = selectedPreds.length > 0 &&
        selectedPreds.every(p => p.PredictionValue === null || p.PredictionValue === undefined);
      const provHasData = provArr.some((p: any) => p?.PredictionValue !== null && p?.PredictionValue !== undefined);

      const newRows = buildEmptyRows(dateKey, resolution);
      let matched = 0;

      if (allSelectedNull && provHasData) {
        // selectedProviderPrediction is completely null → fall back to providerPrediction as-is
        console.log('[Forecast] selectedProviderPrediction all null, falling back to providerPrediction');
        for (const p of provArr) {
          if (!p?.PredictionDate) continue;
          const predLocal = parsePL(p.PredictionDate);
          const idx = newRows.findIndex(r => r.deliveryStart === predLocal);
          if (idx >= 0) {
            newRows[idx] = { ...newRows[idx], value: p.PredictionValue ?? null, edited: false };
            matched++;
          }
        }
      } else {
        // Normal merge: selectedProviderPrediction has meaningful data
        for (const p of selectedPreds) {
          const raw = p.PredictionDate;
          if (!raw) continue;
          const predLocal = parsePL(raw);
          const idx = newRows.findIndex(r => r.deliveryStart === predLocal);
          if (idx >= 0) {
            let val = p.PredictionValue ?? null;
            if (val === null) {
              const provVal = provMap[predLocal];
              if (provVal !== null && provVal !== undefined && provVal !== 0) {
                val = provVal;
              }
            }
            newRows[idx] = { ...newRows[idx], value: val, edited: false };
            matched++;
          }
        }
      }
      setSubmitRows(newRows);
      if (matched > 0) toast.success(`${t('forecast.fetchSuccess')} (${matched} ${t('forecast.slots')})`);
      else toast(t('forecast.noData'), { icon: '\u2139\uFE0F' });
    } catch {
      toast.error(t('forecast.fetchFailed'));
    }
  }, [selectedPlant, fallbackCompanyId, submitProviderName, dateKey, resolution, t]);

  // Cell edit
  const handleValueChange = useCallback((idx: number, raw: string) => {
    setEditingValue(raw);
    // Allow negative: parse with sign
    const num = parseFloat(raw.replace(',', '.'));
    if (!isNaN(num)) {
      setSubmitRows(prev => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], value: num, edited: true };
        return updated;
      });
    }
  }, []);

  // Keyboard nav
  const handleCellKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    const currentNow = nowLocalIso();
    const findNext = (from: number, dir: 1 | -1): number | null => {
      let i = from + dir;
      while (i >= 0 && i < submitRows.length) {
        const row = submitRows[i];
        const dayPast = dateKey < todayStr;
        const slotPast = dateKey === todayStr && row.deliveryEnd <= currentNow;
        if (!dayPast && !slotPast) return i;
        i += dir;
      }
      return null;
    };
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      const next = findNext(idx, 1);
      if (next !== null) { cellRefs.current[next]?.focus(); cellRefs.current[next]?.select(); }
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      const prev = findNext(idx, -1);
      if (prev !== null) { cellRefs.current[prev]?.focus(); cellRefs.current[prev]?.select(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const next = findNext(idx, 1);
      if (next !== null) { cellRefs.current[next]?.focus(); cellRefs.current[next]?.select(); }
    }
  }, [submitRows, dateKey, todayStr]);

  // Paste
  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>, startIdx: number) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const values = text.split(/[\n\r\t]+/).map(v => v.trim()).filter(v => v.length > 0);
    if (values.length <= 1) return;
    e.preventDefault();
    const currentNow = nowLocalIso();
    setSubmitRows(prev => {
      const updated = [...prev];
      let written = 0;
      for (let i = startIdx; i < updated.length && written < values.length; i++) {
        const row = updated[i];
        const dayPast = dateKey < todayStr;
        const slotPast = dateKey === todayStr && row.deliveryEnd <= currentNow;
        if (dayPast || slotPast) continue;
        const num = parseFloat(values[written].replace(',', '.'));
        updated[i] = { ...row, value: isNaN(num) ? 0 : num, edited: true };
        written++;
      }
      return updated;
    });
    toast.success(`${values.length} ${t('forecast.valuesPasted')}`);
  }, [dateKey, todayStr, t]);

  // Copy
  const handleCopy = useCallback((e: ClipboardEvent<HTMLInputElement>, idx: number) => {
    const input = e.target as HTMLInputElement;
    if (input.selectionStart !== input.selectionEnd) return;
    e.preventDefault();
    const text = submitRows.map(r => r.value).slice(idx).join('\n');
    e.clipboardData.setData('text/plain', text);
    toast.success(t('forecast.valuesCopied'));
  }, [submitRows, t]);

  const isReservedProvider = RESERVED_PROVIDERS.some(rp => rp.toLowerCase() === submitProviderName.trim().toLowerCase());

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!selectedPlant) return;
    if (!submitProviderName.trim()) { toast.error(t('forecast.providerRequired')); return; }
    if (submitRows.length === 0) { toast.error(t('forecast.noRows')); return; }

    setSubmitting(true);
    try {
      const providerTrimmed = submitProviderName.trim();
      const cId = selectedPlant.companyId || fallbackCompanyId;

      // Fetch fresh portal values (preserving null) + existing predictions
      const freshSlots: Record<string, number | null> = {};
      const existingSlots: Record<string, number | null> = {};
      const parsePredLocal = (raw: string) => {
        const hasTz = raw.endsWith('Z') || raw.includes('+');
        if (hasTz) {
          const d = new Date(raw);
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
        }
        let pl = raw.slice(0, 19);
        if (pl.length === 16) pl += ':00';
        return pl;
      };
      if (cId) {
        try {
          const dayStr = toDDMMYYYY(dateKey);
          const res = await forecastApi.getValues({
            companyId: cId, powerPlantId: selectedPlant.plantId,
            provider: providerTrimmed,
            startDate: dayStr, endDate: dayStr, minute: 0, hour: '12:30',
            columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
          });
          if (res && !res.isError && res.Questions) {
            // selectedProviderPrediction preserves null
            const selectedPreds = extractPredictions(res.Questions);
            for (const p of selectedPreds) {
              if (!p.PredictionDate) continue;
              freshSlots[parsePredLocal(p.PredictionDate)] = p.PredictionValue ?? null;
            }
            // providerPrediction shows 0 for existing predictions
            const provArr = res.Questions.providerPrediction;
            if (Array.isArray(provArr)) {
              for (const p of provArr) {
                if (!p?.PredictionDate) continue;
                existingSlots[parsePredLocal(p.PredictionDate)] = p.PredictionValue ?? null;
              }
            }
            // If selectedProviderPrediction is ALL null but providerPrediction has data,
            // fall back to providerPrediction for freshSlots (best available data)
            const allFreshNull = Object.keys(freshSlots).length > 0 &&
              Object.values(freshSlots).every(v => v === null);
            const provHasData = Object.values(existingSlots).some(v => v !== null && v !== undefined);
            if (allFreshNull && provHasData) {
              console.log('[Forecast] Submit: selectedProviderPrediction all null, using providerPrediction');
              for (const key of Object.keys(existingSlots)) {
                freshSlots[key] = existingSlots[key];
              }
            }
          }
        } catch { /* proceed with user values only */ }
      }

      // Check if day has any nulls
      const allSlots = buildEmptyRows(dateKey, resolution);
      const hasNulls = allSlots.some(s => {
        const fresh = freshSlots[s.deliveryStart];
        return fresh === null || fresh === undefined;
      });

      let predictions: ForecastSubmissionPrediction[];

      if (hasNulls) {
        // Day has nulls → send only: truly-null slots (as 0) + user-edited slots
        // Skip slots that already exist in providerPrediction (avoid "Predictions already exist")
        predictions = [];
        for (const slot of allSlots) {
          const userRow = submitRows.find(r => r.deliveryStart === slot.deliveryStart);
          const isEdited = userRow?.edited === true;
          const isNull = freshSlots[slot.deliveryStart] === null || freshSlots[slot.deliveryStart] === undefined;
          const alreadyExists = existingSlots[slot.deliveryStart] !== null && existingSlots[slot.deliveryStart] !== undefined;

          if (isEdited || (isNull && !alreadyExists)) {
            const value = isEdited ? (userRow!.value ?? 0) : 0;
            predictions.push({
              deliveryStart: slot.deliveryStart, deliveryStartOffset: 180,
              deliveryEnd: slot.deliveryEnd, deliveryEndOffset: 180,
              value,
            });
          }
        }
        // If we can't cover the day partially, send all slots as fallback
        const nullCount = allSlots.filter(s => freshSlots[s.deliveryStart] === null || freshSlots[s.deliveryStart] === undefined).length;
        if (nullCount > 0 && Object.keys(existingSlots).length + predictions.length < allSlots.length) {
          predictions = allSlots.map(slot => {
            const userRow = submitRows.find(r => r.deliveryStart === slot.deliveryStart);
            const value = userRow?.edited ? (userRow.value ?? 0) : (freshSlots[slot.deliveryStart] ?? 0);
            return {
              deliveryStart: slot.deliveryStart, deliveryStartOffset: 180,
              deliveryEnd: slot.deliveryEnd, deliveryEndOffset: 180,
              value,
            };
          });
          console.log(`[Forecast] Day has nulls → sending full day (${predictions.length} slots) — can't fill partially`);
        } else {
          console.log(`[Forecast] Day has nulls → sending ${predictions.length} slot(s) (null+edited only)`);
        }
        if (predictions.length === 0) {
          toast.error(t('forecast.noRows'));
          return;
        }
      } else {
        // No nulls → send only edited slots
        const editedRows = submitRows.filter(r => r.edited);
        if (editedRows.length === 0) {
          toast.error(t('forecast.noRows'));
          return;
        }
        predictions = editedRows.map(r => ({
          deliveryStart: r.deliveryStart, deliveryStartOffset: 180,
          deliveryEnd: r.deliveryEnd, deliveryEndOffset: 180,
          value: r.value ?? 0,
        }));
        console.log(`[Forecast] No nulls → sending ${predictions.length} edited slot(s)`);
      }

      console.log('[Forecast] Submitting forecast:', {
        providerName: providerTrimmed,
        unitNo: selectedPlant.plantId,
        predictionsCount: predictions.length,
        firstPrediction: predictions[0],
        lastPrediction: predictions[predictions.length - 1],
      });
      const result = await forecastApi.submitForecast({
        providerName: providerTrimmed, measureUnit: 1, description: submitDescription.trim(),
        forecasts: [{ unitNo: selectedPlant.plantId, predictions }],
      });
      console.log('[Forecast] Submit result:', result);
      if (!result.success) {
        const detail = result.message || (result.data ? JSON.stringify(result.data) : t('forecast.submitFailed'));
        toast.error(`${t('forecast.submitFailed')}: ${detail}`, { duration: 10000 });
        return;
      }
      toast.success(t('forecast.submitSuccess'));
    } catch (err: any) {
      console.error('[Forecast] Submit error:', err.response?.data || err.message);
      toast.error(err.response?.data?.message || t('forecast.submitFailed'), { duration: 8000 });
    } finally { setSubmitting(false); }
  }, [selectedPlant, fallbackCompanyId, submitProviderName, submitDescription, submitRows, dateKey, resolution, t]);

  // Resolution label
  const resolutionLabel = useMemo(() => {
    if (resolution === 60) return t('forecast.resHourly');
    if (resolution === 15) return t('forecast.res15m');
    if (resolution === 30) return t('forecast.res30m');
    return `${resolution} dk`;
  }, [resolution, t]);

  // ---- Guards ----
  if (!mapping || gcpGroups.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('forecast.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('common.configureMapping')}</p>
        </div>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header + date nav */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">{t('forecast.title')}</h2>
        <div className="flex items-center gap-3">
          <DateNav
            selectedDate={new Date(dateKey + 'T12:00:00')}
            onDateChange={(d) => setDateKey(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)}
          />
          <span className="text-xs text-gray-500">{t('forecast.resolution')}</span>
          <span className="text-xs bg-dark-700 text-primary-300 border border-primary-800 px-2 py-0.5 rounded-full">{resolutionLabel}</span>
        </div>
      </div>

      {/* Plant selector — grouped by GCP (child components only) */}
      <div className="mb-5">
        <span className="text-xs text-gray-500 block mb-2">{t('forecast.batteries')}</span>
        <div className="flex flex-col gap-3">
          {gcpGroups.map(group => (
            <div key={group.gcpId}>
              {/* GCP label */}
              <div className="text-xs text-gray-500 mb-1">{group.gcpName}</div>
              {/* Child components */}
              {group.children.length > 0 && (
                <div className="flex flex-wrap gap-0">
                  {group.children.map((child, ci) => (
                    <button
                      key={child.plantId}
                      onClick={() => setSelectedPlantId(child.plantId)}
                      className={`text-left px-4 py-2 border transition-colors ${
                        child.plantId === selectedPlantId
                          ? 'bg-primary-600/20 border-primary-500 text-primary-300'
                          : 'bg-dark-900/50 border-gray-700 text-gray-400 hover:border-gray-600'
                      } ${ci === 0 ? 'rounded-tl-lg rounded-bl-lg' : ''} ${ci === group.children.length - 1 ? 'rounded-tr-lg rounded-br-lg' : ''}`}
                    >
                      <div className="text-xs font-medium">{child.displayName}</div>
                      <div className="text-[10px] opacity-60">ID: {child.plantId}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================= */}
      {/* SECTION 1: Forecast Viewer */}
      {/* ============================================================= */}
      <div className="bg-dark-800 border border-gray-700 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-300">{t('forecast.viewer')}</h3>
          <div className="flex items-center gap-2">
            {/* Chart / Table toggle */}
            <div className="flex bg-dark-700 rounded-lg border border-gray-600 overflow-hidden">
              <button
                onClick={() => setViewerMode('chart')}
                className={`text-xs px-3 py-1 transition-colors ${viewerMode === 'chart' ? 'bg-primary-600/30 text-primary-300' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {t('forecast.chartView')}
              </button>
              <button
                onClick={() => setViewerMode('table')}
                className={`text-xs px-3 py-1 transition-colors ${viewerMode === 'table' ? 'bg-primary-600/30 text-primary-300' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {t('forecast.tableView')}
              </button>
            </div>
          </div>
        </div>

        {/* Add series combo */}
        <div className="flex items-center gap-2 mb-3">
          <select
            value={addingProvider}
            onChange={e => setAddingProvider(e.target.value)}
            className="bg-dark-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500"
          >
            <option value="">{t('forecast.selectProvider')}</option>
            {providers
              .filter(p => !viewerSeries.some(s => s.providerId === p.ProviderId))
              .map(p => (
                <option key={p.ProviderId} value={p.ProviderId}>{p.ProviderName}</option>
              ))}
          </select>
          <button
            onClick={() => { if (addingProvider) { handleAddSeries(addingProvider); setAddingProvider(''); } }}
            disabled={!addingProvider}
            className="bg-dark-600 hover:bg-dark-500 disabled:bg-dark-700 disabled:text-gray-600 border border-gray-600 disabled:border-gray-700 text-gray-200 text-xs font-medium px-3 py-1.5 rounded transition-colors"
          >
            {t('forecast.addSeries')}
          </button>
        </div>

        {/* Active series chips */}
        {viewerSeries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {viewerSeries.map(s => (
              <span key={s.providerId} className="inline-flex items-center gap-1.5 bg-dark-700 border border-gray-600 rounded-full px-2.5 py-0.5 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-gray-300">{s.providerName}</span>
                {s.loading && <span className="text-gray-500 animate-pulse">...</span>}
                <button
                  onClick={() => handleRemoveSeries(s.providerId)}
                  className="text-gray-500 hover:text-red-400 ml-0.5"
                  title={t('forecast.removeSeries')}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Chart or Table */}
        {viewerMode === 'chart' ? (
          <div>
            {viewerSeries.length === 0 && actualProduction.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                {t('forecast.noSeries')}
              </div>
            ) : (
              <ReactECharts option={viewerChartOption} notMerge style={{ height: 320, width: '100%' }} />
            )}
          </div>
        ) : (
          <div className="overflow-auto max-h-[400px] border border-gray-700 rounded">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead className="bg-dark-700 sticky top-0 z-10">
                <tr>
                  <th className="text-left text-gray-400 font-medium px-3 py-2 border-b border-gray-600 w-24">{t('forecast.time')}</th>
                  {actualProduction.length > 0 && (
                    <th className="text-right font-medium px-3 py-2 border-b border-gray-600">
                      <span className="inline-flex items-center gap-1 text-white">
                        <span className="w-2 h-2 rounded-full bg-white" />
                        {t('forecast.actualProduction')}
                      </span>
                    </th>
                  )}
                  {viewerSeries.map(s => (
                    <th key={s.providerId} className="text-right text-gray-400 font-medium px-3 py-2 border-b border-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.providerName}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewerTableRows.map((row, i) => {
                  const slotIsPast = isPast || (isToday && row.deliveryStart < nowStr);
                  const slotIsNow = isToday && row.deliveryStart <= nowStr && (i + 1 >= viewerTableRows.length || viewerTableRows[i + 1].deliveryStart > nowStr);
                  return (
                    <tr key={row.deliveryStart} className={slotIsNow ? 'bg-primary-600/10' : slotIsPast ? 'bg-dark-900/30' : ''}>
                      <td className={`px-3 py-1 font-mono text-xs border-b border-gray-800 ${slotIsNow ? 'text-primary-300 font-semibold' : slotIsPast ? 'text-gray-600' : 'text-gray-300'}`}>
                        {slotLabel(row.deliveryStart)}
                      </td>
                      {actualProduction.length > 0 && (
                        <td className="px-3 py-1 text-right font-mono text-xs border-b border-gray-800 text-white font-semibold">
                          {row.values['__actual__'] !== null ? row.values['__actual__'] : '-'}
                        </td>
                      )}
                      {viewerSeries.map(s => (
                        <td key={s.providerId} className="px-3 py-1 text-right font-mono text-xs border-b border-gray-800 text-gray-300">
                          {row.values[s.providerName] !== null ? row.values[s.providerName] : '-'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================= */}
      {/* SECTION 2: Forecast Submission */}
      {/* ============================================================= */}
      <div className="bg-dark-800 border border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">{t('forecast.submission')}</h3>

        {/* Provider + description */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('forecast.provider')}</label>
            {isNewProvider ? (
              <div className="flex gap-2">
                <input type="text" value={submitProviderName} onChange={e => setSubmitProviderName(e.target.value)}
                  autoFocus placeholder={t('forecast.providerPlaceholder')}
                  className="flex-1 bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500" />
                <button onClick={() => { setIsNewProvider(false); setSubmitProviderName(''); }}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1 bg-dark-700 border border-gray-600 rounded">
                  &times;
                </button>
              </div>
            ) : (
              <select
                value={submitProviderName}
                onChange={e => {
                  if (e.target.value === '__new__') { setIsNewProvider(true); setSubmitProviderName(''); }
                  else setSubmitProviderName(e.target.value);
                }}
                className="w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
              >
                <option value="">{t('forecast.selectProvider')}</option>
                {providers.map(p => (
                  <option key={p.ProviderId} value={p.ProviderName}>{p.ProviderName}</option>
                ))}
                <option value="__new__">{t('forecast.newProvider')}</option>
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('forecast.description')}</label>
            <input type="text" value={submitDescription} onChange={e => setSubmitDescription(e.target.value)}
              placeholder={t('forecast.descriptionPlaceholder')}
              className="w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500" />
          </div>
          <div className="flex items-end gap-2">
            <button onClick={handleFetchIntoGrid} disabled={!submitProviderName.trim()}
              className="bg-dark-600 hover:bg-dark-500 disabled:bg-dark-700 disabled:text-gray-600 border border-gray-600 disabled:border-gray-700 text-gray-200 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {t('forecast.fetchForecast')}
            </button>
          </div>
        </div>

        {/* Hint */}
        <div className="px-3 py-1.5 border border-gray-700 rounded bg-dark-700/50 mb-3">
          <span className="text-[10px] text-gray-500">{t('forecast.editHint')}</span>
        </div>

        {/* Editable grid */}
        <div className="bg-dark-800 border border-gray-700 rounded-lg overflow-hidden mb-4">
          <div className="grid grid-cols-[1fr_120px] text-xs text-gray-500 uppercase tracking-wide bg-dark-700 px-4 py-2 border-b border-gray-700">
            <span>{t('forecast.time')}</span>
            <span className="text-right">{t('forecast.value')}</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
            {submitRows.map((row, idx) => {
              const slotIsPast = isToday && row.deliveryEnd <= nowStr;
              const slotIsNow = isToday && row.deliveryStart <= nowStr && row.deliveryEnd > nowStr;
              const isDisabled = isPast || slotIsPast;

              let rowBg = '';
              if (slotIsNow) rowBg = 'bg-primary-600/15';
              else if (focusedIdx === idx) rowBg = 'bg-dark-600/50';
              else if (row.edited) rowBg = 'bg-primary-900/10';
              else if (row.value === null) rowBg = 'bg-red-900/10';
              else if (isDisabled) rowBg = 'bg-dark-900/40';

              return (
                <div key={row.deliveryStart} className="relative">
                  {slotIsNow && (
                    <div ref={nowRowRef} className="absolute left-0 right-0 top-0 h-0.5 bg-primary-400 z-10"
                      style={{ boxShadow: '0 0 6px rgba(99, 179, 237, 0.6)' }} />
                  )}
                  <div className={`grid grid-cols-[1fr_120px] items-center px-4 py-1 border-b border-gray-800 ${rowBg}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono ${isDisabled ? 'text-gray-600' : slotIsNow ? 'text-primary-300 font-semibold' : 'text-gray-300'}`}>
                        {slotLabel(row.deliveryStart)} – {slotLabel(row.deliveryEnd)}
                      </span>
                      {slotIsNow && <span className="text-[10px] text-primary-400 font-medium uppercase tracking-wider">NOW</span>}
                    </div>
                    <input
                      ref={el => { cellRefs.current[idx] = el; }}
                      type="text"
                      inputMode="decimal"
                      value={editingIdx === idx ? editingValue : (row.value === null ? '' : row.value)}
                      placeholder={row.value === null ? 'null' : undefined}
                      onChange={e => handleValueChange(idx, e.target.value)}
                      onKeyDown={e => handleCellKeyDown(e, idx)}
                      onPaste={e => handlePaste(e, idx)}
                      onCopy={e => handleCopy(e, idx)}
                      onFocus={() => { setFocusedIdx(idx); setEditingIdx(idx); setEditingValue(row.value === null ? '' : String(row.value)); }}
                      onBlur={() => {
                        setFocusedIdx(null);
                        const num = parseFloat(editingValue.replace(',', '.'));
                        setSubmitRows(prev => {
                          const updated = [...prev];
                          updated[idx] = { ...updated[idx], value: isNaN(num) ? 0 : num, edited: true };
                          return updated;
                        });
                        setEditingIdx(null);
                      }}
                      disabled={isDisabled}
                      className={`w-full rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500 ${
                        isDisabled
                          ? 'bg-dark-800 border border-gray-700 text-gray-600 cursor-not-allowed'
                          : 'bg-dark-700 border border-gray-600 text-white'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button onClick={handleSubmit}
            disabled={submitting || submitRows.length === 0 || !submitProviderName.trim() || isPast || isReservedProvider}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors">
            {submitting ? t('forecast.submitting') : t('forecast.submitForecast')}
          </button>
          {isPast && <span className="text-xs text-orange-400">{t('forecast.pastDateWarning')}</span>}
          {isReservedProvider && <span className="text-xs text-orange-400">{t('forecast.reservedProvider')}</span>}
          <span className="text-xs text-gray-600">{submitRows.length} {t('forecast.slots')}</span>
        </div>
      </div>
    </div>
  );
}
