import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale } from '../../context/LocaleContext';
import { useProfile } from '../../context/ProfileContext';
import { portfolioMappingApi, PortfolioMappingDto } from '../../api/portfolioMapping.api';
import { fileApi } from '../../api/file.api';
import toast from 'react-hot-toast';

export function DamPortfolioManager() {
  const { t } = useLocale();
  const { profile } = useProfile();

  const [damPortfolios, setDamPortfolios] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Map<string, number | null>>(new Map());
  const [savedMappings, setSavedMappings] = useState<PortfolioMappingDto[]>([]);
  const [sourceVersion, setSourceVersion] = useState<{ versionNo: number; fetchedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [noSource, setNoSource] = useState(false);

  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [mappingRes, portfolioRes] = await Promise.all([
        portfolioMappingApi.getMappings(),
        portfolioMappingApi.getDamPortfolios(),
      ]);

      if (portfolioRes.portfolios.length === 0 && portfolioRes.message?.includes('No dam-gen')) {
        setNoSource(true);
      } else {
        setNoSource(false);
      }

      setSavedMappings(mappingRes.mappings.filter(m => m.portfolioType === 'DAM'));
      setSourceVersion(portfolioRes.sourceVersion);

      // Merge: all CSV portfolios + any mapped portfolios not in CSV
      const allPortfolioIds = new Set([
        ...portfolioRes.portfolios,
        ...mappingRes.mappings.filter(m => m.portfolioType === 'DAM').map(m => m.externalId),
      ]);

      setDamPortfolios([...allPortfolioIds].sort());

      // Build mapping state
      const map = new Map<string, number | null>();
      for (const p of allPortfolioIds) map.set(p, null);
      for (const m of mappingRes.mappings) {
        if (m.portfolioType === 'DAM') map.set(m.externalId, m.companyId);
      }
      setMappings(map);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to load portfolio data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Set of company IDs already assigned — used to hide from other dropdowns
  const assignedCompanyIds = useMemo(() => {
    const set = new Set<number>();
    for (const companyId of mappings.values()) {
      if (companyId !== null) set.add(companyId);
    }
    return set;
  }, [mappings]);

  // CSV'de olmayan ama mapping'i olan portfolio'lar
  const csvPortfolioSet = useMemo(() => {
    // sourceVersion null ise CSV okunamamış demek — uyarı gösterme
    if (!sourceVersion) return new Set<string>();
    return new Set(damPortfolios);
  }, [damPortfolios, sourceVersion]);

  const handleCompanyChange = (portfolioId: string, companyId: number | null) => {
    setMappings(prev => {
      const next = new Map(prev);
      next.set(portfolioId, companyId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const toSave = [...mappings.entries()]
        .filter(([_, companyId]) => companyId !== null)
        .map(([externalId, companyId]) => ({ externalId, companyId: companyId! }));

      const result = await portfolioMappingApi.saveMappings('DAM', toSave);
      toast.success(`${result.saved} mapping(s) saved`);
      await loadData(); // reload to sync state
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fileApi.forceRead('dam-gen');
      await loadData();
      toast.success(t('damPortfolio.refreshed'));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  // Check if there are unsaved changes
  const hasChanges = useMemo(() => {
    const savedMap = new Map(savedMappings.map(m => [m.externalId, m.companyId]));
    for (const [extId, companyId] of mappings) {
      const savedCompany = savedMap.get(extId) ?? null;
      if (companyId !== savedCompany) return true;
    }
    // Check removed mappings
    for (const m of savedMappings) {
      if (!mappings.has(m.externalId) || mappings.get(m.externalId) === null) {
        if (savedMap.has(m.externalId)) return true;
      }
    }
    return false;
  }, [mappings, savedMappings]);

  const unmappedCount = [...mappings.values()].filter(v => v === null).length;

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <i className="ri-pie-chart-line text-primary-400" />
            {t('damPortfolio.title')}
          </h3>
          {sourceVersion && (
            <p className="text-[10px] text-gray-500 mt-0.5">
              DAM_GEN.csv v#{sourceVersion.versionNo} · {new Date(sourceVersion.fetchedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className={`ri-refresh-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* No source warning */}
      {noSource && (
        <div className="bg-amber-900/15 border border-amber-800/30 rounded-md px-4 py-3 mb-4">
          <p className="text-amber-300/80 text-xs flex items-center gap-2">
            <i className="ri-error-warning-line" />
            {t('damPortfolio.noSource')}
          </p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-400 rounded-full animate-spin" />
        </div>
      ) : damPortfolios.length === 0 ? (
        <p className="text-gray-500 text-xs text-center py-6">{t('damPortfolio.noPortfolios')}</p>
      ) : (
        <>
          {/* Mapping table */}
          <div className="rounded-lg border border-[#2a2a3e] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#191930]">
                  <th className="text-left px-4 py-2.5 text-gray-400 font-semibold">{t('damPortfolio.portfolioId')}</th>
                  <th className="text-left px-4 py-2.5 text-gray-400 font-semibold">{t('damPortfolio.company')}</th>
                  <th className="text-center px-4 py-2.5 text-gray-400 font-semibold w-24">{t('damPortfolio.status')}</th>
                </tr>
              </thead>
              <tbody>
                {damPortfolios.map(portfolioId => {
                  const selectedCompanyId = mappings.get(portfolioId) ?? null;
                  const isMapped = selectedCompanyId !== null;
                  const notInCsv = sourceVersion && !csvPortfolioSet.has(portfolioId);

                  // Available companies: not assigned to other portfolios
                  const availableCompanies = companies.filter(c => {
                    if (c.companyId === selectedCompanyId) return true; // keep current selection
                    return !assignedCompanyIds.has(c.companyId);
                  });

                  return (
                    <tr key={portfolioId} className="border-t border-[#2a2a3e] hover:bg-[#1e1e42]/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-mono font-medium">{portfolioId}</span>
                          {notInCsv && (
                            <span className="text-[9px] text-amber-400/70 bg-amber-900/20 px-1.5 py-0.5 rounded">
                              {t('damPortfolio.notInCsv')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={selectedCompanyId ?? ''}
                          onChange={e => {
                            const val = e.target.value;
                            handleCompanyChange(portfolioId, val ? parseInt(val) : null);
                          }}
                          className={`w-full bg-[#12121c] border rounded px-2.5 py-1.5 text-xs transition-colors ${
                            isMapped
                              ? 'border-emerald-800/40 text-white'
                              : 'border-[#2a2a3e] text-gray-500'
                          }`}
                        >
                          <option value="">{t('damPortfolio.selectCompany')}</option>
                          {availableCompanies.map(c => (
                            <option key={c.companyId} value={c.companyId}>
                              {c.companyName || c.fullName || `Company ${c.companyId}`}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isMapped ? (
                          <span className="text-emerald-400 text-[10px] flex items-center justify-center gap-1">
                            <i className="ri-check-line" /> Mapped
                          </span>
                        ) : (
                          <span className="text-amber-400/60 text-[10px] flex items-center justify-center gap-1">
                            <i className="ri-alert-line" /> Unmapped
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-4">
            <div className="text-[10px] text-gray-500">
              {unmappedCount > 0 && (
                <span className="text-amber-400/60">
                  <i className="ri-alert-line mr-1" />
                  {unmappedCount} unmapped portfolio{unmappedCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="flex items-center gap-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-md px-4 py-2 transition-colors disabled:opacity-40"
            >
              <i className="ri-save-line text-sm" />
              {saving ? t('common.saving') : t('common.save')}
              {hasChanges && <span className="w-1.5 h-1.5 bg-amber-400 rounded-full ml-1" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
