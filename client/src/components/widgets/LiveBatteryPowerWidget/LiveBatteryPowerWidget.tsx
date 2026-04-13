import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useMonitoring } from '../../../context/MonitoringContext';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';

const BAP_COLOR = '#29B6F6';  // blue
const SOC_COLOR = 'rgba(76, 175, 80, 0.35)';  // green translucent
const SOC_BORDER = '#4CAF50';

export function LiveBatteryPowerWidget() {
  const { data, liveSnapshot, isLoading } = useMonitoring();
  const { profile } = useProfile();
  const { t } = useLocale();

  const bapData = useMemo(() => {
    if (!data?.batteryActivePower) return [];
    return data.batteryActivePower.map(p => [p.timestamp, p.value]);
  }, [data]);

  const socData = useMemo(() => {
    if (!data?.batterySoc) return [];
    return data.batterySoc.map(p => [p.timestamp, p.value]);
  }, [data]);

  const chartOption = useMemo<EChartsOption>(() => ({
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 55, right: 55, top: 14, bottom: 36, containLabel: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20,20,40,0.92)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#e0e0e0', fontSize: 11 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || !params.length) return '';
        const time = new Date(params[0].value[0]).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`;
        for (const p of params) {
          if (p.value[1] == null) continue;
          const unit = p.seriesName?.includes('SoC') ? 'MWh' : 'MW';
          html += `<div>${p.marker} ${p.seriesName}: <b>${p.value[1].toFixed(3)}</b> ${unit}</div>`;
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
      axisLine: { lineStyle: { color: '#2a2a3e' } },
      axisLabel: { color: '#a0a0b0', fontSize: 10, formatter: (val: number) => new Date(val).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
      splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    yAxis: [
      {
        type: 'value', position: 'left', name: 'MW',
        nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
        axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
        axisLabel: { color: '#a0a0b0', fontSize: 11 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      {
        type: 'value', position: 'right', name: 'MWh',
        nameTextStyle: { color: '#a0a0b0', fontSize: 10 },
        axisLine: { show: true, lineStyle: { color: '#2a2a3e' } },
        axisLabel: { color: '#a0a0b0', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Battery Power (BAP)',
        type: 'line',
        step: 'end',
        data: bapData,
        color: BAP_COLOR,
        lineStyle: { width: 2 },
        showSymbol: false,
        yAxisIndex: 0,
      },
      {
        name: 'SoC (MWh)',
        type: 'bar',
        data: socData,
        yAxisIndex: 1,
        barWidth: '80%',
        itemStyle: { color: SOC_COLOR, borderColor: SOC_BORDER, borderWidth: 1, borderRadius: [1, 1, 0, 0] },
        silent: true,
        z: 0,
      },
    ],
  }), [bapData, socData]);

  const hasData = bapData.length > 0 || socData.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Live indicators */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: 0.5 }}>BAP</span>
          <span style={{
            fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: liveSnapshot.bapMW != null
              ? (liveSnapshot.bapMW > 0 ? '#4CAF50' : liveSnapshot.bapMW < 0 ? '#EF5350' : '#e0e0e0')
              : '#666',
          }}>
            {liveSnapshot.bapMW != null ? `${liveSnapshot.bapMW.toFixed(2)} MW` : '—'}
          </span>
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: 0.5 }}>SoC</span>
          <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#4CAF50' }}>
            {liveSnapshot.socMwh != null ? `${liveSnapshot.socMwh.toFixed(2)} MWh` : '—'}
          </span>
        </div>
        {isLoading && <span style={{ fontSize: 10, color: '#a0a0b0', marginLeft: 'auto' }}>Loading...</span>}
      </div>

      {/* Chart */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {!hasData && !isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 12 }}>
            No battery data available
          </div>
        ) : (
          <ReactECharts option={chartOption} style={{ width: '100%', height: '100%' }} opts={{ renderer: 'canvas' }} notMerge />
        )}
      </div>
    </div>
  );
}
