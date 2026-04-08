import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';
import { monitoringApi } from '../../../api/monitoring.api';
import {
  getAllGcps,
  GridConnectionPoint,
  CompanyMapping,
} from '@smartpulse-intl/shared';
import type { RawMetricPoint, MetricDataPoint } from '@smartpulse-intl/shared';

// ── Colors ──
const COMPONENT_COLORS = ['#29B6F6', '#FFB300', '#00BFA5', '#5C6BC0', '#FF7043', '#66BB6A', '#AB47BC', '#EF5350'];
const TOTAL_COLOR = '#B0BEC5';
const SOC_COLOR = '#4CAF50';
const BAP_COLOR = '#29B6F6';

interface ComponentSeries {
  componentId: string;
  displayName: string;
  type: string;
  data: MetricDataPoint[];
}

export function LiveMonitoringWidget() {
  const { profile } = useProfile();
  const { t } = useLocale();
  const mapping = profile?.assetMapping ?? null;

  // All GCPs
  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);

  // Find company for a GCP
  const findCompany = useCallback((gcpId: number): CompanyMapping | undefined => {
    return mapping?.companies?.find(c =>
      c.gridConnectionPoints?.some(g => g.id === gcpId)
    );
  }, [mapping]);

  // Selected GCP
  const [selectedGcpId, setSelectedGcpId] = useState<number | null>(null);
  useEffect(() => {
    if (allGcps.length > 0 && selectedGcpId === null) {
      // Default to first GCP that has monitoring configured
      const withMonitoring = allGcps.find(g =>
        g.components?.some(c => c.monitoring?.metrics?.length)
      );
      setSelectedGcpId(withMonitoring?.id ?? allGcps[0].id);
    }
  }, [allGcps, selectedGcpId]);

  const selectedGcp = useMemo(
    () => allGcps.find(g => g.id === selectedGcpId) ?? null,
    [allGcps, selectedGcpId]
  );

  // Data state
  const [rawMetrics, setRawMetrics] = useState<RawMetricPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!selectedGcp) return;
    const company = findCompany(selectedGcp.id);
    if (!company) return;

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    try {
      const data = await monitoringApi.getLiveMetricsV2(
        selectedGcp.id,
        company.companyId,
        dayStart.toISOString(),
        now.toISOString(),
      );
      setRawMetrics(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch metrics');
    }
  }, [selectedGcp, findCompany]);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    setRawMetrics([]);
    fetchData().finally(() => setLoading(false));

    // Poll every 30s
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(fetchData, 30_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchData]);

  // Transform raw metrics into component series
  const { componentSeries, totalSeries, socSeries, bapSeries } = useMemo(() => {
    const compMap = new Map<string, MetricDataPoint[]>();
    const soc: MetricDataPoint[] = [];
    const bap: MetricDataPoint[] = [];

    for (const m of rawMetrics) {
      const pt: MetricDataPoint = { timestamp: m.timestamp, value: m.value };
      if (m.type === 'SOC') {
        soc.push(pt);
      } else if (m.type === 'BAP') {
        bap.push(pt);
      } else if (m.type.includes('POWER')) {
        // Match to component by nodeidentity
        const matchedComp = selectedGcp?.components?.find(c =>
          c.monitoring?.metrics?.some(x => {
            if (!('nodeidentity' in x)) return false;
            const tagUp = x.tag.toUpperCase();
            return m.type === `${tagUp}_${x.nodeidentity}` || tagUp === m.type;
          })
        );
        const key = matchedComp?.componentId || 'unknown';
        if (!compMap.has(key)) compMap.set(key, []);
        compMap.get(key)!.push(pt);
      }
    }

    const series: ComponentSeries[] = [];
    compMap.forEach((pts, compId) => {
      const comp = selectedGcp?.components?.find(c => c.componentId === compId);
      series.push({
        componentId: compId,
        displayName: comp?.displayName || compId,
        type: comp?.type || 'OTHER',
        data: pts.sort((a, b) => a.timestamp - b.timestamp),
      });
    });

    // Also add BAP as a component series (BESS power)
    if (bap.length > 0) {
      const bessComp = selectedGcp?.components?.find(c => c.type === 'BESS');
      series.push({
        componentId: bessComp?.componentId || 'bap',
        displayName: bessComp?.displayName || 'Battery (BAP)',
        type: 'BESS',
        data: bap.sort((a, b) => a.timestamp - b.timestamp),
      });
    }

    // Compute total = sum of all component power at each timestamp
    const tsMap = new Map<number, number>();
    for (const s of series) {
      for (const pt of s.data) {
        tsMap.set(pt.timestamp, (tsMap.get(pt.timestamp) || 0) + pt.value);
      }
    }
    const total = Array.from(tsMap.entries())
      .map(([timestamp, value]) => ({ timestamp, value }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      componentSeries: series,
      totalSeries: total,
      socSeries: soc.sort((a, b) => a.timestamp - b.timestamp),
      bapSeries: bap.sort((a, b) => a.timestamp - b.timestamp),
    };
  }, [rawMetrics, selectedGcp]);

  // ECharts option
  const chartOption = useMemo<EChartsOption>(() => {
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);

    const series: any[] = [];

    // Component series
    componentSeries.forEach((cs, i) => {
      series.push({
        name: cs.displayName,
        type: 'line',
        smooth: 0.2,
        data: cs.data.map(p => [p.timestamp, p.value]),
        color: COMPONENT_COLORS[i % COMPONENT_COLORS.length],
        lineStyle: { width: 2 },
        showSymbol: false,
        yAxisIndex: 0,
      });
    });

    // Total (GCP aggregate)
    if (totalSeries.length > 0 && componentSeries.length > 1) {
      series.push({
        name: `${selectedGcp?.name || 'GCP'} Total`,
        type: 'line',
        smooth: 0.2,
        data: totalSeries.map(p => [p.timestamp, p.value]),
        color: TOTAL_COLOR,
        lineStyle: { width: 2.5, type: 'dashed' as const },
        showSymbol: false,
        yAxisIndex: 0,
      });
    }

    // SoC bars
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

    // "Now" indicator on first power series
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
      },
      xAxis: {
        type: 'time',
        min: dayStart.getTime(),
        max: dayEnd.getTime(),
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
  }, [componentSeries, totalSeries, socSeries, selectedGcp]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* GCP Selector */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        flexShrink: 0,
      }}>
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
            maxWidth: 260,
          }}
        >
          {allGcps.map(gcp => (
            <option key={gcp.id} value={gcp.id}>
              {gcp.name} ({gcp.components?.length || 0} comp)
            </option>
          ))}
        </select>
        {loading && (
          <span style={{ fontSize: 10, color: '#a0a0b0' }}>Loading...</span>
        )}
        {rawMetrics.length > 0 && (
          <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>
            {rawMetrics.length.toLocaleString()} pts
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 10px', color: '#EF5350', fontSize: 11 }}>
          {error}
        </div>
      )}

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {rawMetrics.length === 0 && !loading ? (
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
          />
        )}
      </div>
    </div>
  );
}
