import { useCallback, useMemo, useState, useEffect, useRef, ReactNode } from 'react';
import { ScheduleRow, ScheduleSlotRevision } from '@smartpulse-intl/shared';
import { useLocale } from '../../context/LocaleContext';

interface ScheduleDataGridProps {
  rows: ScheduleRow[];
  historyData?: Record<string, ScheduleSlotRevision[]>;
  hourlyMode: boolean;
  onRowChange: (index: number, field: string, value: number) => void;
  timezone?: string;
  scheduleReadOnly?: boolean;
}

// --- BAP mode helpers ---

type BapMode = 'charge' | 'discharge' | 'idle';

function getBapMode(value: number): BapMode {
  if (value < 0) return 'charge';
  if (value > 0) return 'discharge';
  return 'idle';
}

function nextBapMode(current: BapMode): BapMode {
  if (current === 'charge') return 'discharge';
  if (current === 'discharge') return 'idle';
  return 'charge';
}

// --- SVG icons ---

const ChargeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const DischargeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M19 12l-7 7-7-7" />
  </svg>
);

const IdleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const MODE_STYLE: Record<BapMode, {
  icon: ReactNode;
  tooltip: string;
  pill: string;
  cellBg: string;
  border: string;
  inputBorder: string;
  mwLabel: string;
}> = {
  charge: {
    icon: <ChargeIcon />,
    tooltip: 'Charge',
    pill: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-900/40',
    cellBg: 'bg-emerald-950/25',
    border: 'border-l-emerald-400',
    inputBorder: 'border-emerald-700 focus:border-emerald-400',
    mwLabel: 'text-emerald-500/70',
  },
  discharge: {
    icon: <DischargeIcon />,
    tooltip: 'Discharge',
    pill: 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-900/40',
    cellBg: 'bg-rose-950/25',
    border: 'border-l-rose-400',
    inputBorder: 'border-rose-700 focus:border-rose-400',
    mwLabel: 'text-rose-500/70',
  },
  idle: {
    icon: <IdleIcon />,
    tooltip: 'Idle',
    pill: 'bg-gray-700 hover:bg-gray-600 text-gray-400 shadow-sm shadow-gray-900/30',
    cellBg: 'bg-transparent',
    border: 'border-l-gray-700',
    inputBorder: 'border-gray-700 focus:border-gray-500',
    mwLabel: 'text-gray-600',
  },
};

// --- Time formatting ---

function formatTimeWithDate(dtStr: string, hourlyMode: boolean, timezone?: string): string {
  if (!dtStr) return '';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;

  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find(p => p.type === t)?.value || '00';
      const min = hourlyMode ? '00' : get('minute');
      return `${get('day')}.${get('month')} ${get('hour')}:${min}`;
    } catch {
      // fallback to local time below
    }
  }

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = hourlyMode ? '00' : String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${min}`;
}

function getDayLabel(dtStr: string, timezone?: string): string {
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    weekday: 'short',
  };
  if (timezone) opts.timeZone = timezone;
  return d.toLocaleDateString('tr-TR', opts);
}

// --- Decimal input (always uses "." separator) ---

function DecimalInput({ value, onCommit, className, readOnly }: {
  value: number;
  onCommit: (raw: string) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(',', '.');
    if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
    setLocal(raw);
    if (raw !== '' && !raw.endsWith('.')) {
      onCommit(raw);
    }
  };

  const handleBlur = () => {
    const num = parseFloat(local);
    if (isNaN(num)) {
      setLocal(String(value));
    } else {
      setLocal(String(num));
      onCommit(String(num));
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onChange={readOnly ? undefined : handleChange}
      onBlur={readOnly ? undefined : handleBlur}
      readOnly={readOnly}
      className={className}
    />
  );
}

// --- Display row type ---

interface DisplayRow {
  row: ScheduleRow;
  originalIndices: number[];
  isMixed?: { bap: boolean; maxGen: boolean };
}

export function ScheduleDataGrid({
  rows,
  historyData,
  hourlyMode,
  onRowChange,
  timezone,
  scheduleReadOnly = false,
}: ScheduleDataGridProps) {
  const { t } = useLocale();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!hourlyMode) {
      return rows.map((row, idx) => ({ row, originalIndices: [idx] }));
    }
    const grouped: DisplayRow[] = [];
    for (let i = 0; i < rows.length; i += 4) {
      const chunk = rows.slice(i, i + 4);
      const indices = chunk.map((_, j) => i + j);

      const bapValues = chunk.map(r => Number(r.Battery_Active_Power_MW) || 0);
      const maxGenValues = chunk.map(r => Number(r.Max_Generation_MW) || 0);
      const avgBap = bapValues[bapValues.length - 1];
      const avgMaxGen = maxGenValues[maxGenValues.length - 1];
      const allBapSame = bapValues.every(v => v === bapValues[0]);
      const allMaxGenSame = maxGenValues.every(v => v === maxGenValues[0]);

      const avgRow: ScheduleRow = {
        ...chunk[0],
        Battery_Active_Power_MW: avgBap,
        Max_Generation_MW: avgMaxGen,
      };

      grouped.push({
        row: avgRow,
        originalIndices: indices,
        isMixed: { bap: !allBapSame, maxGen: !allMaxGenSame },
      });
    }
    return grouped;
  }, [rows, hourlyMode]);

  // --- Current time tracking ---

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const currentSlotIndex = useMemo(() => {
    const nowMs = now.getTime();
    for (let i = 0; i < displayRows.length; i++) {
      const start = new Date(displayRows[i].row.Delivery_Start).getTime();
      const slotMs = hourlyMode ? 3_600_000 : 900_000;
      if (nowMs >= start && nowMs < start + slotMs) return i;
    }
    return -1;
  }, [now, displayRows, hourlyMode]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  useEffect(() => {
    if (currentSlotIndex >= 0 && scrollRef.current && !hasScrolled.current) {
      hasScrolled.current = true;
      const rowH = 34;
      const target = currentSlotIndex * rowH - scrollRef.current.clientHeight / 2;
      scrollRef.current.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }, [currentSlotIndex]);

  // --- BAP handlers ---

  const handleBapToggle = useCallback(
    (originalIndices: number[], currentValue: number) => {
      const current = getBapMode(currentValue);
      const next = nextBapMode(current);
      const absVal = Math.abs(currentValue);
      const newValue = next === 'charge' ? -(absVal || 0) : next === 'discharge' ? (absVal || 0) : 0;
      for (const idx of originalIndices) {
        onRowChange(idx, 'Battery_Active_Power_MW', newValue);
      }
    },
    [onRowChange],
  );

  const handleBapMagnitude = useCallback(
    (originalIndices: number[], currentValue: number, rawMagnitude: string) => {
      const mag = parseFloat(rawMagnitude);
      if (isNaN(mag) || mag < 0) return;
      const mode = getBapMode(currentValue);
      const effectiveMode = mode === 'idle' && mag > 0 ? 'charge' : mode;
      const newValue = effectiveMode === 'charge' ? -mag : mag;
      for (const idx of originalIndices) {
        onRowChange(idx, 'Battery_Active_Power_MW', newValue);
      }
    },
    [onRowChange],
  );

  // --- MaxGen handler ---

  const handleMaxGenChange = useCallback(
    (originalIndices: number[], rawValue: string) => {
      const num = parseFloat(rawValue);
      if (isNaN(num)) return;
      for (const idx of originalIndices) {
        onRowChange(idx, 'Max_Generation_MW', num);
      }
    },
    [onRowChange],
  );

  if (rows.length === 0) {
    return (
      <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-400 text-sm">{t('scheduleGrid.noData')}</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-auto max-h-[600px] border border-gray-700 rounded-lg">
      <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
        <thead className="bg-dark-700 sticky top-0 z-10">
          <tr>
            <th className="text-left text-gray-400 font-medium px-3 py-2.5 border-b border-gray-600 w-24">
              {t('scheduleGrid.time')}
            </th>
            <th className="text-center text-gray-400 font-medium px-3 py-2.5 border-b border-gray-600">
              <span className="flex items-center justify-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>{t('battery.charging')}</span>
                <span className="text-gray-600 mx-0.5">/</span>
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500"></span>
                <span>{t('battery.discharging')} (MW)</span>
              </span>
            </th>
            <th className="text-right text-gray-400 font-medium px-3 py-2.5 border-b border-gray-600 w-28">
              {t('scheduleGrid.maxGen')}
            </th>
            <th className="text-left text-gray-400 font-medium px-3 py-2.5 border-b border-gray-600 w-28">
              {t('scheduleGrid.scheduleId')}
            </th>
            <th className="text-left text-gray-400 font-medium px-3 py-2.5 border-b border-gray-600 w-20">
              {t('scheduleGrid.mode')}
            </th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((item, i) => {
            const { row, originalIndices } = item;
            const timeLabel = formatTimeWithDate(row.Delivery_Start, hourlyMode, timezone);

            const bapVal = Number(row.Battery_Active_Power_MW) || 0;
            const bapMode = getBapMode(bapVal);
            const bapAbsVal = Math.abs(bapVal);
            const s = MODE_STYLE[bapMode];
            const modeTooltip = bapMode === 'charge' ? t('scheduleGrid.charge') : bapMode === 'discharge' ? t('scheduleGrid.discharge') : t('battery.idle');

            const maxGenVal = Number(row.Max_Generation_MW) || 0;
            const zebra = i % 2 === 0 ? 'bg-dark-800' : 'bg-[#1a1a2e]';

            // Time status for current row highlighting
            const isCurrent = currentSlotIndex >= 0 && i === currentSlotIndex;
            const isPast = currentSlotIndex >= 0 && i < currentSlotIndex;
            const isFuture = currentSlotIndex >= 0 && i > currentSlotIndex;

            const timeColor = isCurrent
              ? 'text-primary-300 font-semibold'
              : isPast
                ? 'text-gray-600'
                : isFuture
                  ? 'text-gray-200'
                  : 'text-gray-400';

            const rowHighlight = isCurrent
              ? 'ring-1 ring-inset ring-primary-500/50 bg-primary-950/20'
              : zebra;

            // Day separator: show when the day changes between rows
            const prevDayStr = i > 0 ? getDayLabel(displayRows[i - 1].row.Delivery_Start, timezone) : null;
            const currentDayStr = getDayLabel(row.Delivery_Start, timezone);
            const showDaySeparator = i > 0 && prevDayStr !== currentDayStr;

            const slotHistory = historyData ? historyData[row.Delivery_Start] || [] : [];
            const hasHistory = slotHistory.length > 1 && !hourlyMode; // Don't show confusing 15m history inside 1h bundled rows
            const isExpanded = expandedRows.has(i);

            return (
              <DayAwareRow key={i} showSeparator={showDaySeparator} dayLabel={currentDayStr}>
                <tr className={`${rowHighlight} border-l-[3px] ${s.border} transition-colors group`}>
                  {/* Time */}
                  <td className={`px-3 py-1.5 font-mono text-xs border-b border-gray-800/60 ${timeColor} flex items-center gap-1`}>
                    {hasHistory && (
                      <button
                        onClick={() => toggleRow(i)}
                        className="text-gray-500 hover:text-white transition-colors"
                        title="View past versions"
                      >
                        <i className={`ri-arrow-${isExpanded ? 'down' : 'right'}-s-line`} />
                      </button>
                    )}
                    {timeLabel}
                  </td>

                  {/* BAP: Toggle + Magnitude */}
                  <td className={`px-1.5 py-0.5 border-b border-gray-800/60 ${s.cellBg} transition-colors`}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => !scheduleReadOnly && handleBapToggle(originalIndices, bapVal)}
                        title={modeTooltip}
                        disabled={scheduleReadOnly}
                        className={`shrink-0 w-7 h-6 flex items-center justify-center rounded-md transition-all ${scheduleReadOnly ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : s.pill}`}
                      >
                        {s.icon}
                      </button>
                      <div className="relative flex-1 min-w-[64px]">
                        <DecimalInput
                          value={bapAbsVal}
                          onCommit={raw => handleBapMagnitude(originalIndices, bapVal, raw)}
                          readOnly={scheduleReadOnly}
                          className={`w-full bg-dark-900/60 border rounded-md pl-1.5 pr-7 py-1 text-right font-mono text-xs focus:outline-none transition-colors ${scheduleReadOnly ? 'text-gray-500 border-gray-800 cursor-not-allowed' : `text-gray-100 ${s.inputBorder}`}`}
                        />
                        <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-medium pointer-events-none ${s.mwLabel}`}>
                          MW
                        </span>
                      </div>
                      {item.isMixed?.bap && (
                        <span className="text-yellow-500 text-[9px] shrink-0" title={t('scheduleGrid.mixedValues')}>~</span>
                      )}
                    </div>
                  </td>

                  {/* Max Generation */}
                  <td className="px-1.5 py-0.5 border-b border-gray-800/60">
                    <div className="flex items-center gap-1">
                      <DecimalInput
                        value={maxGenVal}
                        onCommit={raw => handleMaxGenChange(originalIndices, raw)}
                        readOnly={scheduleReadOnly}
                        className={`w-full bg-dark-900/60 border rounded-md px-1.5 py-1 text-right font-mono text-xs focus:outline-none transition-colors ${scheduleReadOnly ? 'text-gray-500 border-gray-800 cursor-not-allowed' : 'text-gray-200 border-gray-700 focus:border-amber-600'}`}
                      />
                      {item.isMixed?.maxGen && (
                        <span className="text-yellow-500 text-[9px] shrink-0" title={t('scheduleGrid.mixedValues')}>~</span>
                      )}
                    </div>
                  </td>

                  {/* Schedule ID */}
                  <td className="px-3 py-1.5 text-gray-600 font-mono text-[10px] truncate border-b border-gray-800/60 max-w-[120px]">
                    {row.Schedule_ID || '-'}
                  </td>

                  {/* Operation Mode */}
                  <td className="px-3 py-1.5 text-gray-600 text-xs border-b border-gray-800/60">
                    {row.Operation_Mode || '-'}
                  </td>
                </tr>
                {isExpanded && hasHistory && slotHistory.slice(0, -1).reverse().map((rev, revIdx) => {
                  const revMode = getBapMode(rev.row.Battery_Active_Power_MW);
                  const revDate = new Date(rev.fetchedAt);
                  const dStr = `${String(revDate.getHours()).padStart(2, '0')}:${String(revDate.getMinutes()).padStart(2, '0')}:${String(revDate.getSeconds()).padStart(2, '0')}`;
                  return (
                    <tr key={`${i}-rev-${revIdx}`} className="bg-dark-900/50 border-l-[3px] border-l-gray-700/50">
                      <td className="px-3 py-1 font-mono text-[10px] text-gray-500 border-b border-gray-800/30 pl-8">
                        ⮑ backup @ {dStr}
                      </td>
                      <td className="px-1.5 py-1 text-xs font-mono text-gray-500 border-b border-gray-800/30 text-right pr-6">
                        {rev.row.Battery_Active_Power_MW} MW
                      </td>
                      <td className="px-1.5 py-1 text-xs font-mono text-gray-500 border-b border-gray-800/30 text-right pr-2">
                        {rev.row.Max_Generation_MW} MW
                      </td>
                      <td colSpan={2} className="px-3 py-1 text-[10px] text-gray-600 border-b border-gray-800/30">
                        ({rev.contentHash.substring(0, 8)})
                      </td>
                    </tr>
                  )
                })}
              </DayAwareRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Helper component to inject day separator rows
function DayAwareRow({
  showSeparator,
  dayLabel,
  children,
}: {
  showSeparator: boolean;
  dayLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      {showSeparator && (
        <tr>
          <td colSpan={5} className="bg-dark-700/80 border-y border-primary-800/30 px-3 py-1">
            <span className="text-[10px] font-medium text-primary-400/80">{dayLabel}</span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
