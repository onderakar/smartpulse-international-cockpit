import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';
import { useMonitoring } from '../../../context/MonitoringContext';
import {
  getAllGcps,
} from '@smartpulse-intl/shared';
import type { MetricDataPoint, AssetMapping } from '@smartpulse-intl/shared';
import { DateNav } from '../../common/DateNav';
import { aggregateByInterval } from '../../../utils/aggregateMetrics';
import { timeSeriesApi, type TimeSeriesPoint } from '../../../api/timeSeries.api';

const INTERVAL_OPTIONS = [
  { label: 'Raw', value: 0 },
  { label: '5m', value: 300_000 },
  { label: '15m', value: 900_000 },
] as const;

const COMPONENT_COLORS = ['#29B6F6', '#FFB300', '#00BFA5', '#5C6BC0', '#FF7043', '#66BB6A', '#AB47BC', '#EF5350'];

/** Fixed colors by component type */
const TYPE_COLORS: Record<string, string> = {
  BESS: '#29B6F6',     // blue
  SOLAR: '#FF9800',    // orange
  WIND: '#4CAF50',     // green
  HYDRO: '#00BCD4',    // cyan
  THERMAL: '#FF5722',  // deep orange
  LOAD: '#9C27B0',     // purple
  CONSUMPTION: '#E91E63', // pink
  OTHER: '#78909C',    // grey
};
const TOTAL_COLOR = '#FFFFFF';
const IDM_Q_COLOR = '#26A69A'; // teal for quarter-hourly trades
const IDM_H_COLOR = '#7E57C2'; // purple for hourly trades

/** Find companyId that owns a given GCP */
function getCompanyIdForGcp(mapping: AssetMapping | null | undefined, gcpId: number): number | null {
  if (!mapping?.companies) return null;
  for (const c of mapping.companies) {
    if (c.gridConnectionPoints?.some(g => g.id === gcpId)) return c.companyId;
  }
  return null;
}

interface ComponentSeries {
  componentId: string;
  displayName: string;
  type: string;
  data: MetricDataPoint[];
}

export function LiveMonitoringWidget() {
  const { profile } = useProfile();
  const { t } = useLocale();
  const { data, isLoading, error, selectedDate, setSelectedDate } = useMonitoring();
  const mapping = profile?.assetMapping ?? null;

  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);

  const [selectedGcpId, setSelectedGcpId] = useState<number | null>(null);
  const gcpTimezone = useMemo(() => {
    if (!mapping?.companies) return 'UTC';
    for (const co of mapping.companies) {
      const g = co.gridConnectionPoints?.find((g: any) => String(g.id) === String(selectedGcpId));
      if (g) return g.timezone || co.timezone || 'UTC';
    }
    return 'UTC';
  }, [mapping, selectedGcpId]);
  const [intervalMs, setIntervalMs] = useState(0);
  const legendSelectedRef = useRef<Record<string, boolean>>({});

  // IDM net position series (quarter-hourly and hourly)
  const [idmQ, setIdmQ] = useState<MetricDataPoint[]>([]);
  const [idmH, setIdmH] = useState<MetricDataPoint[]>([]);

  useEffect(() => {
    if (allGcps.length > 0 && selectedGcpId === null) {
      const withMonitoring = allGcps.find(g =>
        g.components?.some(c => c.monitoring?.metrics?.length)
      );
      setSelectedGcpId(withMonitoring?.id ?? allGcps[0].id);
    }
  }, [allGcps, selectedGcpId]);

  // Fetch IDM net position series for the selected GCP's company
  const companyId = useMemo(() => getCompanyIdForGcp(mapping, selectedGcpId ?? -1), [mapping, selectedGcpId]);

  useEffect(() => {
    if (companyId == null) { setIdmQ([]); setIdmH([]); return; }
    const today = new Date();
    const dateStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const dateEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();

    timeSeriesApi.getMultiSeries('COMPANY', String(companyId), ['idm_net_position_q', 'idm_net_position_h'], dateStart, dateEnd)
      .then(result => {
        const toMetric = (pts: TimeSeriesPoint[]): MetricDataPoint[] =>
          pts.map(p => ({ timestamp: new Date(p.deliveryStart).getTime(), value: p.value }))
            .sort((a, b) => a.timestamp - b.timestamp);
        setIdmQ(toMetric(result['idm_net_position_q'] || []));
        setIdmH(toMetric(result['idm_net_position_h'] || []));
      })
      .catch(() => { setIdmQ([]); setIdmH([]); });
  }, [companyId]);

  const selectedGcp = useMemo(
    () => allGcps.find(g => g.id === selectedGcpId) ?? null,
    [allGcps, selectedGcpId]
  );

  const { componentSeries, totalSeries, socSeries } = useMemo(() => {
    if (!data) return { componentSeries: [], totalSeries: [], socSeries: [] };

    const agg = (pts: MetricDataPoint[]) => aggregateByInterval(pts, intervalMs);

    const series: ComponentSeries[] = data.powerComponents.map(pc => ({
      componentId: pc.componentId,
      displayName: pc.displayName,
      type: pc.type,
      data: agg(pc.data),
    }));

    if (data.batteryActivePower.length > 0) {
      const bessComp = selectedGcp?.components?.find(c => c.type === 'BESS');
      series.push({
        componentId: bessComp?.componentId || 'bap',
        displayName: bessComp?.displayName || 'Battery (BAP)',
        type: 'BESS',
        data: agg(data.batteryActivePower),
      });
    }

    // Only sum timestamps where ALL components have data (avoid jagged total)
    const seriesCount = series.length;
    const tsCounts = new Map<number, number>();
    const tsSum = new Map<number, number>();
    for (const s of series) {
      for (const pt of s.data) {
        tsCounts.set(pt.timestamp, (tsCounts.get(pt.timestamp) || 0) + 1);
        tsSum.set(pt.timestamp, (tsSum.get(pt.timestamp) || 0) + pt.value);
      }
    }
    const total = Array.from(tsSum.entries())
      .filter(([ts]) => tsCounts.get(ts) === seriesCount)
      .map(([timestamp, value]) => ({ timestamp, value }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      componentSeries: series,
      totalSeries: total,
      socSeries: agg(data.batterySoc),
    };
  }, [data, selectedGcp, intervalMs]);

  const pointCount = useMemo(() => {
    if (!data) return 0;
    return data.batterySoc.length + data.batteryActivePower.length +
      data.powerComponents.reduce((sum, pc) => sum + pc.data.length, 0);
  }, [data]);

  const chartOption = useMemo<EChartsOption>(() => {
    const now = Date.now();
    const dateStr = selectedDate.toLocaleDateString('en-CA', { timeZone: gcpTimezone });
    const dayStartMs = new Date(`${dateStr}T00:00:00`).getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000 - 1;

    const series: any[] = [];

    componentSeries.forEach((cs, i) => {
      series.push({
        name: cs.displayName,
        type: 'line',
        smooth: 0.2,
        sampling: 'lttb',
        data: cs.data.map(p => [p.timestamp, p.value]),
        color: TYPE_COLORS[cs.type] || COMPONENT_COLORS[i % COMPONENT_COLORS.length],
        lineStyle: { width: 2 },
        showSymbol: false,
        yAxisIndex: 0,
      });
    });

    if (totalSeries.length > 0 && componentSeries.length > 1) {
      series.push({
        name: `${selectedGcp?.name || 'GCP'} Total`,
        type: 'line',
        smooth: 0.2,
        sampling: 'lttb',
        data: totalSeries.map(p => [p.timestamp, p.value]),
        color: TOTAL_COLOR,
        lineStyle: { width: 2.5 },
        showSymbol: false,
        yAxisIndex: 0,
      });
    }

    if (socSeries.length > 0) {
      series.push({
        name: 'SoC (MWh)',
        type: 'bar',
        data: socSeries.map(p => [p.timestamp, p.value]),
        yAxisIndex: 1,
        barWidth: '80%',
        itemStyle: {
          color: 'rgba(76, 175, 80, 0.2)',
          borderRadius: [1, 1, 0, 0],
        },
        silent: true,
        z: 0,
      });
    }

    // IDM net position — stacked bars (quarter-hourly + hourly)
    const idmBarWidth = 15 * 60 * 1000; // 15 min in ms
    if (idmQ.length > 0) {
      series.push({
        name: t('idmNetPositionQ'),
        type: 'bar',
        stack: 'idm',
        data: idmQ.map(p => [p.timestamp, p.value]),
        yAxisIndex: 0,
        barWidth: idmBarWidth,
        itemStyle: {
          color: IDM_Q_COLOR,
          opacity: 0.6,
          borderRadius: [0, 0, 0, 0],
        },
        z: 1,
      });
    }
    if (idmH.length > 0) {
      series.push({
        name: t('idmNetPositionH'),
        type: 'bar',
        stack: 'idm',
        data: idmH.map(p => [p.timestamp, p.value]),
        yAxisIndex: 0,
        barWidth: idmBarWidth,
        itemStyle: {
          color: IDM_H_COLOR,
          opacity: 0.6,
          borderRadius: [1, 1, 0, 0],
        },
        z: 1,
      });
    }

    if (series.length > 0 && !series[0].markLine) {
      series[0].markLine = {
        silent: true,
        symbol: 'none',
        animation: false,
        data: [{ xAxis: now }],
        lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.25)', width: 1 },
        label: { show: false },
      };
    }

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 58, right: 58, top: 16, bottom: 50, containLabel: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(255,255,255,0.2)' } },
        backgroundColor: 'rgba(20,20,40,0.92)',
        borderColor: 'rgba(255,255,255,0.12)',
        textStyle: { color: '#e0e0e0', fontSize: 11 },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const time = new Date(params[0].value[0]).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`;
          for (const p of params) {
            if (p.value[1] == null) continue;
            const val = typeof p.value[1] === 'number' ? p.value[1].toFixed(3) : p.value[1];
            const unit = p.seriesName?.includes('SoC') ? 'MWh' : 'MW';
            html += `<div>${p.marker} ${p.seriesName}: <b>${val}</b> ${unit}</div>`;
          }
          return html;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        textStyle: { color: '#a0a0b0', fontSize: 10 },
        icon: 'roundRect',
        itemWidth: 14,
        itemHeight: 3,
        selected: { ...legendSelectedRef.current },
      },
      xAxis: {
        type: 'time',
        min: dayStartMs,
        max: dayEndMs,
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: {
          color: '#a0a0b0',
          fontSize: 10,
          formatter: (val: number) => new Date(val).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          showMaxLabel: false,
        },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisTick: { lineStyle: { color: '#2a2a3e' } },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          name: 'MW',
          nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
          axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#a0a0b0', fontSize: 11 },
          splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        },
        {
          type: 'value',
          position: 'right',
          name: 'MWh',
          nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
          axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
          axisLabel: { color: '#a0a0b0', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'filter',
          bottom: 22,
          height: 18,
          textStyle: { color: '#a0a0b0' },
          borderColor: 'transparent',
          fillerColor: 'rgba(79, 195, 247, 0.2)',
          handleStyle: { color: '#a0a0b0' },
        },
      ],
      series,
    };
  }, [componentSeries, totalSeries, socSeries, selectedGcp, idmQ, idmH, t, selectedDate, gcpTimezone]);

  const onChartEvents = useMemo(() => ({
    legendselectchanged: (e: any) => {
      if (e.selected) {
        legendSelectedRef.current = { ...e.selected };
      }
    },
  }), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        flexShrink: 0,
      }}>
        <DateNav
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          timezone={gcpTimezone}
        />
        <div style={{ width: 1, height: 18, background: 'var(--color-border, rgba(255,255,255,0.15))' }} />
        <label style={{ fontSize: 11, color: 'var(--color-text-muted, #a0a0b0)', whiteSpace: 'nowrap' }}>
          GCP:
        </label>
        <select
          value={selectedGcpId ?? ''}
          onChange={e => setSelectedGcpId(Number(e.target.value))}
          style={{
            flex: 1,
            background: 'var(--color-surface, #1c1c35)',
            color: 'var(--color-text, #e0e0e0)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 12,
            outline: 'none',
            maxWidth: 220,
          }}
        >
          {allGcps.map(gcp => (
            <option key={gcp.id} value={gcp.id}>
              {gcp.name} ({gcp.components?.length || 0} comp)
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {INTERVAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setIntervalMs(opt.value)}
              style={{
                padding: '2px 7px',
                fontSize: 10,
                border: '1px solid',
                borderColor: intervalMs === opt.value ? 'var(--color-accent, #4fc3f7)' : 'var(--color-border, rgba(255,255,255,0.15))',
                borderRadius: 3,
                background: intervalMs === opt.value ? 'rgba(79, 195, 247, 0.15)' : 'transparent',
                color: intervalMs === opt.value ? 'var(--color-accent, #4fc3f7)' : 'var(--color-text-muted, #a0a0b0)',
                cursor: 'pointer',
                lineHeight: '16px',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {isLoading && (
          <span style={{ fontSize: 10, color: '#a0a0b0' }}>Loading...</span>
        )}
        {pointCount > 0 && (
          <span style={{ fontSize: 10, color: '#666' }}>
            {pointCount.toLocaleString()} pts
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 10px', color: '#EF5350', fontSize: 11 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        {pointCount === 0 && !isLoading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: 12,
          }}>
            {selectedGcp ? 'No monitoring data for this GCP' : 'Select a GCP'}
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ width: '100%', height: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
            onEvents={onChartEvents}
          />
        )}
      </div>
    </div>
  );
}
