import { useState, useMemo } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { portfolioApi } from '../../api/portfolio.api';
import toast from 'react-hot-toast';
import type {
  PortfolioSnapshot,
  PortfolioEntry,
  PortalEntityUnit,
  AssetMapping,
  CompanyMapping,
  GridConnectionPoint,
  GcpComponent,
  GcpSubComponent,
} from '@smartpulse-intl/shared';

// ── Chain resolution ──

interface EntityChain {
  company: CompanyMapping;
  gcp: GridConnectionPoint;
  component: GcpComponent;
  subComponent: (GcpSubComponent & { direction: string }) | null;
}

function findChainForUnit(unitNo: number, mapping: AssetMapping | null | undefined): EntityChain | null {
  if (!mapping?.companies) return null;
  for (const company of mapping.companies) {
    for (const gcp of company.gridConnectionPoints || []) {
      for (const comp of gcp.components || []) {
        if (comp.portalPlantId === unitNo)
          return { company, gcp, component: comp, subComponent: null };
        if (comp.generation?.portalPlantId === unitNo)
          return { company, gcp, component: comp, subComponent: { ...comp.generation, direction: 'Generation' } };
        if (comp.consumption?.portalPlantId === unitNo)
          return { company, gcp, component: comp, subComponent: { ...comp.consumption, direction: 'Consumption' } };
      }
    }
  }
  return null;
}

// ── Tooltip ──

function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, background: 'rgba(20,20,40,0.95)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#e0e0e0',
          whiteSpace: 'nowrap', zIndex: 100, pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {content}
        </div>
      )}
    </span>
  );
}

function TRow({ label, value }: { label: string; value: string | number | undefined | null }) {
  if (value === undefined || value === null || value === '') return null;
  return <div><span style={{ color: '#888' }}>{label}:</span> <b>{String(value)}</b></div>;
}

// ── Badges ──

const BADGE: Record<string, { bg: string; icon: string }> = {
  company: { bg: 'rgba(79,195,247,0.15)', icon: '🏢' },
  gcp: { bg: 'rgba(171,71,188,0.15)', icon: '📍' },
  component: { bg: 'rgba(255,179,0,0.15)', icon: '⚙️' },
  sub: { bg: 'rgba(0,191,165,0.15)', icon: '📦' },
  unit: { bg: 'rgba(76,175,80,0.15)', icon: '🏭' },
};

function Badge({ type, name, tip }: { type: string; name: string; tip: React.ReactNode }) {
  const s = BADGE[type] || BADGE.unit;
  return (
    <Tooltip content={tip}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: s.bg, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500, color: '#e0e0e0' }}>
        <span>{s.icon}</span>{name}
      </span>
    </Tooltip>
  );
}

function Arrow() {
  return <span style={{ color: '#555', margin: '0 4px', fontSize: 11 }}>→</span>;
}

// ── Unit row with chain ──

function UnitChainRow({ unitNo, unitMap, mapping }: {
  unitNo: number;
  unitMap: Map<number, PortalEntityUnit>;
  mapping: AssetMapping | null | undefined;
}) {
  const unit = unitMap.get(unitNo);
  const chain = useMemo(() => findChainForUnit(unitNo, mapping), [unitNo, mapping]);

  const unitName = unit?.fullName || `Unit #${unitNo}`;

  const unitTip = (
    <div>
      <TRow label="Unit No" value={unitNo} />
      <TRow label="Name" value={unit?.fullName} />
      <TRow label="Type" value={unit?.unitType} />
    </div>
  );

  if (!chain) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', flexWrap: 'wrap' }}>
        <Badge type="unit" name={unitName} tip={unitTip} />
        <Arrow />
        <span style={{ color: '#EF5350', fontSize: 11, opacity: 0.8 }}>⚠ No mapping</span>
      </div>
    );
  }

  const { company, gcp, component, subComponent } = chain;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0', flexWrap: 'wrap' }}>
      <Badge type="unit" name={unitName} tip={unitTip} />
      <Arrow />
      {subComponent && (
        <>
          <Badge type="sub" name={`${subComponent.portalPlantName || 'Sub'} (${subComponent.direction})`} tip={
            <div>
              <TRow label="Portal Plant" value={subComponent.portalPlantId} />
              <TRow label="Name" value={subComponent.portalPlantName} />
              <TRow label="Direction" value={subComponent.direction} />
              <TRow label="Power" value={subComponent.installedPowerMw ? `${subComponent.installedPowerMw} MW` : undefined} />
            </div>
          } />
          <Arrow />
        </>
      )}
      <Badge type="component" name={component.displayName} tip={
        <div>
          <TRow label="ID" value={component.componentId} />
          <TRow label="Type" value={component.type} />
          <TRow label="Name" value={component.displayName} />
          <TRow label="Capacity" value={component.installedCapacityMw ? `${component.installedCapacityMw} MW` : undefined} />
          {component.bessParams && <>
            <TRow label="Charge" value={`${component.bessParams.maxChargePowerMw} MW`} />
            <TRow label="Discharge" value={`${component.bessParams.maxDischargePowerMw} MW`} />
            <TRow label="Capacity" value={`${component.bessParams.capacityMwh} MWh`} />
          </>}
        </div>
      } />
      <Arrow />
      <Badge type="gcp" name={gcp.name} tip={
        <div>
          <TRow label="GCP ID" value={gcp.id} />
          <TRow label="Name" value={gcp.name} />
          <TRow label="Max Injection" value={gcp.maxInjectionMw ? `${gcp.maxInjectionMw} MW` : undefined} />
          <TRow label="Components" value={gcp.components?.length} />
        </div>
      } />
      <Arrow />
      <Badge type="company" name={company.companyName} tip={
        <div>
          <TRow label="Company ID" value={company.companyId} />
          <TRow label="Name" value={company.companyName} />
          <TRow label="Timezone" value={company.timezone} />
        </div>
      } />
    </div>
  );
}

// ── Portfolio card ──

function PortfolioCard({ portfolio, unitMap, mapping }: {
  portfolio: PortfolioEntry;
  unitMap: Map<number, PortalEntityUnit>;
  mapping: AssetMapping | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  const typeBadge: Record<string, { color: string; bg: string }> = {
    TSO: { color: '#FF9800', bg: 'rgba(255,152,0,0.15)' },
    AFRR: { color: '#E040FB', bg: 'rgba(224,64,251,0.15)' },
    Unknown: { color: '#888', bg: 'rgba(255,255,255,0.05)' },
  };
  const tb = typeBadge[portfolio.portfolioType] || typeBadge.Unknown;

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#666' }}>{open ? '▼' : '▶'}</span>
          <span style={{ fontWeight: 600, color: '#e0e0e0', fontSize: 13 }}>{portfolio.name}</span>
          <span style={{ fontSize: 9, color: tb.color, background: tb.bg, borderRadius: 3, padding: '1px 6px' }}>
            {portfolio.portfolioType}
          </span>
          {portfolio.eicForTps && (
            <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace' }}>{portfolio.eicForTps}</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: '#888' }}>{portfolio.portfolioUnits.length} unit(s)</span>
      </div>

      {open && (
        <div style={{ padding: '6px 12px' }}>
          {portfolio.portfolioUnits.length === 0 ? (
            <div style={{ color: '#555', fontSize: 11, fontStyle: 'italic' }}>Empty portfolio</div>
          ) : (
            portfolio.portfolioUnits.map(pu => (
              <UnitChainRow key={pu.unitNo} unitNo={pu.unitNo} unitMap={unitMap} mapping={mapping} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──

export function PortfolioViewer() {
  const { profile } = useProfile();
  const [loading, setLoading] = useState(false);

  const snapshot: PortfolioSnapshot | undefined = (profile as any)?.portfolioSnapshot;
  const mapping = profile?.assetMapping ?? null;

  const unitMap = useMemo(() => {
    const m = new Map<number, PortalEntityUnit>();
    for (const u of snapshot?.entityUnits ?? []) m.set(u.unitNo, u);
    return m;
  }, [snapshot]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const result = await portfolioApi.refresh();
      if (result.portfolioCount === 0 && result.entityUnitCount === 0) {
        toast.error('No portfolios returned from Portal');
      } else {
        toast.success(`${result.portfolioCount} portfolios, ${result.entityUnitCount} units fetched`);
        window.location.reload();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <i className="ri-folder-chart-line text-primary-400" />
            Portfolio Mapping
          </h3>
          {snapshot?.fetchedAt && (
            <p style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
              Last fetched: {new Date(snapshot.fetchedAt).toLocaleString()} — {snapshot.entityUnits?.length ?? 0} units, {snapshot.portfolios?.length ?? 0} portfolios
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: loading ? '#333' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
            color: 'white', border: 'none', borderRadius: 6, padding: '8px 16px',
            fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.7 : 1,
          }}
        >
          <i className="ri-refresh-line" />
          Refresh Portfolios
        </button>
      </div>

      {!snapshot || !snapshot.portfolios ? (
        <div style={{
          textAlign: 'center', padding: 24, color: '#666', fontSize: 12,
          border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 6,
        }}>
          No portfolio data. Click "Refresh Portfolios" to fetch from SmartPulse Portal.
        </div>
      ) : (
        snapshot.portfolios.map(pf => (
          <PortfolioCard key={pf.id} portfolio={pf} unitMap={unitMap} mapping={mapping} />
        ))
      )}
    </div>
  );
}
