import { useState, useMemo } from 'react';
import { useLocale } from '../../context/LocaleContext';
import type { AssetMapping } from '@shared/types/assetMapping.types';

export interface ForecastSelection {
  plantId: number;
  companyId: number;
  resolutionMinutes: number;
}

interface Props {
  mapping: AssetMapping;
  selected: ForecastSelection | null;
  onSelect: (sel: ForecastSelection) => void;
  /** System-level default resolution, used when GCP has no override */
  defaultResolutionMinutes?: number;
}

export function ForecastPlantSelector({ mapping, selected, onSelect, defaultResolutionMinutes = 15 }: Props) {
  const { t } = useLocale();
  const [search, setSearch] = useState('');
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(() => {
    // Auto-expand first company
    const first = mapping.companies[0];
    return first ? new Set([first.companyId]) : new Set();
  });
  const [expandedGcps, setExpandedGcps] = useState<Set<string>>(() => {
    // Auto-expand first GCP
    const firstGcp = mapping.companies[0]?.gridConnectionPoints[0];
    return firstGcp ? new Set([String(firstGcp.id)]) : new Set();
  });
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());

  const q = search.trim().toLowerCase();

  // Build match sets for search highlighting
  const matchedPlantIds = useMemo(() => {
    if (!q) return null;
    const matched = new Set<number>();
    for (const company of mapping.companies) {
      for (const gcp of company.gridConnectionPoints) {
        for (const comp of gcp.components) {
          const compMatches =
            company.companyName.toLowerCase().includes(q) ||
            gcp.name.toLowerCase().includes(q) ||
            comp.displayName.toLowerCase().includes(q);
          if (compMatches) {
            if (comp.portalPlantId) matched.add(comp.portalPlantId);
            if (comp.generation?.portalPlantId) matched.add(comp.generation.portalPlantId);
            if (comp.consumption?.portalPlantId) matched.add(comp.consumption.portalPlantId);
          }
          // SubComponent names don't have their own displayName — check component name
          const genMatches = comp.generation && (`${comp.displayName} gen`.includes(q) || compMatches);
          const conMatches = comp.consumption && (`${comp.displayName} con`.includes(q) || compMatches);
          if (genMatches && comp.generation?.portalPlantId) matched.add(comp.generation.portalPlantId);
          if (conMatches && comp.consumption?.portalPlantId) matched.add(comp.consumption.portalPlantId);
        }
      }
    }
    return matched;
  }, [q, mapping]);

  const toggle = (set: Set<any>, key: any, setter: (s: Set<any>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next as any);
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('forecast.selectorSearch')}
        className="w-full bg-dark-700 border border-gray-600 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-1"
      />

      {mapping.companies.map(company => {
        const isCompanyExpanded = expandedCompanies.has(company.companyId);

        // Filter GCPs that have any matching plant
        const visibleGcps = company.gridConnectionPoints.filter(gcp => {
          if (!q) return true;
          if (company.companyName.toLowerCase().includes(q) || gcp.name.toLowerCase().includes(q)) return true;
          return gcp.components.some(comp => {
            if (comp.displayName.toLowerCase().includes(q)) return true;
            if (comp.portalPlantId && matchedPlantIds?.has(comp.portalPlantId)) return true;
            if (comp.generation?.portalPlantId && matchedPlantIds?.has(comp.generation.portalPlantId)) return true;
            if (comp.consumption?.portalPlantId && matchedPlantIds?.has(comp.consumption.portalPlantId)) return true;
            return false;
          });
        });

        if (q && visibleGcps.length === 0) return null;

        return (
          <div key={company.companyId} className="select-none">
            {/* Company row */}
            <button
              onClick={() => toggle(expandedCompanies, company.companyId, setExpandedCompanies as any)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left hover:bg-dark-700 transition-colors"
            >
              <span className="text-gray-500 text-[10px] w-3">{isCompanyExpanded || q ? '▼' : '▶'}</span>
              <i className="ri-building-line text-gray-500 text-xs" />
              <span className="text-xs font-semibold text-gray-300">{company.companyName}</span>
            </button>

            {/* GCPs */}
            {(isCompanyExpanded || q) && visibleGcps.map(gcp => {
              const gcpKey = String(gcp.id);
              const isGcpExpanded = expandedGcps.has(gcpKey);
              const resolution = gcp.resolutionMinutes ?? defaultResolutionMinutes;

              // Filter components
              const visibleComps = gcp.components.filter(comp => {
                if (!q) return true;
                if (company.companyName.toLowerCase().includes(q) || gcp.name.toLowerCase().includes(q)) return true;
                if (comp.displayName.toLowerCase().includes(q)) return true;
                if (comp.portalPlantId && matchedPlantIds?.has(comp.portalPlantId)) return true;
                if (comp.generation?.portalPlantId && matchedPlantIds?.has(comp.generation.portalPlantId)) return true;
                if (comp.consumption?.portalPlantId && matchedPlantIds?.has(comp.consumption.portalPlantId)) return true;
                return false;
              });

              return (
                <div key={gcpKey} className="ml-4">
                  {/* GCP row */}
                  <button
                    onClick={() => toggle(expandedGcps, gcpKey, setExpandedGcps as any)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left hover:bg-dark-700 transition-colors"
                  >
                    <span className="text-gray-500 text-[10px] w-3">{isGcpExpanded || q ? '▼' : '▶'}</span>
                    <i className="ri-git-branch-line text-primary-600 text-xs" />
                    <span className="text-xs font-medium text-gray-200">{gcp.name}</span>
                    <span className="text-[10px] text-gray-600 ml-auto">{resolution} dk</span>
                  </button>

                  {/* Components */}
                  {(isGcpExpanded || q) && visibleComps.map(comp => {
                    const hasSubComponents = !!(comp.generation || comp.consumption);
                    const compKey = `${gcpKey}:${comp.componentId}`;
                    const isCompExpanded = expandedComponents.has(compKey);

                    // Direct mapping — component is selectable leaf
                    if (!hasSubComponents && comp.portalPlantId) {
                      const isSelected = selected?.plantId === comp.portalPlantId;
                      return (
                        <button
                          key={comp.componentId}
                          onClick={() => onSelect({ plantId: comp.portalPlantId!, companyId: company.companyId, resolutionMinutes: resolution })}
                          className={`ml-4 w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                            isSelected
                              ? 'bg-primary-600/20 text-primary-300'
                              : 'hover:bg-dark-700 text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <span className="w-3" />
                          <i className={`text-xs ${
                            comp.type === 'BESS' ? 'ri-battery-2-charge-line text-green-500' :
                            comp.type === 'SOLAR' ? 'ri-sun-line text-yellow-500' :
                            comp.type === 'WIND' ? 'ri-windy-line text-blue-400' :
                            'ri-flashlight-line text-gray-500'
                          }`} />
                          <span className="text-xs">{comp.displayName}</span>
                          <span className="text-[10px] text-gray-600 ml-auto">#{comp.portalPlantId}</span>
                        </button>
                      );
                    }

                    // Component with subcomponents
                    if (hasSubComponents) {
                      return (
                        <div key={comp.componentId} className="ml-4">
                          <button
                            onClick={() => toggle(expandedComponents, compKey, setExpandedComponents as any)}
                            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left hover:bg-dark-700 transition-colors text-gray-400"
                          >
                            <span className="text-gray-500 text-[10px] w-3">{isCompExpanded || q ? '▼' : '▶'}</span>
                            <i className={`text-xs ${
                              comp.type === 'BESS' ? 'ri-battery-2-charge-line text-green-500' :
                              comp.type === 'SOLAR' ? 'ri-sun-line text-yellow-500' :
                              comp.type === 'WIND' ? 'ri-windy-line text-blue-400' :
                              'ri-flashlight-line text-gray-500'
                            }`} />
                            <span className="text-xs text-gray-300">{comp.displayName}</span>
                          </button>

                          {(isCompExpanded || q) && (
                            <div className="ml-4">
                              {comp.generation?.portalPlantId && (
                                <button
                                  onClick={() => onSelect({ plantId: comp.generation!.portalPlantId, companyId: company.companyId, resolutionMinutes: resolution })}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                                    selected?.plantId === comp.generation.portalPlantId
                                      ? 'bg-primary-600/20 text-primary-300'
                                      : 'hover:bg-dark-700 text-gray-400 hover:text-gray-200'
                                  }`}
                                >
                                  <span className="w-3" />
                                  <i className="ri-arrow-up-line text-xs text-emerald-500" />
                                  <span className="text-xs">{t('forecast.gen')}</span>
                                  {comp.generation.portalPlantName && (
                                    <span className="text-[10px] text-gray-500 truncate ml-1">{comp.generation.portalPlantName}</span>
                                  )}
                                  <span className="text-[10px] text-gray-600 ml-auto">#{comp.generation.portalPlantId}</span>
                                </button>
                              )}
                              {comp.consumption?.portalPlantId && (
                                <button
                                  onClick={() => onSelect({ plantId: comp.consumption!.portalPlantId, companyId: company.companyId, resolutionMinutes: resolution })}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left transition-colors ${
                                    selected?.plantId === comp.consumption.portalPlantId
                                      ? 'bg-primary-600/20 text-primary-300'
                                      : 'hover:bg-dark-700 text-gray-400 hover:text-gray-200'
                                  }`}
                                >
                                  <span className="w-3" />
                                  <i className="ri-arrow-down-line text-xs text-rose-400" />
                                  <span className="text-xs">{t('forecast.con')}</span>
                                  {comp.consumption.portalPlantName && (
                                    <span className="text-[10px] text-gray-500 truncate ml-1">{comp.consumption.portalPlantName}</span>
                                  )}
                                  <span className="text-[10px] text-gray-600 ml-auto">#{comp.consumption.portalPlantId}</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
