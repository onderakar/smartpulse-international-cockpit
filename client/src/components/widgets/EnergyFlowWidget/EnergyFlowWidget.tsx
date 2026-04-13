import { useMemo } from 'react';
import { useMonitoring } from '../../../context/MonitoringContext';
import { useProfile } from '../../../context/ProfileContext';
import { getAllGcps } from '@smartpulse-intl/shared';

const TYPE_COLORS: Record<string, string> = {
  BESS: '#29B6F6',
  SOLAR: '#FF9800',
  WIND: '#4CAF50',
  HYDRO: '#00BCD4',
  THERMAL: '#FF5722',
  LOAD: '#9C27B0',
  CONSUMPTION: '#E91E63',
  OTHER: '#78909C',
};

const GRID_COLOR = '#B0BEC5';

interface FlowNode {
  id: string;
  label: string;
  type: string;
  value: number; // MW — positive = producing/injecting, negative = consuming/absorbing
}

export function EnergyFlowWidget() {
  const { liveSnapshot } = useMonitoring();
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;

  const allGcps = useMemo(() => getAllGcps(mapping), [mapping]);
  const gcp = allGcps[0] ?? null;

  // Build flow nodes from live snapshot
  const { nodes, gridFlow } = useMemo(() => {
    const nodes: FlowNode[] = [];
    let totalFlow = 0;

    // Power components from live snapshot
    for (const pc of liveSnapshot.powerComponents) {
      const latestPt = pc.data.length > 0 ? pc.data[pc.data.length - 1] : null;
      const value = latestPt?.value ?? 0;
      nodes.push({ id: pc.componentId, label: pc.displayName, type: pc.type, value });
      totalFlow += value;
    }

    // Battery (BAP) from live snapshot
    if (liveSnapshot.bapMW != null) {
      const existing = nodes.find(n => n.type === 'BESS');
      if (existing) {
        existing.value = liveSnapshot.bapMW;
        // Recalculate totalFlow
        totalFlow = nodes.reduce((s, n) => s + n.value, 0);
      } else {
        nodes.push({ id: 'bap', label: 'Battery', type: 'BESS', value: liveSnapshot.bapMW });
        totalFlow += liveSnapshot.bapMW;
      }
    }

    return { nodes, gridFlow: totalFlow };
  }, [liveSnapshot]);

  const hasData = nodes.some(n => n.value !== 0) || gridFlow !== 0;

  if (!hasData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 12 }}>
        No live data available
      </div>
    );
  }

  const maxAbsValue = Math.max(...nodes.map(n => Math.abs(n.value)), Math.abs(gridFlow), 0.01);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: 12 }}>
      {/* Title bar */}
      <div style={{ fontSize: 10, color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, flexShrink: 0 }}>
        {gcp?.name || 'GCP'} — Live Energy Flow
      </div>

      {/* Flow diagram */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, minHeight: 0 }}>
        {/* Sources column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 120 }}>
          {nodes.map(node => (
            <FlowCard key={node.id} node={node} maxAbs={maxAbsValue} />
          ))}
        </div>

        {/* Arrow column */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {nodes.map(node => (
            <FlowArrow key={node.id} value={node.value} maxAbs={maxAbsValue} color={TYPE_COLORS[node.type] || '#78909C'} />
          ))}
        </div>

        {/* GCP Hub */}
        <div style={{
          width: 80, height: 80,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.05)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, color: '#a0a0b0', textTransform: 'uppercase' }}>GCP</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e0', fontVariantNumeric: 'tabular-nums' }}>
            {gridFlow.toFixed(1)}
          </span>
          <span style={{ fontSize: 9, color: '#a0a0b0' }}>MW</span>
        </div>

        {/* Grid arrow */}
        <FlowArrow value={gridFlow} maxAbs={maxAbsValue} color={GRID_COLOR} />

        {/* Grid */}
        <div style={{
          padding: '12px 16px',
          borderRadius: 8,
          border: `2px solid ${gridFlow > 0 ? '#4CAF50' : gridFlow < 0 ? '#EF5350' : 'rgba(255,255,255,0.2)'}`,
          background: gridFlow > 0 ? 'rgba(76,175,80,0.08)' : gridFlow < 0 ? 'rgba(239,83,80,0.08)' : 'rgba(255,255,255,0.03)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          minWidth: 80,
        }}>
          <span style={{ fontSize: 9, color: '#a0a0b0', textTransform: 'uppercase', marginBottom: 2 }}>Grid</span>
          <span style={{
            fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: gridFlow > 0 ? '#4CAF50' : gridFlow < 0 ? '#EF5350' : '#e0e0e0',
          }}>
            {gridFlow > 0 ? '+' : ''}{gridFlow.toFixed(2)}
          </span>
          <span style={{ fontSize: 9, color: '#a0a0b0' }}>MW</span>
          <span style={{ fontSize: 9, color: gridFlow > 0 ? '#4CAF50' : '#EF5350', marginTop: 2 }}>
            {gridFlow > 0 ? 'Export' : gridFlow < 0 ? 'Import' : '—'}
          </span>
        </div>
      </div>

      {/* SoC indicator at bottom */}
      {liveSnapshot.socMwh != null && (
        <div style={{
          marginTop: 12, flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          borderRadius: 6,
          background: 'rgba(76,175,80,0.06)',
          border: '1px solid rgba(76,175,80,0.15)',
        }}>
          <span style={{ fontSize: 10, color: '#a0a0b0' }}>Battery SoC</span>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, #4CAF50, #66BB6A)',
              width: `${Math.min(100, Math.max(0, (liveSnapshot.socMwh / 10) * 100))}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#4CAF50', fontVariantNumeric: 'tabular-nums' }}>
            {liveSnapshot.socMwh.toFixed(2)} MWh
          </span>
        </div>
      )}
    </div>
  );
}

function FlowCard({ node, maxAbs }: { node: FlowNode; maxAbs: number }) {
  const color = TYPE_COLORS[node.type] || '#78909C';
  const intensity = Math.min(1, Math.abs(node.value) / maxAbs);

  return (
    <div style={{
      padding: '6px 10px',
      borderRadius: 6,
      border: `1px solid ${color}40`,
      background: `${color}${Math.round(intensity * 20).toString(16).padStart(2, '0')}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 9, color: '#a0a0b0', textTransform: 'uppercase' }}>{node.type}</div>
        <div style={{ fontSize: 10, color: '#e0e0e0', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
          {node.label}
        </div>
      </div>
      <span style={{
        fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: node.value > 0 ? '#4CAF50' : node.value < 0 ? '#EF5350' : '#666',
      }}>
        {node.value > 0 ? '+' : ''}{node.value.toFixed(2)}
      </span>
    </div>
  );
}

function FlowArrow({ value, maxAbs, color }: { value: number; maxAbs: number; color: string }) {
  const intensity = Math.min(1, Math.abs(value) / maxAbs);
  const width = 2 + intensity * 30;
  const direction = value >= 0 ? '→' : '←';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 40, height: 20,
    }}>
      <div style={{
        height: Math.max(2, intensity * 6),
        width,
        background: `${color}${Math.round(0.3 + intensity * 0.7).toString(16).length < 2 ? '80' : 'CC'}`,
        borderRadius: 2,
        position: 'relative',
      }}>
        <span style={{
          position: 'absolute', right: value >= 0 ? -8 : undefined, left: value < 0 ? -8 : undefined,
          top: '50%', transform: 'translateY(-50%)',
          fontSize: 10, color: color, opacity: 0.8,
        }}>
          {direction}
        </span>
      </div>
    </div>
  );
}
