import { useMemo, useState } from 'react';
import { useMonitoring } from '../../../context/MonitoringContext';
import { useProfile } from '../../../context/ProfileContext';
import { useLocale } from '../../../context/LocaleContext';
import { getAllGcps } from '@smartpulse-intl/shared';
import type { ComponentType } from '@smartpulse-intl/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComponentPower {
  componentId: string;
  type: ComponentType;
  displayName: string;
  currentPower: number; // MW, positive = generating
}

interface EnergyFlowState {
  renewables: ComponentPower[];
  totalRenewableMW: number;
  batteryMW: number;
  junctionToGridMW: number;
  junctionToBatteryMW: number;
  batteryToGridMW: number;
  gridNetMW: number;
  grossExportMW: number;
  grossImportMW: number;
}

// ---------------------------------------------------------------------------
// Energy flow calculation
// ---------------------------------------------------------------------------

function computeEnergyFlow(
  renewables: ComponentPower[],
  batteryMW: number,
): EnergyFlowState {
  const totalRenewableMW = renewables.reduce((sum, r) => sum + Math.max(0, r.currentPower), 0);
  const gridNetMW = totalRenewableMW + batteryMW;

  let junctionToGridMW = 0;
  let junctionToBatteryMW = 0;
  let batteryToGridMW = 0;

  if (batteryMW < 0) {
    // Charging
    const chargeMW = Math.abs(batteryMW);
    if (totalRenewableMW >= chargeMW) {
      junctionToBatteryMW = chargeMW;
      junctionToGridMW = totalRenewableMW - chargeMW;
    } else {
      junctionToBatteryMW = totalRenewableMW;
      junctionToGridMW = 0;
    }
    batteryToGridMW = 0;
  } else if (batteryMW > 0) {
    // Discharging
    junctionToBatteryMW = 0;
    junctionToGridMW = totalRenewableMW;
    batteryToGridMW = batteryMW;
  } else {
    junctionToGridMW = totalRenewableMW;
  }

  const grossExportMW = Math.max(0, junctionToGridMW) + Math.max(0, batteryToGridMW);
  const grossImportMW = Math.max(0, -gridNetMW);

  return {
    renewables, totalRenewableMW, batteryMW,
    junctionToGridMW, junctionToBatteryMW, batteryToGridMW,
    gridNetMW, grossExportMW, grossImportMW,
  };
}

// ---------------------------------------------------------------------------
// SVG sub-components
// ---------------------------------------------------------------------------

function SolarIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r="10" fill="#422006" stroke="#FF9800" strokeWidth="1.5" />
      <circle cx="0" cy="0" r="4" fill="#FF9800" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
        <line
          key={angle}
          x1={Math.cos(angle * Math.PI / 180) * 6} y1={Math.sin(angle * Math.PI / 180) * 6}
          x2={Math.cos(angle * Math.PI / 180) * 9} y2={Math.sin(angle * Math.PI / 180) * 9}
          stroke="#FF9800" strokeWidth="1.2" strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function WindIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r="10" fill="#0A2F1A" stroke="#4CAF50" strokeWidth="1.5" />
      <path d="M-1 2 C-1-3 3-5 5-3 M-1 2 C-5 2-7-2-4-4 M-1 2 C0 5 4 7 6 5"
        fill="none" stroke="#4CAF50" strokeWidth="1.3" strokeLinecap="round" />
    </g>
  );
}

function BatteryIcon({ x, y, isCharging, isDischarging }: { x: number; y: number; isCharging: boolean; isDischarging: boolean }) {
  const color = isCharging ? '#29B6F6' : isDischarging ? '#4CAF50' : '#9CA3AF';
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x="-14" y="-9" width="28" height="18" rx="3" fill="#1F2937" stroke={color} strokeWidth="1.5" />
      <rect x="14" y="-4" width="3" height="8" rx="1" fill={color} />
      <path d="M-2-5L-5 1H-1L-4 6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(2,0)" />
    </g>
  );
}

function GridIcon({ x, y, isExporting, isImporting }: { x: number; y: number; isExporting: boolean; isImporting: boolean }) {
  const color = isExporting ? '#4CAF50' : isImporting ? '#EF5350' : '#9CA3AF';
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r="14" fill="#1E293B" stroke={color} strokeWidth="1.5" />
      <path d="M-5 10L-2-8L2-8L5 10 M-4 2H4 M-3-3H3"
        fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function HydroIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r="10" fill="#0A2033" stroke="#00BCD4" strokeWidth="1.5" />
      <path d="M-4-2 Q0-8 4-2 Q0 4 -4-2Z" fill="#00BCD4" opacity="0.7" />
    </g>
  );
}

function GenericIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r="10" fill="#1F2937" stroke={color} strokeWidth="1.5" />
      <circle cx="0" cy="0" r="3" fill={color} opacity="0.6" />
    </g>
  );
}

function FlowArrow({
  x1, y1, x2, y2, valueMW, active, reverse, color,
}: {
  x1: number; y1: number; x2: number; y2: number;
  valueMW: number; active: boolean; reverse?: boolean; color: string;
}) {
  if (!active && Math.abs(valueMW) < 0.005) return null;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len, uy = dy / len;
  const sx = x1 + ux * 16, sy = y1 + uy * 16;
  const ex = x2 - ux * 16, ey = y2 - uy * 16;
  const ax = reverse ? sx : ex, ay = reverse ? sy : ey;
  const adx = reverse ? ux : -ux, ady = reverse ? uy : -uy;
  const midX = (sx + ex) / 2, midY = (sy + ey) / 2;
  const opacity = active ? 1 : 0.2;
  const displayColor = active ? color : '#4B5563';

  return (
    <g opacity={opacity}>
      <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={displayColor}
        strokeWidth={active ? 2 : 1} strokeDasharray={active ? undefined : '4 3'} />
      <polygon
        points={`${ax},${ay} ${ax + adx * 6 + ady * 3},${ay + ady * 6 - adx * 3} ${ax + adx * 6 - ady * 3},${ay + ady * 6 + adx * 3}`}
        fill={displayColor}
      />
      {active && (
        <g>
          <rect x={midX - 22} y={midY - 8} width="44" height="16" rx="3"
            fill="#111827" stroke={displayColor} strokeWidth="0.5" opacity="0.9" />
          <text x={midX} y={midY + 4} textAnchor="middle" fill={displayColor}
            fontSize="9" fontFamily="monospace" fontWeight="bold">
            {Math.abs(valueMW).toFixed(2)}
          </text>
        </g>
      )}
    </g>
  );
}

function JunctionDot({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="5" fill="#374151" stroke="#6B7280" strokeWidth="1" />
      <circle cx={x} cy={y} r="2" fill="#9CA3AF" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Icon picker by component type
// ---------------------------------------------------------------------------

const TYPE_ICON_COLORS: Record<string, string> = {
  SOLAR: '#FF9800', WIND: '#4CAF50', HYDRO: '#00BCD4',
  THERMAL: '#FF5722', LOAD: '#9C27B0', CONSUMPTION: '#E91E63', OTHER: '#78909C',
};

function ComponentIcon({ x, y, type }: { x: number; y: number; type: string }) {
  if (type === 'SOLAR') return <SolarIcon x={x} y={y} />;
  if (type === 'WIND') return <WindIcon x={x} y={y} />;
  if (type === 'HYDRO') return <HydroIcon x={x} y={y} />;
  return <GenericIcon x={x} y={y} color={TYPE_ICON_COLORS[type] || '#78909C'} />;
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

export function EnergyFlowWidget() {
  const { t } = useLocale();
  const { liveSnapshot } = useMonitoring();
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;

  const [scale, setScale] = useState(1);
  const zoomIn = () => setScale(s => Math.min(s + 0.15, 2));
  const zoomOut = () => setScale(s => Math.max(s - 0.15, 0.55));

  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);
  const [selectedGcpIdx, setSelectedGcpIdx] = useState(0);
  const activeGcp = allGcps[selectedGcpIdx] ?? null;

  const bapMW = liveSnapshot.bapMW ?? 0;
  const allPowerComps = liveSnapshot.powerComponents ?? [];

  const componentPowers = useMemo<ComponentPower[]>(() => {
    const comps = (activeGcp?.components ?? []).filter(c => c.type !== 'BESS');
    const results: ComponentPower[] = [];
    const usedPowerIds = new Set<string>();

    for (const comp of comps) {
      let lastValue = 0;
      const direct = allPowerComps.find(p => p.componentId === comp.componentId);
      if (direct?.data?.length) {
        lastValue = direct.data[direct.data.length - 1].value;
        usedPowerIds.add(direct.componentId);
      }
      results.push({
        componentId: comp.componentId,
        type: comp.type as ComponentType,
        displayName: comp.displayName,
        currentPower: lastValue,
      });
    }

    for (const pc of allPowerComps) {
      if (usedPowerIds.has(pc.componentId)) continue;
      const lastPoint = pc.data.length ? pc.data[pc.data.length - 1] : null;
      results.push({
        componentId: pc.componentId,
        type: pc.type as ComponentType || 'OTHER',
        displayName: pc.displayName,
        currentPower: lastPoint?.value ?? 0,
      });
    }

    return results;
  }, [activeGcp?.components, allPowerComps]);

  const flow = useMemo(() => computeEnergyFlow(componentPowers, bapMW), [componentPowers, bapMW]);
  const hasData = liveSnapshot.lastUpdated !== null;

  const lastFetchedStr = liveSnapshot.lastUpdated
    ? liveSnapshot.lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';

  // Layout
  const renewableX = 45;
  const junctionX = 140, junctionY = 65;
  const batteryX = 140, batteryY = 160;
  const gridX = 265, gridY = 65;

  const renewCount = flow.renewables.length;
  const renewYs = flow.renewables.map((_, i) => {
    if (renewCount === 1) return 65;
    return 35 + i * (60 / Math.max(renewCount - 1, 1));
  });

  return (
    <div className="flex flex-col h-full p-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-1 border-b border-gray-700/50 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <h4 className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 shrink-0">
            {t('energyFlow.title')}
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
            </span>
          </h4>
          {allGcps.length > 1 && (
            <select
              value={selectedGcpIdx}
              onChange={e => setSelectedGcpIdx(Number(e.target.value))}
              className="text-[9px] bg-dark-700 border border-gray-600 rounded px-1 py-0.5 text-gray-300 min-w-0 max-w-[100px] truncate focus:outline-none focus:border-primary-500"
            >
              {allGcps.map((g, i) => (
                <option key={g.id} value={i}>{g.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={zoomOut} className="w-4 h-4 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-dark-600 text-xs font-bold leading-none">−</button>
          <button onClick={zoomIn} className="w-4 h-4 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-dark-600 text-xs font-bold leading-none">+</button>
          <span className="text-[9px] text-gray-600 ml-1">{lastFetchedStr}</span>
        </div>
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
          {t('common.loading')}
        </div>
      ) : (
        <>
          {/* SVG Diagram */}
          <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
            <svg viewBox="0 0 320 210" className="w-full h-full" preserveAspectRatio="xMidYMid meet"
              style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>

              {/* Renewables -> Junction */}
              {flow.renewables.map((r, i) => (
                <FlowArrow key={r.componentId}
                  x1={renewableX} y1={renewYs[i]} x2={junctionX} y2={junctionY}
                  valueMW={r.currentPower} active={r.currentPower > 0.005}
                  color={TYPE_ICON_COLORS[r.type] || '#9CA3AF'} />
              ))}

              {/* Junction -> Grid */}
              <FlowArrow x1={junctionX} y1={junctionY} x2={gridX} y2={gridY}
                valueMW={flow.junctionToGridMW} active={flow.junctionToGridMW > 0.005} color="#4CAF50" />

              {/* Grid -> Junction (import) */}
              <FlowArrow x1={gridX} y1={gridY} x2={junctionX} y2={junctionY}
                valueMW={flow.grossImportMW}
                active={flow.gridNetMW < -0.005 && flow.junctionToGridMW < 0.005}
                reverse color="#EF5350" />

              {/* Junction -> Battery (charging) */}
              <FlowArrow x1={junctionX} y1={junctionY} x2={batteryX} y2={batteryY}
                valueMW={flow.junctionToBatteryMW > 0 ? flow.junctionToBatteryMW : Math.abs(flow.batteryMW)}
                active={flow.batteryMW < -0.005} color="#29B6F6" />

              {/* Battery -> Grid (discharging) */}
              <FlowArrow x1={batteryX} y1={batteryY} x2={gridX} y2={gridY}
                valueMW={flow.batteryToGridMW} active={flow.batteryToGridMW > 0.005} color="#4CAF50" />

              {/* Icons + labels */}
              {flow.renewables.map((r, i) => (
                <g key={r.componentId}>
                  <ComponentIcon x={renewableX} y={renewYs[i]} type={r.type} />
                  <text x={renewableX - 16} y={renewYs[i] + 4} textAnchor="end" fontSize="8" fill="#9CA3AF">
                    {r.displayName}
                  </text>
                  <text x={renewableX - 16} y={renewYs[i] + 14} textAnchor="end" fontSize="9"
                    fontFamily="monospace" fontWeight="bold"
                    fill={r.currentPower > 0.005 ? (TYPE_ICON_COLORS[r.type] || '#9CA3AF') : '#6B7280'}>
                    {r.currentPower.toFixed(2)} MW
                  </text>
                </g>
              ))}

              {flow.renewables.length === 0 && (
                <text x={renewableX} y={65} textAnchor="middle" fontSize="8" fill="#4B5563">
                  ({t('energyFlow.noRenewables')})
                </text>
              )}

              <JunctionDot x={junctionX} y={junctionY} />

              <BatteryIcon x={batteryX} y={batteryY}
                isCharging={flow.batteryMW < -0.005} isDischarging={flow.batteryMW > 0.005} />
              <text x={batteryX} y={batteryY + 20} textAnchor="middle" fontSize="8" fill="#9CA3AF">
                {t('energyFlow.battery')}
              </text>
              <text x={batteryX} y={batteryY + 30} textAnchor="middle" fontSize="9"
                fontFamily="monospace" fontWeight="bold"
                fill={flow.batteryMW < -0.005 ? '#29B6F6' : flow.batteryMW > 0.005 ? '#4CAF50' : '#6B7280'}>
                {flow.batteryMW.toFixed(2)} MW
              </text>

              <GridIcon x={gridX} y={gridY}
                isExporting={flow.gridNetMW > 0.005} isImporting={flow.gridNetMW < -0.005} />
              <text x={gridX} y={gridY + 24} textAnchor="middle" fontSize="8" fill="#9CA3AF">
                {t('energyFlow.grid')}
              </text>
              <text x={gridX} y={gridY + 34} textAnchor="middle" fontSize="9"
                fontFamily="monospace" fontWeight="bold"
                fill={flow.gridNetMW > 0.005 ? '#4CAF50' : flow.gridNetMW < -0.005 ? '#EF5350' : '#6B7280'}>
                {flow.gridNetMW > 0 ? '+' : ''}{flow.gridNetMW.toFixed(2)} MW
              </text>
            </svg>
          </div>

          {/* Summary footer */}
          <div className="border-t border-gray-700/50 pt-1.5 px-1">
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span className="text-[9px] text-gray-400">{t('energyFlow.gridExport')}:</span>
                <span className="text-[10px] font-mono font-semibold text-green-400">
                  {flow.grossExportMW.toFixed(2)} MW
                </span>
              </div>
              <div className="w-px h-3 bg-gray-700"></div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400"></div>
                <span className="text-[9px] text-gray-400">{t('energyFlow.gridImport')}:</span>
                <span className="text-[10px] font-mono font-semibold text-red-400">
                  {flow.grossImportMW.toFixed(2)} MW
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
