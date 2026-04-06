import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ScheduleRow, CHART_COLORS } from '@smartpulse-intl/shared';
import { useLocale } from '../../context/LocaleContext';

interface ScheduleChartProps {
  savedRows: ScheduleRow[];
  editedRows: ScheduleRow[];
  isDirty: boolean;
  width?: number;
  height?: number;
}

type ChartDataPoint = [number, number];

/**
 * Convert a Delivery_Start ISO string (e.g. "2026-02-28T21:00:00.000Z") to a
 * fake-UTC ms timestamp for ECharts. The CSV stores real UTC (with Z suffix),
 * so "21:00Z" = midnight Turkey time. We parse with new Date() to get real UTC,
 * extract LOCAL time components (= plant time if browser matches), then express
 * those as Date.UTC so getUTCHours() returns the local hour.
 */
function toFakeUtcMs(dtStr: string): number | null {
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return null;
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
}

function rowsToChartData(
  rows: ScheduleRow[],
  field: 'Battery_Active_Power_MW' | 'Max_Generation_MW',
): ChartDataPoint[] {
  return rows
    .map((row): ChartDataPoint | null => {
      const ts = toFakeUtcMs(row.Delivery_Start);
      if (ts === null) return null;
      return [ts, Number(row[field]) || 0];
    })
    .filter((p): p is ChartDataPoint => p !== null)
    .sort((a, b) => a[0] - b[0]);
}

/** Compute day start/end as fake-UTC ms from the first row's local date */
function computeDayBoundsFromRows(rows: ScheduleRow[]): { start: number; end: number } | null {
  if (!rows.length) return null;
  const d = new Date(rows[0].Delivery_Start);
  if (isNaN(d.getTime())) return null;
  const start = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return { start, end: start + 24 * 3600 * 1000 };
}

export function ScheduleChart({
  savedRows,
  editedRows,
  isDirty,
  width = 600,
  height = 250,
}: ScheduleChartProps) {
  const { t } = useLocale();
  const option = useMemo<EChartsOption>(() => {
    const savedBapData = rowsToChartData(savedRows, 'Battery_Active_Power_MW');
    const savedMaxGenData = rowsToChartData(savedRows, 'Max_Generation_MW');
    const editedBapData = isDirty
      ? rowsToChartData(editedRows, 'Battery_Active_Power_MW')
      : [];
    const editedMaxGenData = isDirty
      ? rowsToChartData(editedRows, 'Max_Generation_MW')
      : [];

    const bounds = computeDayBoundsFromRows(savedRows.length ? savedRows : editedRows);

    const hourFormatter = (value: number) => {
      const d = new Date(value);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    };

    const series: EChartsOption['series'] = [
      {
        name: t('series.bapSaved'),
        type: 'line',
        step: 'middle',
        symbol: 'none',
        lineStyle: {
          color: CHART_COLORS.scheduleBap,
          width: 2,
          type: 'solid',
        },
        itemStyle: { color: CHART_COLORS.scheduleBap },
        data: savedBapData,
      },
      {
        name: t('series.bapEdited'),
        type: 'line',
        step: 'middle',
        symbol: 'none',
        lineStyle: {
          color: CHART_COLORS.scheduleBap,
          width: 2,
          type: 'dashed',
        },
        itemStyle: { color: CHART_COLORS.scheduleBap },
        data: editedBapData,
      },
      {
        name: t('series.maxGenSaved'),
        type: 'line',
        step: 'middle',
        symbol: 'none',
        lineStyle: {
          color: CHART_COLORS.scheduleMaxGen,
          width: 1,
          type: 'solid',
        },
        itemStyle: { color: CHART_COLORS.scheduleMaxGen },
        data: savedMaxGenData,
      },
      {
        name: t('series.maxGenEdited'),
        type: 'line',
        step: 'middle',
        symbol: 'none',
        lineStyle: {
          color: CHART_COLORS.scheduleMaxGen,
          width: 1,
          type: 'dashed',
        },
        itemStyle: { color: CHART_COLORS.scheduleMaxGen },
        data: editedMaxGenData,
      },
    ];

    return {
      useUTC: true,
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: '#e0e0e0' },
      grid: {
        top: 40,
        right: 16,
        bottom: 32,
        left: 48,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(255,255,255,0.2)' } },
        backgroundColor: 'rgba(30, 30, 50, 0.9)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        textStyle: { color: '#e0e0e0', fontSize: 12 },
      },
      legend: {
        show: true,
        top: 4,
        textStyle: { color: '#e0e0e0', fontSize: 10 },
      },
      xAxis: {
        type: 'time',
        min: bounds?.start,
        max: bounds?.end,
        interval: 3600 * 1000,
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisTick: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: {
          color: '#e0e0e0',
          fontSize: 10,
          formatter: hourFormatter,
          showMaxLabel: false,
        },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        minorTick: { show: true, splitNumber: 4 },
        minorSplitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.03)' } },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        axisTick: { lineStyle: { color: '#2a2a3e' } },
        axisLabel: { color: '#e0e0e0', fontSize: 10 },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      series,
    };
  }, [savedRows, editedRows, isDirty, t]);

  return (
    <div className="rounded-lg overflow-hidden">
      <ReactECharts
        option={option}
        notMerge={true}
        style={{ width, height }}
      />
    </div>
  );
}
