import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';
import { timeSeriesApi, TimeSeriesPoint } from '../../../api/timeSeries.api';
import { intradayApi } from '../../../api/intraday.api';
import * as echarts from 'echarts';
import toast from 'react-hot-toast';

const SERIES_KEYS = ['dam_trade_volume', 'generation_forecast', 'idm_net_position'];

interface Props {
  selectedDate: Date;
  onDateChange: (d: Date) => void;
}

export function CompanyTradingWidget({ selectedDate, onDateChange }: Props) {
  const { t } = useLocale();
  const { profile } = useProfile();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingIdm, setRefreshingIdm] = useState(false);
  const [seriesData, setSeriesData] = useState<Record<string, TimeSeriesPoint[]>>({});

  const dateStr = selectedDate.toISOString().slice(0, 10);

  // Auto-select first company
  useEffect(() => {
    if (companies.length > 0 && selectedCompanyId === null) {
      setSelectedCompanyId(companies[0].companyId);
    }
  }, [companies, selectedCompanyId]);

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const dateStart = `${dateStr}T00:00:00Z`;
      const dateEnd = `${dateStr}T23:59:59Z`;
      const data = await timeSeriesApi.getMultiSeries(
        'COMPANY', String(selectedCompanyId), SERIES_KEYS, dateStart, dateEnd,
      );
      setSeriesData(data);
    } catch (err: any) {
      console.warn('[CompanyTradingWidget] Load failed:', err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, dateStr]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefreshIdm = useCallback(async () => {
    if (!selectedCompanyId) return;
    setRefreshingIdm(true);
    try {
      await intradayApi.refresh(
        [selectedCompanyId],
        `${dateStr}T00:00:00`,
        `${dateStr}T23:59:59`,
      );
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'IDM refresh failed');
    } finally {
      setRefreshingIdm(false);
    }
  }, [selectedCompanyId, dateStr, loadData]);

  // ECharts rendering
  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark');
    }
    const chart = chartInstance.current;

    const damTrade = seriesData.dam_trade_volume ?? [];
    const forecast = seriesData.generation_forecast ?? [];
    const idmNet = seriesData.idm_net_position ?? [];

    // Always generate all 96 MTU slots (00:00–23:45) based on the selected delivery date
    const categories: string[] = [];
    for (let i = 0; i < 96; i++) {
      const d = new Date(selectedDate);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(i * 15);
      categories.push(d.toISOString());
    }
    const formatLabel = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const toAligned = (points: TimeSeriesPoint[]) => {
      const map = new Map(points.map(p => [new Date(p.deliveryStart).toISOString(), p.value]));
      return categories.map(ts => map.get(ts) ?? null);
    };

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.03)' } },
        backgroundColor: '#1c1c28',
        borderColor: '#2a2a3e',
        textStyle: { fontSize: 11 },
      },
      legend: {
        top: 5,
        textStyle: { color: '#a0a0b0', fontSize: 10 },
        data: [
          t('widget.damTrade'),
          t('widget.genForecast'),
          t('widget.idmNetPos'),
        ],
      },
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: categories.map(formatLabel),
        axisLabel: { color: '#555', fontSize: 9, interval: 3, rotate: 0 },
        axisTick: { show: true, alignWithLabel: true, interval: 0, lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisLine: { lineStyle: { color: '#2a2a3e' } },
        splitLine: { show: true, interval: 0, lineStyle: { color: 'rgba(255,255,255,0.08)', width: 1 } },
      },
      yAxis: {
        type: 'value',
        name: 'MW',
        nameTextStyle: { color: '#555', fontSize: 9 },
        axisLabel: { color: '#555', fontSize: 9 },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.08)', width: 1, type: 'dashed' } },
      },
      series: [
        {
          name: t('widget.damTrade'),
          type: 'bar',
          stack: 'trading',
          data: toAligned(damTrade),
          itemStyle: { color: '#5b8def' },
          barMaxWidth: 12,
        },
        {
          name: t('widget.genForecast'),
          type: 'line',
          data: toAligned(forecast),
          lineStyle: { color: '#50c878', width: 2 },
          itemStyle: { color: '#50c878' },
          symbol: 'none',
          step: 'start',
        },
        {
          name: t('widget.idmNetPos'),
          type: 'bar',
          stack: 'trading',
          data: toAligned(idmNet),
          itemStyle: { color: '#e8784a' },
          barMaxWidth: 12,
        },
      ],
    };

    chart.setOption(option, true);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartRef.current);

    return () => { resizeObserver.disconnect(); };
  }, [seriesData, t]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => setSelectedCompanyId(parseInt(e.target.value))}
            className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2 py-1"
          >
            {companies.map(c => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName || c.fullName || `#${c.companyId}`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefreshIdm}
            disabled={refreshingIdm}
            className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded px-2 py-1 transition-colors disabled:opacity-40"
          >
            <i className={`ri-download-cloud-line ${refreshingIdm ? 'animate-spin' : ''}`} />
            IDM
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded px-2 py-1 transition-colors disabled:opacity-40"
          >
            <i className={`ri-refresh-line ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} className="flex-1 min-h-[200px]" />

      {/* Summary */}
      <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500 shrink-0">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#5b8def' }} />
          DAM: {seriesData.dam_trade_volume?.length ?? 0}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#50c878' }} />
          Forecast: {seriesData.generation_forecast?.length ?? 0}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#e8784a' }} />
          IDM: {seriesData.idm_net_position?.length ?? 0}
        </span>
      </div>
    </div>
  );
}
