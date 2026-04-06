import { useState, useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { scheduleApi } from '../../api/schedule.api';
import type { ScheduleSlotRevision } from '@smartpulse-intl/shared';

interface SlotRevisionPopupProps {
  plantId: number;
  deliveryStart: string;
  deliveryEnd: string;
  anchorRect: { top: number; left: number; width: number; height: number };
  onClose: () => void;
  /** Parent must call this to cancel its own close timer when popup is hovered */
  onPopupHover: (hovering: boolean) => void;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatSlotRange(deliveryStart: string, deliveryEnd: string): string {
  const s = new Date(deliveryStart);
  const e = new Date(deliveryEnd);
  const sLocal = new Date(s.getTime() + 3 * 3600_000);
  const eLocal = new Date(e.getTime() + 3 * 3600_000);
  return `${pad2(sLocal.getUTCHours())}:${pad2(sLocal.getUTCMinutes())} – ${pad2(eLocal.getUTCHours())}:${pad2(eLocal.getUTCMinutes())}`;
}

export function SlotRevisionPopup({ plantId, deliveryStart, deliveryEnd, anchorRect, onClose, onPopupHover }: SlotRevisionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [revisions, setRevisions] = useState<ScheduleSlotRevision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    scheduleApi.getSlotHistory(plantId, deliveryStart).then(revs => {
      setRevisions(revs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [plantId, deliveryStart]);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Position: prefer below cell, flip above if not enough space
  const popupHeight = revisions.length > 1 ? 180 : 80;
  const spaceBelow = window.innerHeight - (anchorRect.top + anchorRect.height + 4);
  const placeAbove = spaceBelow < popupHeight && anchorRect.top > popupHeight;

  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    top: placeAbove ? anchorRect.top - popupHeight - 4 : anchorRect.top + anchorRect.height + 4,
    left: Math.min(anchorRect.left, window.innerWidth - 320),
    zIndex: 1000,
    width: 300,
  };

  const chartOption: EChartsOption | null = revisions.length > 1 ? {
    animation: false,
    backgroundColor: 'transparent',
    grid: { top: 8, right: 8, bottom: 20, left: 40, containLabel: false },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#333' } },
      axisLabel: { color: '#777', fontSize: 9, formatter: '{HH}:{mm}' },
      splitLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisLabel: { color: '#777', fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
      axisTick: { show: false },
    },
    series: [{
      type: 'line',
      step: 'end',
      data: revisions.map(r => [r.fetchedAt, Number(r.row.Battery_Active_Power_MW) || 0]),
      lineStyle: { color: '#f87171', width: 1.5 },
      itemStyle: { color: '#f87171' },
      areaStyle: { color: 'rgba(248, 113, 113, 0.08)' },
      symbolSize: 4,
    }],
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 20, 35, 0.95)',
      borderColor: 'rgba(255,255,255,0.08)',
      textStyle: { color: '#ccc', fontSize: 10 },
      formatter: (params: any) => {
        if (!Array.isArray(params) || !params[0]) return '';
        const ts = params[0].value[0];
        const val = params[0].value[1];
        const d = new Date(ts);
        return `<span style="color:#888">${pad2(d.getHours())}:${pad2(d.getMinutes())}</span>&nbsp;&nbsp;<b>${val} MW</b>`;
      },
    },
  } : null;

  const latestBap = revisions.length > 0
    ? Number(revisions[revisions.length - 1].row.Battery_Active_Power_MW) || 0
    : null;

  return (
    <div
      ref={popupRef}
      style={popupStyle}
      className="bg-dark-800/95 backdrop-blur-sm border border-gray-700/80 rounded-lg shadow-2xl overflow-hidden"
      onMouseEnter={() => onPopupHover(true)}
      onMouseLeave={() => onPopupHover(false)}
    >
      {/* Compact header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50">
        <span className="text-[11px] text-gray-300 font-medium">{formatSlotRange(deliveryStart, deliveryEnd)}</span>
        {latestBap !== null && (
          <span className={`text-[11px] font-mono font-medium ${
            latestBap < 0 ? 'text-emerald-400' : latestBap > 0 ? 'text-rose-400' : 'text-gray-500'
          }`}>
            {latestBap > 0 ? '+' : ''}{latestBap} MW
          </span>
        )}
      </div>

      {loading ? (
        <div className="px-3 py-6 text-center text-xs text-gray-600">...</div>
      ) : revisions.length === 0 ? (
        <div className="px-3 py-4 text-center text-[10px] text-gray-600">—</div>
      ) : chartOption ? (
        <div style={{ height: 130 }}>
          <ReactECharts option={chartOption} notMerge style={{ height: '100%', width: '100%' }} />
        </div>
      ) : (
        // Single revision — just show value, no chart
        <div className="px-3 py-3 text-center text-xs text-gray-500">
          {revisions.length} rev
        </div>
      )}
    </div>
  );
}
