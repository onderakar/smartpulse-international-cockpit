import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule } from 'ag-grid-community';
import type { ColDef, CellValueChangedEvent, RowClassParams, CellFocusedEvent } from 'ag-grid-community';
import { useProfile } from '../context/ProfileContext';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { useMonitoring } from '../context/MonitoringContext';
import { useTechParams } from '../hooks/useTechParams';
import { useScheduleData } from '../hooks/useScheduleData';
import { scheduleApi } from '../api/schedule.api';
import { forecastApi } from '../api/forecast.api';
import { getBessGcps } from '@shared/types/assetMapping.types';
import type { BessGcpInfo } from '@shared/types/assetMapping.types';
import type { ScheduleRow, ForecastSubmissionPrediction } from '@smartpulse-intl/shared';
import { SCHEDULE_CSV_COLUMNS } from '@smartpulse-intl/shared';
import { SlotRevisionPopup } from '../components/schedule/SlotRevisionPopup';
// ---------------------------------------------------------------------------
// Compact live battery overlay (shown on chart top-right)
// ---------------------------------------------------------------------------
function LiveBatteryOverlay() {
  const { t } = useLocale();
  const { liveSnapshot } = useMonitoring();
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;
  const { params: techParams } = useTechParams(mapping);

  const liveBapMW = liveSnapshot.bapMW;
  const liveSocMwh = liveSnapshot.socMwh;
  const capacityMwh = techParams?.battery.batteryCapacityMwh ?? null;
  const socPercent = liveSocMwh !== null && capacityMwh
    ? (liveSocMwh / capacityMwh) * 100
    : null;

  const isCharging = liveBapMW !== null && liveBapMW < -0.01;
  const isDischarging = liveBapMW !== null && liveBapMW > 0.01;

  if (liveBapMW === null) return null;

  return (
    <div className="absolute top-9 right-20 z-10 flex items-center gap-3 bg-dark-900/85 backdrop-blur-sm border border-gray-700/50 rounded px-2.5 py-1">
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
        </span>
        <span className="text-[10px] text-gray-500 uppercase">{t('liveBattery.title')}</span>
      </div>
      <span className={`text-sm font-bold font-mono ${
        isCharging ? 'text-emerald-400' : isDischarging ? 'text-rose-400' : 'text-gray-300'
      }`}>
        {liveBapMW.toFixed(2)} MW
      </span>
      <span className={`text-[10px] ${
        isCharging ? 'text-emerald-500' : isDischarging ? 'text-rose-500' : 'text-gray-600'
      }`}>
        {isCharging ? t('battery.charging') : isDischarging ? t('battery.discharging') : t('battery.idle')}
      </span>
      {liveSocMwh !== null && (
        <span className="text-xs font-mono text-sky-400">
          {liveSocMwh.toFixed(1)} MWh
          {socPercent !== null && <span className="text-gray-500 ml-0.5">({socPercent.toFixed(0)}%)</span>}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateKeyStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDDMMYYYY(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

function extractPredictions(questions: any): { PredictionDate: string; PredictionValue: number | null }[] {
  if (!questions) return [];
  // selectedProviderPrediction preserves null (= never submitted)
  // providerPrediction always returns 0 for null hours — masks the real state
  const KNOWN_KEYS = ['selectedProviderPrediction', 'providerPrediction', 'selectedPrediction', 'lastPrediction'];

  // Log all available prediction arrays for debugging
  const summary: Record<string, { length: number; nullCount: number; sample: any }> = {};
  for (const key of Object.keys(questions)) {
    const arr = questions[key];
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.PredictionDate !== undefined) {
      const nullCount = arr.filter((p: any) => p.PredictionValue === null || p.PredictionValue === undefined).length;
      summary[key] = { length: arr.length, nullCount, sample: arr[0]?.PredictionValue };
    }
  }
  console.log('[extractPredictions] Available arrays:', JSON.stringify(summary));

  for (const key of KNOWN_KEYS) {
    const arr = questions[key];
    if (Array.isArray(arr) && arr.length > 0) {
      console.log(`[extractPredictions] Selected: "${key}" (${arr.length} items)`);
      return arr;
    }
  }
  for (const key of Object.keys(questions)) {
    if (KNOWN_KEYS.includes(key)) continue;
    const val = questions[key];
    if (Array.isArray(val) && val.length > 0 && val[0]?.PredictionDate !== undefined) {
      console.log(`[extractPredictions] Selected fallback: "${key}" (${val.length} items)`);
      return val;
    }
  }
  return [];
}

function nowLocalIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}T${pad2(n.getHours())}:${pad2(n.getMinutes())}:00`;
}

// ---------------------------------------------------------------------------
// AG Grid row type — hourly master rows + expandable quarter sub-rows
// ---------------------------------------------------------------------------

interface ProgramGridRow {
  id: string;
  type: 'hour' | 'quarter';
  timeLabel: string;
  hourGroup: number;
  scheduleBap: number;
  program: number | null;
  actualBap: number | null;
  isPast: boolean;
  isNow: boolean;
  dayIndex: number;
  dateKey: string;
  /** Global index into editedScheduleRows (only meaningful for quarter rows) */
  scheduleIndex: number;
  /** Key for program values: "YYYY-MM-DD-H" */
  programKey: string;
  /** Quarter index 0-3 (only for quarter rows) */
  quarterIndex?: number;
  /** Whether this hour row is expanded */
  expanded?: boolean;
  /** UTC Delivery_Start from schedule row (quarter rows only) */
  utcDeliveryStart?: string;
  /** UTC Delivery_End from schedule row (quarter rows only) */
  utcDeliveryEnd?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatteryProgramPage() {
  const { profile } = useProfile();
  const { companies } = useAuth();
  const { t } = useLocale();
  const { data: monitoringData } = useMonitoring();
  const mapping = profile?.assetMapping ?? null;
  const { params: techParams } = useTechParams(mapping);

  const bessList = useMemo(() => getBessGcps(mapping), [mapping]);
  const fallbackCompanyId = companies.length > 0 ? companies[0].id : null;

  // State
  const [selectedBessIdx, setSelectedBessIdx] = useState(0);
  const [programValues, setProgramValues] = useState<Record<string, number | null>>({});
  const [programLoaded, setProgramLoaded] = useState(false);
  const [programEdited, setProgramEdited] = useState<Set<string>>(new Set());
  const [expandedHours, setExpandedHours] = useState<Set<string>>(new Set());
  const [fetchingProgram, setFetchingProgram] = useState(false);
  const [submittingProgram, setSubmittingProgram] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [revisionPopup, setRevisionPopup] = useState<{
    plantId: number;
    deliveryStart: string;
    deliveryEnd: string;
    anchorRect: { top: number; left: number; width: number; height: number };
  } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live clock — tick every 10s for "X sn önce" display
  const [nowStr, setNowStr] = useState(nowLocalIso);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => { setNowStr(nowLocalIso()); setNowMs(Date.now()); }, 10_000);
    return () => clearInterval(id);
  }, []);

  const selectedBess: BessGcpInfo | null = bessList[selectedBessIdx] ?? null;

  const selectedGcp = useMemo(() => {
    if (!mapping?.companies || !selectedBess) return null;
    for (const c of mapping.companies) {
      for (const gcp of c.gridConnectionPoints) {
        if (gcp.id === selectedBess.gcpId) return gcp;
      }
    }
    return null;
  }, [mapping, selectedBess]);

  const _timezone = selectedGcp?.timezone ?? 'UTC';

  const companyId = useMemo(() => {
    if (!mapping?.companies || !selectedBess) return fallbackCompanyId;
    for (const c of mapping.companies) {
      for (const gcp of c.gridConnectionPoints) {
        if (gcp.id === selectedBess.gcpId) return c.companyId || fallbackCompanyId;
      }
    }
    return fallbackCompanyId;
  }, [mapping, selectedBess, fallbackCompanyId]);

  // Date keys
  const todayKey = useMemo(() => dateKeyStr(new Date()), []);
  const tomorrowKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateKeyStr(d);
  }, []);

  // ------- Schedule data (15min) -------
  const { rows: scheduleTodayRows, header: scheduleTodayHeader, loading: scheduleLoading, lastFetchedAt: scheduleLastFetched, fetchSchedule: fetchScheduleToday } = useScheduleData({
    plantId: selectedBess?.gcpId ?? null,
    dateKey: todayKey,
    enabled: selectedBess !== null,
  });
  const { rows: scheduleTomorrowRows, fetchSchedule: fetchScheduleTomorrow } = useScheduleData({
    plantId: selectedBess?.gcpId ?? null,
    dateKey: tomorrowKey,
    enabled: selectedBess !== null,
  });

  const allScheduleRows = useMemo(() => {
    const combined = [...scheduleTodayRows, ...scheduleTomorrowRows];
    const seen = new Set<string>();
    return combined.filter(r => {
      if (seen.has(r.Delivery_Start)) return false;
      seen.add(r.Delivery_Start);
      return true;
    });
  }, [scheduleTodayRows, scheduleTomorrowRows]);

  // Editable copy of schedule rows
  const [editedScheduleRows, setEditedScheduleRows] = useState<ScheduleRow[]>([]);
  const prevScheduleRef = useRef<ScheduleRow[]>([]);
  useEffect(() => {
    if (!scheduleDirty && allScheduleRows.length > 0 && allScheduleRows !== prevScheduleRef.current) {
      setEditedScheduleRows(allScheduleRows.map(r => ({ ...r })));
      prevScheduleRef.current = allScheduleRows;
    }
  }, [allScheduleRows, scheduleDirty]);

  // ------- Program data (hourly OptBESS) -------
  const fetchProgram = useCallback(() => {
    if (!selectedBess || !companyId) return;
    const providerName = selectedBess.bessComponent.forecastPreference?.sourceName;
    if (!providerName) return;

    setFetchingProgram(true);

    const fetchDay = async (dateKey: string) => {
      const dayStr = toDDMMYYYY(dateKey);
      try {
        return await forecastApi.getValues({
          companyId,
          powerPlantId: selectedBess.bessComponent.portalPlantId,
          provider: providerName,
          startDate: dayStr,
          endDate: dayStr,
          minute: 0,
          hour: '12:30',
          columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
        });
      } catch {
        return null;
      }
    };

    Promise.all([fetchDay(todayKey), fetchDay(tomorrowKey)]).then(([todayRes, tomorrowRes]) => {
      const newValues: Record<string, number | null> = {};

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

      const applyPredictions = (res: any, label: string) => {
        if (!res || res.isError) return;
        // selectedProviderPrediction: preserves null (truly empty hours)
        const selectedPreds = extractPredictions(res.Questions);
        // providerPrediction: shows actual submitted values (but masks null as 0)
        const provArr: any[] = res.Questions?.providerPrediction || [];

        // Build providerPrediction lookup: hour → value
        const provMap: Record<string, number | null> = {};
        for (const p of provArr) {
          if (!p?.PredictionDate) continue;
          const predLocal = parsePredLocal(p.PredictionDate);
          const datePart = predLocal.slice(0, 10);
          const hour = parseInt(predLocal.slice(11, 13), 10);
          provMap[`${datePart}-${hour}`] = p.PredictionValue ?? null;
        }

        // Check if selectedProviderPrediction is ALL null for this response
        const allSelectedNull = selectedPreds.length > 0 &&
          selectedPreds.every(p => p.PredictionValue === null || p.PredictionValue === undefined);
        // Check if providerPrediction has any data (at least one non-null entry)
        const provHasData = provArr.some((p: any) => p?.PredictionValue !== null && p?.PredictionValue !== undefined);

        const nullHours: number[] = [];
        const zeroHours: number[] = [];

        if (allSelectedNull && provHasData) {
          // selectedProviderPrediction is completely null but providerPrediction has data
          // → use providerPrediction as-is: 0 means 0, null means null
          console.log(`[BatteryProgram] ${label}: selectedProviderPrediction all null, falling back to providerPrediction`);
          for (const p of provArr) {
            if (!p?.PredictionDate) continue;
            const predLocal = parsePredLocal(p.PredictionDate);
            const datePart = predLocal.slice(0, 10);
            const hour = parseInt(predLocal.slice(11, 13), 10);
            const key = `${datePart}-${hour}`;
            const val = p.PredictionValue ?? null;
            newValues[key] = val;
            if (val === null || val === undefined) nullHours.push(hour);
            else if (val === 0) zeroHours.push(hour);
          }
        } else {
          // Normal merge: selectedProviderPrediction has meaningful data
          for (const p of selectedPreds) {
            const raw = p.PredictionDate;
            if (!raw) continue;
            const predLocal = parsePredLocal(raw);
            const datePart = predLocal.slice(0, 10);
            const hour = parseInt(predLocal.slice(11, 13), 10);
            const key = `${datePart}-${hour}`;
            const selectedVal = p.PredictionValue;

            if (selectedVal === null || selectedVal === undefined) {
              // Check providerPrediction for a non-zero value (clearly submitted)
              const provVal = provMap[key];
              if (provVal !== null && provVal !== undefined && provVal !== 0) {
                newValues[key] = provVal;
              } else {
                newValues[key] = null;
                nullHours.push(hour);
              }
            } else {
              if (selectedVal === 0) zeroHours.push(hour);
              newValues[key] = selectedVal;
            }
          }
        }

        console.log(`[BatteryProgram] ${label}: ${selectedPreds.length} predictions, nullHours=[${nullHours}], zeroHours=[${zeroHours}], totalKeys=${Object.keys(newValues).length}`);
      };

      applyPredictions(todayRes, `fetchProgram(${todayKey})`);
      applyPredictions(tomorrowRes, `fetchProgram(${tomorrowKey})`);
      setProgramValues(newValues);
      setProgramLoaded(true);
      setProgramEdited(new Set());
      setFetchingProgram(false);
    });
  }, [selectedBess, companyId, todayKey, tomorrowKey]);

  useEffect(() => { fetchProgram(); }, [fetchProgram]);

  // ------- Refresh all data -------
  const handleRefreshAll = useCallback(() => {
    fetchScheduleToday();
    fetchScheduleTomorrow();
    fetchProgram();
  }, [fetchScheduleToday, fetchScheduleTomorrow, fetchProgram]);

  // ------- Toggle hour expand (accordion: only one at a time) -------
  const toggleExpand = useCallback((hourKey: string) => {
    setExpandedHours(prev => {
      if (prev.has(hourKey)) return new Set();
      return new Set([hourKey]);
    });
  }, []);

  // ------- Build grid rows: hourly masters + expanded quarter sub-rows -------

  // Pre-compute a local-time index for schedule rows (Delivery_Start is UTC, we need Istanbul time)
  const scheduleLocalIndex = useMemo(() => {
    const index = new Map<string, number>(); // "YYYY-MM-DD HH:MM" → index in editedScheduleRows
    for (let i = 0; i < editedScheduleRows.length; i++) {
      const ds = editedScheduleRows[i].Delivery_Start;
      // Convert UTC ISO string to Istanbul local date/time
      const d = new Date(ds);
      if (isNaN(d.getTime())) continue;
      // Turkey is always UTC+3
      const localMs = d.getTime() + 3 * 3600_000;
      const local = new Date(localMs);
      const key = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())} ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
      index.set(key, i);
    }
    return index;
  }, [editedScheduleRows]);

  // Pre-compute 15-min average actual BAP from monitoring data
  // Key: "YYYY-MM-DD H:MM" (local Istanbul) → average MW
  const actualBapIndex = useMemo(() => {
    const index = new Map<string, { sum: number; count: number }>();
    const bapPoints = monitoringData?.batteryActivePower ?? [];
    for (const pt of bapPoints) {
      // Convert UTC timestamp to Istanbul local, snap to 15-min slot start
      const localMs = pt.timestamp + 3 * 3600_000;
      const slotMs = Math.floor(localMs / (15 * 60_000)) * (15 * 60_000);
      const slotDate = new Date(slotMs);
      const key = `${slotDate.getUTCFullYear()}-${pad2(slotDate.getUTCMonth() + 1)}-${pad2(slotDate.getUTCDate())} ${pad2(slotDate.getUTCHours())}:${pad2(slotDate.getUTCMinutes())}`;
      const entry = index.get(key) || { sum: 0, count: 0 };
      entry.sum += pt.value;
      entry.count++;
      index.set(key, entry);
    }
    return index;
  }, [monitoringData?.batteryActivePower]);

  const gridRows = useMemo<ProgramGridRow[]>(() => {
    const rows: ProgramGridRow[] = [];
    const currentNow = nowStr;
    const nowDate = new Date();
    const nowDateKey = dateKeyStr(nowDate);
    const nowHour = nowDate.getHours();

    for (let dayIdx = 0; dayIdx < 2; dayIdx++) {
      const dateKey = dayIdx === 0 ? todayKey : tomorrowKey;

      for (let h = 0; h < 24; h++) {
        const programKey = `${dateKey}-${h}`;
        const hourKey = programKey;
        // Before data loads show 0; after load, show null if portal returned null
        const program = programLoaded
          ? (programKey in programValues ? programValues[programKey] : null)
          : 0;
        const isExpanded = expandedHours.has(hourKey);

        // Collect 4 quarter schedule slots for this hour
        const quarterSlots: { bap: number; index: number }[] = [];
        for (let q = 0; q < 4; q++) {
          const localKey = `${dateKey} ${pad2(h)}:${pad2(q * 15)}`;
          const idx = scheduleLocalIndex.get(localKey) ?? -1;
          const bap = idx >= 0 ? (Number(editedScheduleRows[idx].Battery_Active_Power_MW) || 0) : 0;
          quarterSlots.push({ bap, index: idx });
        }

        // Average BAP for hourly summary
        const validSlots = quarterSlots.filter(s => s.index >= 0);
        const avgBap = validSlots.length > 0
          ? validSlots.reduce((sum, s) => sum + s.bap, 0) / validSlots.length
          : 0;

        // Hour-level past/now detection
        const hourEndStr = h < 23
          ? `${dateKey}T${pad2(h + 1)}:00:00`
          : (() => { const d = new Date(`${dateKey}T12:00:00`); d.setDate(d.getDate() + 1); return `${dateKeyStr(d)}T00:00:00`; })();
        const isPast = hourEndStr <= currentNow;
        const isNow = dateKey === nowDateKey && h === nowHour;

        // Compute actual BAP for this hour (average of 4 quarter actuals)
        let actualBapSum = 0;
        let actualBapCount = 0;
        const quarterActuals: (number | null)[] = [];
        for (let q = 0; q < 4; q++) {
          const aKey = `${dateKey} ${pad2(h)}:${pad2(q * 15)}`;
          const aEntry = actualBapIndex.get(aKey);
          if (aEntry) {
            const avg = aEntry.sum / aEntry.count;
            quarterActuals.push(Math.round(avg * 100) / 100);
            actualBapSum += avg;
            actualBapCount++;
          } else {
            quarterActuals.push(null);
          }
        }
        const hourActualBap = actualBapCount > 0
          ? Math.round((actualBapSum / actualBapCount) * 100) / 100
          : null;

        // Get UTC delivery start/end from first quarter for hour-level popup
        const firstQIdx = quarterSlots[0].index;
        const firstQRow = firstQIdx >= 0 ? editedScheduleRows[firstQIdx] : null;

        // Push hourly master row
        rows.push({
          id: `${dateKey}-H${h}`,
          type: 'hour',
          timeLabel: `${pad2(h)}:00`,
          hourGroup: h,
          scheduleBap: Math.round(avgBap * 100) / 100,
          program,
          actualBap: hourActualBap,
          isPast,
          isNow,
          dayIndex: dayIdx,
          dateKey,
          scheduleIndex: -1,
          programKey,
          expanded: isExpanded,
          utcDeliveryStart: firstQRow?.Delivery_Start,
          utcDeliveryEnd: firstQRow?.Delivery_End,
        });

        // Push quarter sub-rows if expanded
        if (isExpanded) {
          for (let q = 0; q < 4; q++) {
            const startMin = q * 15;
            const endH = q === 3 ? h + 1 : h;
            const endMin = q === 3 ? 0 : (q + 1) * 15;
            let endLabel: string;
            if (q === 3 && h === 23) endLabel = '00:00';
            else endLabel = `${pad2(endH)}:${pad2(endMin)}`;

            const qEndStr = q < 3
              ? `${dateKey}T${pad2(h)}:${pad2((q + 1) * 15)}:00`
              : hourEndStr;
            const qIsPast = qEndStr <= currentNow;

            // Get UTC delivery start/end from the schedule row if available
            const schedIdx = quarterSlots[q].index;
            const schedRow = schedIdx >= 0 ? editedScheduleRows[schedIdx] : null;

            rows.push({
              id: `${dateKey}-Q${h}-${q}`,
              type: 'quarter',
              timeLabel: `${pad2(h)}:${pad2(startMin)} – ${endLabel}`,
              hourGroup: h,
              scheduleBap: quarterSlots[q].bap,
              program,
              actualBap: quarterActuals[q],
              isPast: qIsPast,
              isNow: false,
              dayIndex: dayIdx,
              dateKey,
              scheduleIndex: quarterSlots[q].index,
              programKey,
              quarterIndex: q,
              utcDeliveryStart: schedRow?.Delivery_Start,
              utcDeliveryEnd: schedRow?.Delivery_End,
            });
          }
        }
      }
    }
    return rows;
  }, [todayKey, tomorrowKey, editedScheduleRows, programValues, programLoaded, nowStr, expandedHours, scheduleLocalIndex, actualBapIndex]);

  // ------- Hourly rows for chart + SoC projection -------
  const hourlyRows = useMemo(() => {
    const rows: { dateKey: string; hour: number; programValue: number | null; isPast: boolean }[] = [];
    for (let dayIdx = 0; dayIdx < 2; dayIdx++) {
      const dateKey = dayIdx === 0 ? todayKey : tomorrowKey;
      for (let h = 0; h < 24; h++) {
        const programKey = `${dateKey}-${h}`;
        const nextH = h + 1;
        const hourEndStr = nextH < 24
          ? `${dateKey}T${pad2(nextH)}:00:00`
          : (() => { const d = new Date(`${dateKey}T12:00:00`); d.setDate(d.getDate() + 1); return `${dateKeyStr(d)}T00:00:00`; })();
        rows.push({
          dateKey,
          hour: h,
          programValue: programLoaded
            ? (programKey in programValues ? programValues[programKey] : null)
            : 0,
          isPast: hourEndStr <= nowStr,
        });
      }
    }
    return rows;
  }, [todayKey, tomorrowKey, programValues, programLoaded, nowStr]);

  // ------- SoC projection -------
  const socProjection = useMemo(() => {
    if (!techParams?.battery) return [];
    const { batteryCapacityMwh, chargeEfficiency, dischargeEfficiency } = techParams.battery;
    if (!batteryCapacityMwh || batteryCapacityMwh <= 0) return [];

    const socData = monitoringData?.batterySoc ?? [];
    if (socData.length === 0) return [];

    const lastSocPoint = socData[socData.length - 1];
    let currentSocMwh = lastSocPoint.value;

    const projection: { timestamp: number; value: number }[] = [];
    projection.push({ timestamp: lastSocPoint.timestamp, value: currentSocMwh });

    const effCharge = chargeEfficiency || 0.9;
    const effDischarge = dischargeEfficiency || 0.9;

    for (const row of hourlyRows) {
      if (row.isPast) continue;
      const powerMw = row.programValue ?? 0;

      if (powerMw > 0) {
        const energyOut = powerMw / effDischarge;
        currentSocMwh -= energyOut;
      } else if (powerMw < 0) {
        const energyIn = Math.abs(powerMw) * effCharge;
        currentSocMwh += energyIn;
      }

      currentSocMwh = Math.max(0, Math.min(batteryCapacityMwh, currentSocMwh));
      const ts = new Date(`${row.dateKey}T${pad2(row.hour)}:00:00`).getTime();
      projection.push({ timestamp: ts, value: Math.round(currentSocMwh * 100) / 100 });
    }
    return projection;
  }, [hourlyRows, techParams, monitoringData?.batterySoc]);

  // ------- Custom range selection state (before column defs, used by cellClassRules) -------
  const gridRef = useRef<AgGridReact<ProgramGridRow>>(null);
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const hasScrolledToNow = useRef(false);
  const shiftHeld = useRef(false);

  const EDITABLE_FIELDS: (keyof ProgramGridRow)[] = ['scheduleBap', 'program'];
  const [rangeAnchor, setRangeAnchor] = useState<{ rowIndex: number; colField: string } | null>(null);
  const [rangeFocus, setRangeFocus] = useState<{ rowIndex: number; colField: string } | null>(null);

  const rangeRect = useMemo(() => {
    if (!rangeAnchor || !rangeFocus) return null;
    const r1 = Math.min(rangeAnchor.rowIndex, rangeFocus.rowIndex);
    const r2 = Math.max(rangeAnchor.rowIndex, rangeFocus.rowIndex);
    const c1 = Math.min(EDITABLE_FIELDS.indexOf(rangeAnchor.colField as any), EDITABLE_FIELDS.indexOf(rangeFocus.colField as any));
    const c2 = Math.max(EDITABLE_FIELDS.indexOf(rangeAnchor.colField as any), EDITABLE_FIELDS.indexOf(rangeFocus.colField as any));
    if (c1 < 0 || c2 < 0) return null;
    return { r1, r2, cols: EDITABLE_FIELDS.slice(c1, c2 + 1) };
  }, [rangeAnchor, rangeFocus]);

  // Refresh cells when range changes to update highlight
  useEffect(() => {
    if (!gridRef.current?.api) return;
    gridRef.current.api.refreshCells({ force: true });
  }, [rangeRect]);

  const isInRange = useCallback((rowIndex: number, field: string): boolean => {
    if (!rangeRect) return false;
    return rowIndex >= rangeRect.r1 && rowIndex <= rangeRect.r2 && rangeRect.cols.includes(field as any);
  }, [rangeRect]);

  // ------- AG Grid column definitions -------
  const columnDefs = useMemo((): ColDef<ProgramGridRow>[] => {
    const timeDef: ColDef<ProgramGridRow> = {
      field: 'timeLabel',
      headerName: t('batteryProgram.time'),
      pinned: 'left',
      width: 155,
      editable: false,
      cellRenderer: (params: any) => {
        const row = params.data as ProgramGridRow | undefined;
        if (!row) return null;
        if (row.type === 'hour') {
          const arrow = row.expanded ? '▾' : '▸';
          return (
            <>
              <span className="hour-expand-toggle">{arrow}</span>
              {row.isNow && <span className="hour-now-dot" />}
              {' '}<strong>{row.timeLabel}</strong>
            </>
          );
        }
        // Quarter sub-row — indented
        return <span className="quarter-indent">{row.timeLabel}</span>;
      },
      onCellClicked: (params) => {
        const row = params.data;
        if (row?.type === 'hour') {
          toggleExpand(`${row.dateKey}-${row.hourGroup}`);
        }
      },
      cellClass: (params) => {
        if (!params.data) return '';
        const cls: string[] = [];
        if (params.data.type === 'hour') cls.push('hour-row-time');
        if (params.data.isNow) cls.push('font-semibold');
        if (params.data.isPast) cls.push('cell-idle');
        return cls.join(' ');
      },
    };

    const powerCellRenderer = (params: any) => {
      const row = params.data as ProgramGridRow | undefined;
      const v = params.value;
      const isAvg = row?.type === 'hour' && params.colDef.field === 'scheduleBap';
      const isQuarterProgram = row?.type === 'quarter' && params.colDef.field === 'program';
      if (v === null || v === undefined) {
        return <span style={{ opacity: 0.25, fontStyle: 'italic' }}>null</span>;
      }
      if (v === 0) {
        if (isAvg) return <span style={{ opacity: 0.3 }}>avg 0 MW</span>;
        if (isQuarterProgram) return <span className="quarter-readonly">0 MW</span>;
        return <span style={{ opacity: 0.4 }}>0 MW</span>;
      }
      const icon = v < 0
        ? <span className="bap-icon bap-icon-charge">⚡▼</span>
        : <span className="bap-icon bap-icon-discharge">▲</span>;
      if (isAvg) return <>{icon} <span style={{ opacity: 0.5 }}>avg {v} MW</span></>;
      if (isQuarterProgram) return <span className="quarter-readonly">{icon} {v} MW</span>;
      return <>{icon} {v} MW</>;
    };

    const powerTooltip = (params: any) => {
      const v = params.value ?? 0;
      const row = params.data as ProgramGridRow | undefined;
      if (row?.type === 'hour' && params.colDef.field === 'scheduleBap') {
        if (v === 0) return 'Average BAP: Idle';
        return v < 0 ? `Average Charge: ${v} MW (expand to edit quarters)` : `Average Discharge: +${v} MW (expand to edit quarters)`;
      }
      if (v === 0) return 'Idle';
      return v < 0 ? `Charge: ${v} MW` : `Discharge: +${v} MW`;
    };

    // scheduleBap uses powerCellRenderer directly — popup opens on hover
    const scheduleBapCellRenderer = powerCellRenderer;

    const scheduleDef: ColDef<ProgramGridRow> = {
      field: 'scheduleBap',
      headerName: t('batteryProgram.scheduleBapMw'),
      width: 170,
      // Only quarter rows are editable for schedule BAP (when allowed by profile setting)
      editable: (params) => (profile?.scheduleBapEditable ?? true) && params.data?.type === 'quarter' && !params.data?.isPast && (params.data?.scheduleIndex ?? -1) >= 0,
      cellClassRules: {
        'cell-charge': (params) => (params.value ?? 0) < 0,
        'cell-discharge': (params) => (params.value ?? 0) > 0,
        'cell-idle': (params) => (params.value ?? 0) === 0,
        'cell-range-selected': (params) => isInRange(params.node.rowIndex ?? -1, 'scheduleBap'),
      },
      cellRenderer: scheduleBapCellRenderer,
      tooltipValueGetter: powerTooltip,
      valueParser: (params) => {
        const cleaned = String(params.newValue).replace(',', '.').replace(/[^0-9.\-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? params.oldValue : num;
      },
    };

    const programDef: ColDef<ProgramGridRow> = {
      field: 'program',
      headerName: t('batteryProgram.programMw'),
      width: 170,
      // Only hour rows are editable for program
      editable: (params) => params.data?.type === 'hour' && !params.data?.isPast,
      cellClassRules: {
        'cell-charge': (params) => params.value != null && params.value < 0,
        'cell-discharge': (params) => params.value != null && params.value > 0,
        'cell-idle': (params) => params.value === 0,
        'cell-null': (params) => params.value === null || params.value === undefined,
        'cell-edited': (params) => !!params.data && programEdited.has(params.data.programKey),
        'cell-range-selected': (params) => isInRange(params.node.rowIndex ?? -1, 'program'),
      },
      cellRenderer: powerCellRenderer,
      tooltipValueGetter: powerTooltip,
      valueParser: (params) => {
        const cleaned = String(params.newValue).replace(',', '.').replace(/[^0-9.\-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? params.oldValue : num;
      },
    };

    const actualBapDef: ColDef<ProgramGridRow> = {
      field: 'actualBap',
      headerName: t('batteryProgram.actualBapMw'),
      width: 140,
      editable: false,
      cellRenderer: (params: any) => {
        const v = params.value as number | null;
        const row = params.data as ProgramGridRow | undefined;
        if (v === null || v === undefined) {
          return <span style={{ opacity: 0.2 }}>—</span>;
        }
        const icon = v < -0.01
          ? <span className="bap-icon bap-icon-charge">⚡▼</span>
          : v > 0.01
            ? <span className="bap-icon bap-icon-discharge">▲</span>
            : null;
        const text = `${v} MW`;
        const isQuarter = row?.type === 'quarter';
        return isQuarter
          ? <span className="quarter-readonly">{icon} {text}</span>
          : <>{icon} {text}</>;
      },
      cellClassRules: {
        'cell-charge': (params) => (params.value ?? 0) < -0.01,
        'cell-discharge': (params) => (params.value ?? 0) > 0.01,
        'cell-idle': (params) => params.value === null || (Math.abs(params.value ?? 0) <= 0.01),
      },
      tooltipValueGetter: (params) => {
        const v = params.value as number | null;
        if (v === null) return t('common.waitingForData');
        if (Math.abs(v) <= 0.01) return 'Idle';
        return v < 0 ? `Actual Charge: ${v} MW` : `Actual Discharge: +${v} MW`;
      },
    };

    return [timeDef, scheduleDef, programDef, actualBapDef];
  }, [t, programEdited, isInRange]);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: false,
    filter: false,
    resizable: true,
    suppressMovable: true,
  }), []);

  // ------- AG Grid callbacks -------
  const getRowClass = useCallback((params: RowClassParams<ProgramGridRow>): string => {
    if (!params.data) return '';
    const classes: string[] = [];
    if (params.data.type === 'hour') classes.push('ag-row-hour');
    if (params.data.type === 'quarter') classes.push('ag-row-quarter');
    if (params.data.isNow) classes.push('ag-row-now');
    if (params.data.isPast) classes.push('ag-row-past');
    if (params.data.type === 'hour' && params.data.dayIndex === 1 && params.data.hourGroup === 0) {
      classes.push('ag-row-day-sep');
    }
    return classes.join(' ');
  }, []);

  // Track cell focus for range selection
  const onCellFocused = useCallback((event: CellFocusedEvent) => {
    if (!event.column) return;
    const colField = typeof event.column === 'string' ? event.column : event.column.getColId();
    const rowIndex = event.rowIndex ?? -1;
    if (rowIndex < 0) return;

    // If not an editable field, just clear range
    if (!EDITABLE_FIELDS.includes(colField as any)) {
      setRangeAnchor(null);
      setRangeFocus(null);
      return;
    }

    // Use a small delay to check if Shift is held (we track it via keydown/keyup)
    const pos = { rowIndex, colField };
    if (shiftHeld.current) {
      // Extend range from anchor
      setRangeFocus(pos);
    } else {
      // New anchor
      setRangeAnchor(pos);
      setRangeFocus(pos);
    }
  }, []);

  // Track Shift key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeld.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  const onGridReady = useCallback(() => {
    setTimeout(() => {
      if (hasScrolledToNow.current || !gridRef.current?.api) return;
      const api = gridRef.current.api;
      let nowIdx = -1;
      api.forEachNode((node) => {
        if (node.data?.isNow && nowIdx === -1) {
          nowIdx = node.rowIndex ?? -1;
        }
      });
      if (nowIdx >= 0) {
        api.ensureIndexVisible(nowIdx, 'middle');
        hasScrolledToNow.current = true;
      }
    }, 200);
  }, []);

  // ------- Hover-based revision popup on scheduleBap column -------
  const onCellMouseOver = useCallback((event: any) => {
    const col = event.column?.getColId?.() ?? event.colDef?.field;
    if (col !== 'scheduleBap') return;
    const row = event.data as ProgramGridRow | undefined;
    if (!row?.utcDeliveryStart || !row?.utcDeliveryEnd) return;
    if (!selectedBess) return;

    // Clear any pending timer
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

    const cellEl = event.event?.target as HTMLElement | undefined;
    if (!cellEl) return;

    hoverTimerRef.current = setTimeout(() => {
      const rect = cellEl.getBoundingClientRect();
      setRevisionPopup({
        plantId: selectedBess.gcpId,
        deliveryStart: row.utcDeliveryStart!,
        deliveryEnd: row.utcDeliveryEnd!,
        anchorRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      });
    }, 400);
  }, [selectedBess]);

  const onCellMouseOut = useCallback((event: any) => {
    const col = event.column?.getColId?.() ?? event.colDef?.field;
    if (col !== 'scheduleBap') return;
    // Cancel pending open timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Start delayed close — popup's onMouseEnter will cancel it
    hoverTimerRef.current = setTimeout(() => {
      setRevisionPopup(null);
    }, 400);
  }, []);

  // ------- Apply a value to a single cell (updates state) -------
  const applyCellValue = useCallback((rowIndex: number, field: string, value: number) => {
    const api = gridRef.current?.api;
    if (!api) return;
    const rowNode = api.getDisplayedRowAtIndex(rowIndex);
    if (!rowNode?.data) return;
    const row = rowNode.data;

    if (row.isPast) return; // past slots locked

    if (field === 'scheduleBap') {
      const idx = row.scheduleIndex;
      if (idx >= 0) {
        setEditedScheduleRows(prev => {
          const updated = [...prev];
          if (updated[idx]) {
            updated[idx] = { ...updated[idx], Battery_Active_Power_MW: value };
          }
          return updated;
        });
        setScheduleDirty(true);
      }
    } else if (field === 'program') {
      const key = row.programKey;
      setProgramValues(prev => ({ ...prev, [key]: value }));
      setProgramEdited(prev => new Set(prev).add(key));
    }
  }, []);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent<ProgramGridRow>) => {
    if (!event.data) return;

    if (event.colDef.field === 'scheduleBap') {
      const idx = event.data.scheduleIndex;
      if (idx >= 0) {
        setEditedScheduleRows(prev => {
          const updated = [...prev];
          if (updated[idx]) {
            updated[idx] = { ...updated[idx], Battery_Active_Power_MW: event.newValue };
          }
          return updated;
        });
        setScheduleDirty(true);
      }
    } else if (event.colDef.field === 'program') {
      const key = event.data.programKey;
      setProgramValues(prev => ({ ...prev, [key]: event.newValue }));
      setProgramEdited(prev => new Set(prev).add(key));
    }
  }, []);

  // ------- Custom clipboard paste handler -------
  // AG Grid Community v35 doesn't include clipboard module,
  // so we handle paste via DOM event — fills from focused cell or selected range
  useEffect(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return;

    const handlePaste = (e: ClipboardEvent) => {
      const api = gridRef.current?.api;
      if (!api) return;

      // Don't intercept if user is editing a cell (let the editor handle it)
      if (api.getEditingCells().length > 0) return;

      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();

      // Parse TSV/CSV from Excel (rows separated by newlines, columns by tab)
      const rows = text.trim().split(/\r?\n/).map(line =>
        line.split('\t').map(cell => {
          const cleaned = cell.trim().replace(',', '.').replace(/[^0-9.\-]/g, '');
          return parseFloat(cleaned);
        })
      );

      if (rows.length === 0) return;

      // Determine paste target: range if selected, else from focused cell
      let startRow: number;
      let startCols: string[];

      if (rangeRect && rangeRect.r2 > rangeRect.r1) {
        // Paste into the selected range
        startRow = rangeRect.r1;
        startCols = [...rangeRect.cols];
      } else if (rangeFocus) {
        startRow = rangeFocus.rowIndex;
        startCols = [rangeFocus.colField];
        // If pasted data has multiple columns, extend to adjacent editable columns
        if (rows[0].length > 1) {
          const startColIdx = EDITABLE_FIELDS.indexOf(rangeFocus.colField as any);
          if (startColIdx >= 0) {
            startCols = EDITABLE_FIELDS.slice(startColIdx, startColIdx + rows[0].length);
          }
        }
      } else {
        return; // No focus, can't paste
      }

      let pastedCount = 0;
      for (let r = 0; r < rows.length; r++) {
        const targetRowIdx = startRow + r;
        for (let c = 0; c < startCols.length && c < rows[r].length; c++) {
          const val = rows[r][c];
          if (!isNaN(val)) {
            applyCellValue(targetRowIdx, startCols[c], val);
            pastedCount++;
          }
        }
      }

      if (pastedCount > 0) {
        // Extend range to cover pasted area
        const endRow = startRow + rows.length - 1;
        const endColField = startCols[Math.min(startCols.length - 1, rows[0].length - 1)];
        setRangeAnchor({ rowIndex: startRow, colField: startCols[0] });
        setRangeFocus({ rowIndex: endRow, colField: endColField });
      }
    };

    wrapper.addEventListener('paste', handlePaste);
    return () => wrapper.removeEventListener('paste', handlePaste);
  }, [rangeRect, rangeFocus, applyCellValue]);

  // ------- Delete key: clear selected range -------
  useEffect(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!rangeRect) return;
      const api = gridRef.current?.api;
      if (!api || api.getEditingCells().length > 0) return;

      e.preventDefault();
      for (let r = rangeRect.r1; r <= rangeRect.r2; r++) {
        for (const col of rangeRect.cols) {
          applyCellValue(r, col, 0);
        }
      }
    };

    wrapper.addEventListener('keydown', handleKeyDown);
    return () => wrapper.removeEventListener('keydown', handleKeyDown);
  }, [rangeRect, applyCellValue]);

  // ------- Submit Program -------
  // Per-day: if day has nulls → send full 24h (null→0); if no nulls → send only edited hours
  const handleSubmitProgram = useCallback(async () => {
    if (!selectedBess || !companyId) return;
    const providerName = selectedBess.bessComponent.forecastPreference?.sourceName;
    if (!providerName) { toast.error(t('batteryProgram.fetchFailed')); return; }
    const unitNo = selectedBess.bessComponent.portalPlantId;

    setSubmittingProgram(true);
    try {
      // Fetch fresh portal values for one day
      // Returns { selected: null-preserving values, existing: providerPrediction values (0 = exists) }
      const fetchFreshDay = async (dateKey: string): Promise<{
        selected: Record<number, number | null>;
        existing: Record<number, number | null>;
      }> => {
        const selected: Record<number, number | null> = {};
        const existing: Record<number, number | null> = {};
        const dayStr = toDDMMYYYY(dateKey);
        const parseHour = (raw: string) => {
          const hasTz = raw.endsWith('Z') || raw.includes('+');
          return hasTz ? new Date(raw).getHours() : parseInt(raw.slice(11, 13), 10);
        };
        try {
          const res = await forecastApi.getValues({
            companyId, powerPlantId: unitNo, provider: providerName,
            startDate: dayStr, endDate: dayStr,
            minute: 0, hour: '12:30',
            columnId: [6, 7, 10, 1, 2, 3, 4, 11, 12, 13, 14],
          });
          if (res && !res.isError && res.Questions) {
            // selectedProviderPrediction preserves null (truly empty hours)
            const selectedPreds = extractPredictions(res.Questions);
            for (const p of selectedPreds) {
              if (!p.PredictionDate) continue;
              selected[parseHour(p.PredictionDate)] = p.PredictionValue ?? null;
            }
            // providerPrediction shows 0 for submitted hours (existing predictions)
            const provArr = res.Questions.providerPrediction;
            if (Array.isArray(provArr)) {
              for (const p of provArr) {
                if (!p?.PredictionDate) continue;
                existing[parseHour(p.PredictionDate)] = p.PredictionValue ?? null;
              }
            }
            // If selectedProviderPrediction is ALL null but providerPrediction has data,
            // fall back to providerPrediction for selected — but only non-zero values
            // (providerPrediction masks null as 0, so 0 is ambiguous)
            const allSelectedNull = Object.keys(selected).length > 0 &&
              Object.values(selected).every(v => v === null);
            const existingHasData = Object.values(existing).some(v => v !== null && v !== undefined);
            if (allSelectedNull && existingHasData) {
              console.log(`[BatteryProgram] fetchFreshDay(${dateKey}): selectedProviderPrediction all null, using providerPrediction`);
              for (const h of Object.keys(existing)) {
                selected[Number(h)] = existing[Number(h)];
              }
            }
          }
        } catch { /* empty → treat all as null */ }
        return { selected, existing };
      };

      // Build delivery start/end for an hour
      const hourSlot = (dateKey: string, h: number) => {
        const startStr = `${dateKey}T${pad2(h)}:00:00`;
        const nextH = h + 1;
        let endStr: string;
        if (nextH < 24) {
          endStr = `${dateKey}T${pad2(nextH)}:00:00`;
        } else {
          const d = new Date(`${dateKey}T12:00:00`);
          d.setDate(d.getDate() + 1);
          endStr = `${dateKeyStr(d)}T00:00:00`;
        }
        return { startStr, endStr };
      };

      // Determine which days have user edits
      const editedDays = new Set<string>();
      for (const key of programEdited) {
        editedDays.add(key.replace(/-\d+$/, ''));
      }
      if (editedDays.size === 0) {
        editedDays.add(todayKey);
        editedDays.add(tomorrowKey);
      }

      const errors: string[] = [];
      let anySuccess = false;

      for (const dayKey of editedDays) {
        const { selected: freshHours, existing: existingHours } = await fetchFreshDay(dayKey);

        // Check if this day has any truly null hours (null in selectedProviderPrediction)
        const hasNulls = Array.from({ length: 24 }, (_, h) => freshHours[h]).some(v => v === null || v === undefined);

        let predictions: ForecastSubmissionPrediction[];

        if (hasNulls) {
          // Day has nulls → send only: truly-null hours (as 0) + user-edited hours
          // Skip hours that already exist in providerPrediction (to avoid "Predictions already exist")
          predictions = [];
          for (let h = 0; h < 24; h++) {
            const key = `${dayKey}-${h}`;
            const isEdited = programEdited.has(key);
            const isNull = freshHours[h] === null || freshHours[h] === undefined;
            const alreadyExists = existingHours[h] !== null && existingHours[h] !== undefined;

            // Send if: user edited this hour, OR hour is truly null (needs to be filled)
            // But skip non-edited hours that already have a value in portal
            if (isEdited || (isNull && !alreadyExists)) {
              const { startStr, endStr } = hourSlot(dayKey, h);
              const value = isEdited ? (programValues[key] ?? 0) : 0;
              predictions.push({ deliveryStart: startStr, deliveryStartOffset: 180, deliveryEnd: endStr, deliveryEndOffset: 180, value });
            }
          }
          // Portal requires full day if ANY hour is null — if we can't fill all nulls, send full 24h
          const nullCount = Array.from({ length: 24 }, (_, h) => freshHours[h]).filter(v => v === null || v === undefined).length;
          const existCount = Object.keys(existingHours).length;
          if (nullCount > 0 && existCount + predictions.length < 24) {
            // Not enough to cover full day; send all 24 hours
            predictions = Array.from({ length: 24 }, (_, h) => {
              const key = `${dayKey}-${h}`;
              const { startStr, endStr } = hourSlot(dayKey, h);
              const value = programEdited.has(key)
                ? (programValues[key] ?? 0)
                : (freshHours[h] ?? 0);
              return { deliveryStart: startStr, deliveryStartOffset: 180, deliveryEnd: endStr, deliveryEndOffset: 180, value };
            });
            console.log(`[BatteryProgram] ${dayKey}: has nulls, sending full day (24h) — can't fill partially`);
          } else {
            console.log(`[BatteryProgram] ${dayKey}: has nulls → sending ${predictions.length} hour(s) (null+edited only, skipping ${24 - predictions.length} existing)`);
          }
          if (predictions.length === 0) continue; // nothing to send
        } else {
          // No nulls → send only user-edited hours
          const editedHoursForDay = [...programEdited]
            .filter(k => k.startsWith(dayKey))
            .map(k => parseInt(k.split('-').pop()!, 10));

          if (editedHoursForDay.length === 0) continue; // nothing to send for this day

          predictions = editedHoursForDay.map(h => {
            const key = `${dayKey}-${h}`;
            const { startStr, endStr } = hourSlot(dayKey, h);
            return {
              deliveryStart: startStr, deliveryStartOffset: 180,
              deliveryEnd: endStr, deliveryEndOffset: 180,
              value: programValues[key] ?? 0,
            };
          });
          console.log(`[BatteryProgram] ${dayKey}: no nulls → sending ${predictions.length} edited hour(s)`);
        }

        console.log(`[BatteryProgram] ${dayKey} predictions:`, predictions.map(p => `${p.deliveryStart.slice(11,16)}=${p.value}`).join(', '));

        const result = await forecastApi.submitForecast({
          providerName, measureUnit: 1,
          description: `Battery Program Update (${dayKey})`,
          forecasts: [{ unitNo, predictions }],
        });
        console.log(`[BatteryProgram] ${dayKey} result:`, result);

        if (!result.success) {
          errors.push(`${dayKey}: ${result.message || JSON.stringify(result.data)}`);
        } else {
          anySuccess = true;
        }
      }

      if (errors.length > 0) {
        toast.error(`${t('batteryProgram.submitFailed')}: ${errors.join(' | ')}`, { duration: 10000 });
      }
      if (anySuccess) {
        toast.success(t('batteryProgram.submitSuccess'));
        setProgramEdited(new Set());
        setTimeout(() => fetchProgram(), 3000);
      }
    } catch (err: any) {
      console.error('[BatteryProgram] Submit error:', err.response?.data || err.message);
      toast.error(err.response?.data?.message || t('batteryProgram.submitFailed'), { duration: 8000 });
    } finally { setSubmittingProgram(false); }
  }, [selectedBess, companyId, todayKey, tomorrowKey, programValues, programEdited, t, fetchProgram]);

  // ------- Save Schedule -------
  const handleSaveSchedule = useCallback(async () => {
    if (!selectedBess) return;
    const plantId = selectedBess.gcpId;
    const header = scheduleTodayHeader.length > 0 ? scheduleTodayHeader : [...SCHEDULE_CSV_COLUMNS];

    setSavingSchedule(true);
    try {
      const todayRows = editedScheduleRows.filter(r => r.Delivery_Start.startsWith(todayKey));
      if (todayRows.length > 0) {
        await scheduleApi.saveSchedule(plantId, header, todayRows);
      }
      const tomorrowRows = editedScheduleRows.filter(r => r.Delivery_Start.startsWith(tomorrowKey));
      if (tomorrowRows.length > 0) {
        await scheduleApi.saveSchedule(plantId, header, tomorrowRows);
      }
      setScheduleDirty(false);
      toast.success(t('batteryProgram.scheduleSaved'));
      fetchScheduleToday();
      fetchScheduleTomorrow();
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('common.saveFailed'));
    } finally { setSavingSchedule(false); }
  }, [selectedBess, editedScheduleRows, scheduleTodayHeader, todayKey, tomorrowKey, fetchScheduleToday, fetchScheduleTomorrow, t]);

  // ------- Chart -------
  const chartOption = useMemo<EChartsOption>(() => {
    const nowTs = new Date().getTime();
    const tomorrowTs = new Date(`${tomorrowKey}T00:00:00`).getTime();

    const capacityMwh = techParams?.battery?.batteryCapacityMwh ?? 10;
    const maxDischargeMw = techParams?.battery?.maxDischargePowerMw ?? 5;
    const maxChargeMw = techParams?.battery?.maxChargePowerMw ?? 5;
    const maxPowerMw = Math.max(maxDischargeMw, maxChargeMw, 1);

    const xMin = new Date(`${todayKey}T00:00:00`).getTime();
    const dayAfterTomorrow = new Date(`${tomorrowKey}T12:00:00`);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
    const xMax = new Date(`${dateKeyStr(dayAfterTomorrow)}T00:00:00`).getTime();

    const scheduleBapData = editedScheduleRows.map(r => [
      new Date(r.Delivery_Start).getTime(),
      Number(r.Battery_Active_Power_MW) || 0,
    ]);

    const programData: [number, number][] = hourlyRows.map(row => [
      new Date(`${row.dateKey}T${pad2(row.hour)}:00:00`).getTime(),
      row.programValue ?? 0,
    ]);

    const bapData = (monitoringData?.batteryActivePower ?? [])
      .filter(p => p.timestamp <= nowTs)
      .map(p => [p.timestamp, p.value]);

    const socData = (monitoringData?.batterySoc ?? [])
      .filter(p => p.timestamp <= nowTs)
      .map(p => [p.timestamp, p.value]);

    const socProjData = socProjection.map(p => [p.timestamp, p.value]);

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: '#e0e0e0' },
      grid: { top: 60, right: 70, bottom: 40, left: 65, containLabel: false },
      legend: {
        top: 6, left: 'center',
        textStyle: { color: '#ccc', fontSize: 11 },
        data: [
          t('batteryProgram.scheduleBAP'),
          t('batteryProgram.programOptBESS'),
          t('batteryProgram.batteryPower'),
          t('batteryProgram.soc'),
          t('batteryProgram.socProjection'),
        ],
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
      yAxis: [
        {
          type: 'value',
          name: 'MW',
          nameTextStyle: { color: '#999', fontSize: 10 },
          min: -maxPowerMw,
          max: maxPowerMw,
          axisLine: { lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#e0e0e0', fontSize: 10 },
          splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        },
        {
          type: 'value',
          name: 'SoC (MWh)',
          nameTextStyle: { color: '#999', fontSize: 10 },
          min: 0,
          max: capacityMwh,
          axisLine: { lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#e0e0e0', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: t('batteryProgram.scheduleBAP'),
          type: 'line',
          step: 'middle',
          data: scheduleBapData,
          lineStyle: { color: '#f87171', width: 2 },
          itemStyle: { color: '#f87171' },
          showSymbol: false,
          z: 3,
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              {
                xAxis: tomorrowTs,
                lineStyle: { color: 'rgba(255,255,255,0.3)', width: 2, type: 'dashed' as const },
                label: { show: true, formatter: t('batteryProgram.tomorrow'), color: '#999', fontSize: 10, position: 'insideStartTop' as const },
              },
              {
                xAxis: nowTs,
                lineStyle: { color: '#63b3ed', width: 2, type: 'solid' as const },
                label: { show: true, formatter: 'NOW', color: '#63b3ed', fontSize: 10, position: 'insideStartTop' as const },
              },
            ],
          },
        },
        {
          name: t('batteryProgram.programOptBESS'),
          type: 'line',
          step: 'middle',
          data: programData,
          lineStyle: { color: '#38b2ac', width: 2 },
          itemStyle: { color: '#38b2ac' },
          showSymbol: false,
          z: 3,
        },
        {
          name: t('batteryProgram.batteryPower'),
          type: 'line',
          data: bapData,
          lineStyle: { color: '#f6ad55', width: 2 },
          itemStyle: { color: '#f6ad55' },
          showSymbol: false,
          z: 4,
        },
        {
          name: t('batteryProgram.soc'),
          type: 'line',
          yAxisIndex: 1,
          data: socData,
          lineStyle: { color: '#63b3ed', width: 2 },
          itemStyle: { color: '#63b3ed' },
          showSymbol: false,
          z: 2,
        },
        {
          name: t('batteryProgram.socProjection'),
          type: 'line',
          yAxisIndex: 1,
          data: socProjData,
          lineStyle: { color: '#63b3ed', width: 2, type: 'dashed' },
          itemStyle: { color: '#63b3ed' },
          showSymbol: false,
          z: 2,
        },
      ],
    };
  }, [editedScheduleRows, hourlyRows, monitoringData, socProjection, tomorrowKey, techParams, t, todayKey]);

  // ------- Guards -------
  if (!mapping) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryProgram.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('common.configureMapping')}</p>
        </div>
      </div>
    );
  }
  if (bessList.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryProgram.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('batteryProgram.noBess')}</p>
        </div>
      </div>
    );
  }

  // ------- Render -------
  return (
    <div className="p-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">{t('batteryProgram.title')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-mono">{todayKey} — {tomorrowKey}</span>
          {scheduleLastFetched != null && scheduleLastFetched > 0 && (
            <span className="text-xs text-gray-400 font-mono">
              {t('schedule.lastUpdate')}: {(() => {
                const sec = Math.round((nowMs - scheduleLastFetched) / 1000);
                if (sec < 0) return '0sn';
                if (sec < 60) return `${sec}sn`;
                const min = Math.floor(sec / 60);
                return `${min}dk`;
              })()}
            </span>
          )}
          {fetchingProgram && <span className="text-xs text-primary-400 animate-pulse">{t('forecast.fetching')}</span>}
          {scheduleLoading && <span className="text-xs text-gray-400 animate-pulse">{t('common.loading')}</span>}
          <button
            onClick={handleRefreshAll}
            disabled={fetchingProgram || scheduleLoading}
            className="text-xs text-primary-400 hover:text-primary-300 disabled:text-gray-600 transition-colors"
          >
            &#8635; {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* BESS selector */}
      <div className="mb-4">
        <span className="text-xs text-gray-500 block mb-2">{t('schedule.batteries')}</span>
        <div className="flex flex-wrap gap-2">
          {bessList.map((bess, idx) => (
            <button
              key={bess.gcpId + '-' + bess.bessComponent.componentId}
              onClick={() => { setSelectedBessIdx(idx); setScheduleDirty(false); setProgramEdited(new Set()); }}
              className={`text-left px-4 py-2 rounded-lg border transition-colors ${
                idx === selectedBessIdx
                  ? 'bg-primary-600/20 border-primary-500 text-primary-300'
                  : 'bg-dark-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <div className="text-sm font-medium">{bess.bessComponent.displayName}</div>
              <div className="text-xs opacity-60">{bess.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Grid (left) + Chart (right) — same height */}
      <div className="flex gap-4" style={{ height: 'calc(100vh - 180px)', minHeight: 500 }}>
        {/* AG Grid — fixed width */}
        <div className="bg-dark-800 border border-gray-700 rounded-lg overflow-hidden flex flex-col" style={{ width: 660, minWidth: 660 }}>
          <div
            ref={gridWrapperRef}
            className="ag-theme-alpine-dark flex-1 min-h-0"
            tabIndex={0}
          >
            <AgGridReact<ProgramGridRow>
              ref={gridRef}
              modules={[AllCommunityModule]}
              rowData={gridRows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              getRowId={(params) => params.data.id}
              getRowClass={getRowClass}
              onGridReady={onGridReady}
              onCellValueChanged={onCellValueChanged}
              onCellFocused={onCellFocused}
              onCellMouseOver={onCellMouseOver}
              onCellMouseOut={onCellMouseOut}
              singleClickEdit={true}
              stopEditingWhenCellsLoseFocus={true}
              enterNavigatesVertically={true}
              enterNavigatesVerticallyAfterEdit={true}
              undoRedoCellEditing={true}
              undoRedoCellEditingLimit={20}
              animateRows={false}
              headerHeight={36}
              getRowHeight={(params) => params.data?.type === 'quarter' ? 26 : 32}
              tooltipShowDelay={300}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-dark-700 border-t border-gray-600">
            {(profile?.scheduleBapEditable ?? true) && (
              <button
                onClick={handleSaveSchedule}
                disabled={!scheduleDirty || savingSchedule}
                className="bg-rose-600 hover:bg-rose-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
              >
                {savingSchedule ? t('batteryProgram.savingSchedule') : t('batteryProgram.saveSchedule')}
              </button>
            )}
            <button
              onClick={handleSubmitProgram}
              disabled={submittingProgram}
              className="bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
            >
              {submittingProgram ? t('batteryProgram.submitting') : t('batteryProgram.submitProgram')}
            </button>
            <button
              onClick={async () => {
                if (!selectedBess) return;
                try {
                  await scheduleApi.exportVersionedHistory(selectedBess.gcpId, todayKey);
                } catch (err: any) {
                  console.error('[Export] error:', err);
                  toast.error(err.response?.data?.message || t('common.saveFailed'));
                }
              }}
              className="bg-gray-600 hover:bg-gray-500 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors ml-auto"
            >
              {t('batteryProgram.exportHistory')}
            </button>
            {scheduleDirty && (
              <span className="text-xs text-yellow-500">{t('common.unsavedChanges')}</span>
            )}
          </div>
        </div>

        {/* Chart — fills remaining width */}
        <div className="flex-1 min-w-0 bg-dark-800 border border-gray-700 rounded-lg p-2 relative">
          {/* Compact live battery overlay */}
          <LiveBatteryOverlay />
          <ReactECharts option={chartOption} notMerge style={{ height: '100%', width: '100%' }} />
        </div>
      </div>

      {/* Slot Revision Popup */}
      {revisionPopup && (
        <SlotRevisionPopup
          plantId={revisionPopup.plantId}
          deliveryStart={revisionPopup.deliveryStart}
          deliveryEnd={revisionPopup.deliveryEnd}
          anchorRect={revisionPopup.anchorRect}
          onClose={() => {
            if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
            setRevisionPopup(null);
          }}
          onPopupHover={(hovering) => {
            if (hovering) {
              // Mouse entered popup — cancel any pending close
              if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
            } else {
              // Mouse left popup — start close timer
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = setTimeout(() => setRevisionPopup(null), 300);
            }
          }}
        />
      )}
    </div>
  );
}
