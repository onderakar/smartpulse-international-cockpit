import { useState, useEffect } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { configApi } from '../../api/config.api';
import { forecastApi } from '../../api/forecast.api';
import { monitoringApi } from '../../api/monitoring.api';
import { kgupApi } from '../../api/kgup.api';
import { KgupResponse } from '@shared/types/kgup.types';
import { PlantSelector } from './PlantSelector';
import { PortalPlant } from '@shared/types/auth.types';
import {
  AssetMapping, CompanyMapping, UEVCB, UEVCBComponent,
  LabeledMetricMapping, BapSource, UEVCBComponentType,
  migrateAssetMapping,
} from '@shared/types/assetMapping.types';
import { MTUResolution } from '@shared/types/plant.types';

export function AssetMappingForm() {
  const { profile, updateProfile } = useProfile();
  const { companies: portalCompanies, plants: portalPlants } = useAuth();
  const { t } = useLocale();

  // Local edit state
  const [companies, setCompanies] = useState<CompanyMapping[]>([]);
  const [ftpDirection, setFtpDirection] = useState<'incoming' | 'outgoing'>('incoming');
  const [ftpFilename, setFtpFilename] = useState('Technical_Parameters.csv');

  // Fold/unfold state
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set());
  const [expandedUevcbs, setExpandedUevcbs] = useState<Set<string>>(new Set());
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());

  const toggleComponents = (uevcbId: string) => {
    setExpandedComponents(prev => {
      const next = new Set(prev);
      if (next.has(uevcbId)) next.delete(uevcbId);
      else next.add(uevcbId);
      return next;
    });
  };

  // Save status
  const [isSaved, setIsSaved] = useState(false);

  // Trade test results per Company
  const [tradeTestResults, setTradeTestResults] = useState<Record<number, {
    loading: boolean;
    error?: string;
    hasGop?: boolean;
    hasIa?: boolean;
    hasGip?: boolean;
  }>>({});

  const handleTestTrade = async (companyId: number) => {
    setTradeTestResults(prev => ({ ...prev, [companyId]: { loading: true } }));
    try {
      const today = new Date();
      const dayStr = today.toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul',
      }).replace(/\./g, '/');
      const raw = await kgupApi.getData(companyId, dayStr);
      const hasGop = (raw.GopAlis || []).some(v => v !== 0) || (raw.GopSatis || []).some(v => v !== 0);
      const hasIa = (raw.IaAlis || []).some(v => v !== 0) || (raw.IaSatis || []).some(v => v !== 0);
      const hasGip = (raw.GipAlis || []).some(v => v !== 0) || (raw.GipSatis || []).some(v => v !== 0);
      setTradeTestResults(prev => ({ ...prev, [companyId]: { loading: false, hasGop, hasIa, hasGip } }));
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Trade test failed';
      setTradeTestResults(prev => ({ ...prev, [companyId]: { loading: false, error: msg } }));
    }
  };

  // KGÜP test results per UEVCB
  const [kgupTestResults, setKgupTestResults] = useState<Record<string, {
    loading: boolean;
    error?: string;
    raw?: KgupResponse;
    primaryFound?: boolean;
    primaryPlantId?: number;
  }>>({});

  const handleTestKgup = async (companyId: number, uevcbId: string, primaryPlantId: number) => {
    setKgupTestResults(prev => ({ ...prev, [uevcbId]: { loading: true, primaryPlantId } }));
    try {
      const today = new Date();
      const dayStr = today.toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul',
      }).replace(/\./g, '/');
      const raw = await kgupApi.getData(companyId, dayStr);
      const primaryFound = (raw.KgupData || []).some(p => p.PowerPlantId === primaryPlantId);
      setKgupTestResults(prev => ({ ...prev, [uevcbId]: { loading: false, raw, primaryFound, primaryPlantId } }));
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'KGUP test failed';
      setKgupTestResults(prev => ({ ...prev, [uevcbId]: { loading: false, error: msg, primaryPlantId } }));
    }
  };

  // Load from profile
  useEffect(() => {
    if (profile?.assetMapping) {
      const migrated = migrateAssetMapping(profile.assetMapping);
      setCompanies(migrated.companies || []);
      setFtpDirection(migrated.ftpDirection || 'incoming');
      setFtpFilename(migrated.ftpFilename || 'Technical_Parameters.csv');
      // Keep sections collapsed by default on load
      setExpandedCompanies(new Set());
      setExpandedUevcbs(new Set());
    }
  }, [profile?.assetMapping]);

  // --- Company operations ---
  const handleAddCompany = (companyId: number) => {
    const portal = portalCompanies.find(c => c.id === companyId);
    if (!portal || companies.some(c => c.companyId === companyId)) return;

    const newCompany: CompanyMapping = {
      companyId: portal.id,
      companyName: portal.name,
      fullName: portal.fullName,
      timezone: portal.timezone,
      uevcbs: [],
    };
    setCompanies([...companies, newCompany]);
    setExpandedCompanies(prev => new Set(prev).add(portal.id));
  };

  const handleRemoveCompany = (companyId: number) => {
    setCompanies(companies.filter(c => c.companyId !== companyId));
  };

  const toggleCompany = (companyId: number) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  };

  // --- UEVCB operations ---
  const handleAddUevcb = (companyIdx: number, plant: PortalPlant) => {
    const newUevcb: UEVCB = {
      uevcbId: `UEVCB_${Date.now()}`,
      name: plant.name,
      primaryPortalPlantId: plant.id,
      timezone: plant.timezone,
      resolutionMinutes: 60,
      components: [],
    };
    const updated = [...companies];
    updated[companyIdx] = {
      ...updated[companyIdx],
      uevcbs: [...updated[companyIdx].uevcbs, newUevcb],
    };
    setCompanies(updated);
    setExpandedUevcbs(prev => new Set(prev).add(newUevcb.uevcbId));

    // Fetch resolution for the plant
    configApi.getPlantsResolution()
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : [data];
        const plantRes = arr.find((r: any) => r.plantId === plant.id || r.PlantId === plant.id);
        if (plantRes) {
          const resolution = (plantRes.resolution || plantRes.Resolution || 60) as MTUResolution;
          setCompanies(prev => prev.map((c, ci) =>
            ci === companyIdx ? {
              ...c,
              uevcbs: c.uevcbs.map(u =>
                u.uevcbId === newUevcb.uevcbId ? { ...u, resolutionMinutes: resolution } : u
              ),
            } : c
          ));
        }
      })
      .catch(console.error);
  };

  const handleRemoveUevcb = (companyIdx: number, uevcbIdx: number) => {
    const updated = [...companies];
    updated[companyIdx] = {
      ...updated[companyIdx],
      uevcbs: updated[companyIdx].uevcbs.filter((_, i) => i !== uevcbIdx),
    };
    setCompanies(updated);
  };

  const toggleUevcb = (uevcbId: string) => {
    setExpandedUevcbs(prev => {
      const next = new Set(prev);
      if (next.has(uevcbId)) next.delete(uevcbId);
      else next.add(uevcbId);
      return next;
    });
  };

  const updateUevcb = (companyIdx: number, uevcbIdx: number, patch: Partial<UEVCB>) => {
    const updated = [...companies];
    const uevcbs = [...updated[companyIdx].uevcbs];
    uevcbs[uevcbIdx] = { ...uevcbs[uevcbIdx], ...patch };
    updated[companyIdx] = { ...updated[companyIdx], uevcbs };
    setCompanies(updated);
  };

  // --- Component operations ---
  const handleAddComponent = (companyIdx: number, uevcbIdx: number) => {
    const newComp: UEVCBComponent = {
      componentId: `COMP_${Date.now()}`,
      type: 'BESS',
      displayName: 'New Asset',
      portalPlantId: 0,
      forecastPreference: { sourceName: 'FinalForecast', beforeMinutes: 0 },
    };
    updateUevcb(companyIdx, uevcbIdx, {
      components: [...companies[companyIdx].uevcbs[uevcbIdx].components, newComp],
    });
  };

  const handleRemoveComponent = (companyIdx: number, uevcbIdx: number, compIdx: number) => {
    const comps = companies[companyIdx].uevcbs[uevcbIdx].components.filter((_, i) => i !== compIdx);
    updateUevcb(companyIdx, uevcbIdx, { components: comps });
  };

  const updateComponent = (companyIdx: number, uevcbIdx: number, compIdx: number, patch: Partial<UEVCBComponent>) => {
    const comps = [...companies[companyIdx].uevcbs[uevcbIdx].components];
    comps[compIdx] = { ...comps[compIdx], ...patch };
    updateUevcb(companyIdx, uevcbIdx, { components: comps });
  };

  // --- Save ---
  const handleSave = () => {
    const newMapping: AssetMapping = {
      companies,
      ftpDirection,
      ftpFilename,
    };
    updateProfile({ assetMapping: newMapping });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  // Available companies not yet added
  const availableCompanies = portalCompanies.filter(
    pc => !companies.some(c => c.companyId === pc.id)
  );

  return (
    <section className="bg-dark-800 border border-gray-700 rounded-lg p-6">
      <h3 className="text-lg font-medium text-white mb-4">{t('assetMapping.title')}</h3>
      <p className="text-xs text-gray-500 mb-4">
        {t('assetMapping.description')}
      </p>

      <div className="space-y-4">
        {/* Add Company */}
        {availableCompanies.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              defaultValue=""
              onChange={(e) => {
                const id = parseInt(e.target.value, 10);
                if (id) handleAddCompany(id);
                e.target.value = '';
              }}
              className="flex-1 bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="" disabled>{t('assetMapping.addCompany')}</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
              ))}
            </select>
          </div>
        )}
        {portalCompanies.length === 0 && companies.length === 0 && (
          <p className="text-sm text-gray-500 italic">{t('assetMapping.noCompanies')}</p>
        )}

        {/* Company panels */}
        {companies.map((company, cIdx) => {
          const isExpanded = expandedCompanies.has(company.companyId);
          const portalCompany = portalCompanies.find(pc => pc.id === company.companyId);
          const companyPlantIds = portalCompany?.powerPlantIds || [];

          return (
            <div key={company.companyId} className="border border-gray-600 rounded-lg overflow-hidden">
              {/* Company header */}
              <div
                className="flex items-center justify-between px-4 py-3 bg-dark-700 cursor-pointer hover:bg-dark-600 transition-colors"
                onClick={() => toggleCompany(company.companyId)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-4">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span className="text-sm font-medium text-white">
                    {company.companyName}
                  </span>
                  <span className="text-xs text-gray-500">ID: {company.companyId}</span>
                  <span className="text-xs text-gray-500">| {company.uevcbs.length} UEVCB</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTestTrade(company.companyId); }}
                    className="bg-dark-800 hover:bg-dark-600 text-blue-400 text-xs font-medium px-2.5 py-1 rounded border border-gray-600 transition-colors"
                  >Test Ticaret</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveCompany(company.companyId); }}
                    className="text-gray-500 hover:text-red-400 text-xs px-2"
                    title={t('assetMapping.removeCompany')}
                  >{t('assetMapping.removeCompany')}</button>
                </div>
              </div>

              {/* Trade test result */}
              {tradeTestResults[company.companyId] && (() => {
                const tr = tradeTestResults[company.companyId];
                return (
                  <div className="px-4 py-2 bg-dark-700 border-b border-gray-700 flex items-center justify-between">
                    {tr.loading ? (
                      <span className="text-xs text-blue-300 animate-pulse">Ticaret verileri kontrol ediliyor...</span>
                    ) : tr.error ? (
                      <span className="text-xs text-red-400">{tr.error}</span>
                    ) : (
                      <div className="flex items-center gap-3 text-xs">
                        <span className={tr.hasGop ? 'text-green-400 font-medium' : 'text-red-400'}>GÖP {tr.hasGop ? '✓' : '✗'}</span>
                        <span className={tr.hasIa ? 'text-green-400 font-medium' : 'text-red-400'}>İA {tr.hasIa ? '✓' : '✗'}</span>
                        <span className={tr.hasGip ? 'text-green-400 font-medium' : 'text-red-400'}>GİP {tr.hasGip ? '✓' : '✗'}</span>
                      </div>
                    )}
                    <button
                      onClick={() => setTradeTestResults(prev => { const n = { ...prev }; delete n[company.companyId]; return n; })}
                      className="text-gray-500 hover:text-gray-300 text-xs"
                    >✕</button>
                  </div>
                );
              })()}

              {/* Company body */}
              {isExpanded && (
                <div className="p-4 space-y-4 bg-dark-800">
                  {/* Add UEVCB */}
                  <div>
                    <PlantSelector
                      selectedPlantId={null}
                      filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
                      excludePlantIds={company.uevcbs.map(u => u.primaryPortalPlantId)}
                      label={t('assetMapping.addUevcb')}
                      onSelect={(plant) => handleAddUevcb(cIdx, plant)}
                    />
                  </div>

                  {/* UEVCB panels */}
                  {company.uevcbs.map((uevcb, uIdx) => {
                    const isUevcbExpanded = expandedUevcbs.has(uevcb.uevcbId);
                    return (
                      <div key={uevcb.uevcbId} className="border border-gray-700 rounded-lg overflow-hidden">
                        {/* UEVCB header */}
                        <div
                          className="flex items-center justify-between px-4 py-2 bg-dark-900 cursor-pointer hover:bg-dark-700 transition-colors"
                          onClick={() => toggleUevcb(uevcb.uevcbId)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs w-4">{isUevcbExpanded ? '\u25BC' : '\u25B6'}</span>
                            <span className="text-sm text-gray-200">{uevcb.name}</span>
                            <span className="text-xs text-gray-500">Plant: {uevcb.primaryPortalPlantId}</span>
                            <span className="text-xs text-gray-500">| {uevcb.components.length} comp</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTestKgup(company.companyId, uevcb.uevcbId, uevcb.primaryPortalPlantId);
                              }}
                              className="bg-dark-700 hover:bg-dark-600 text-yellow-400 text-xs font-medium px-2.5 py-1 rounded border border-gray-600 transition-colors"
                              title={t('assetMapping.testKgupTrade')}
                            >{t('assetMapping.testKgup')}</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveUevcb(cIdx, uIdx); }}
                              className="text-gray-500 hover:text-red-400 text-xs px-2"
                              title={t('common.remove')}
                            >{t('common.remove')}</button>
                          </div>
                        </div>

                        {/* KGÜP Test Result */}
                        {kgupTestResults[uevcb.uevcbId] && (
                          <KgupTestResultPanel
                            result={kgupTestResults[uevcb.uevcbId]}
                            onClose={() => setKgupTestResults(prev => {
                              const next = { ...prev };
                              delete next[uevcb.uevcbId];
                              return next;
                            })}
                          />
                        )}

                        {/* UEVCB body */}
                        {isUevcbExpanded && (
                          <div className="p-4 space-y-4">
                            {/* UEVCB metadata */}
                            <div className="grid grid-cols-3 gap-4">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.timezone')}</label>
                                <input value={uevcb.timezone} readOnly
                                  className="w-full bg-dark-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-400" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.resolution')}</label>
                                <select
                                  value={uevcb.resolutionMinutes}
                                  onChange={(e) => updateUevcb(cIdx, uIdx, { resolutionMinutes: parseInt(e.target.value) as MTUResolution })}
                                  className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                                >
                                  <option value={15}>{t('assetMapping.min15')}</option>
                                  <option value={30}>{t('assetMapping.min30')}</option>
                                  <option value={60}>{t('assetMapping.min60')}</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.uevcbName')}</label>
                                <input
                                  value={uevcb.name}
                                  onChange={(e) => updateUevcb(cIdx, uIdx, { name: e.target.value })}
                                  className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                                />
                              </div>
                            </div>

                            {/* Components — collapsible */}
                            <div className="border-t border-gray-700 pt-3">
                              <div
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => toggleComponents(uevcb.uevcbId)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs w-4">{expandedComponents.has(uevcb.uevcbId) ? '\u25BC' : '\u25B6'}</span>
                                  <h5 className="text-xs font-medium text-gray-300">
                                    {t('assetMapping.components')}
                                    <span className="text-gray-500 ml-1">({uevcb.components.length})</span>
                                  </h5>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAddComponent(cIdx, uIdx); }}
                                  className="bg-dark-700 hover:bg-dark-600 text-primary-400 text-xs font-medium px-3 py-1 rounded border border-gray-600 transition-colors"
                                >{t('assetMapping.addComponent')}</button>
                              </div>

                              {expandedComponents.has(uevcb.uevcbId) && (
                                <div className="mt-3">
                                  {uevcb.components.length === 0 && (
                                    <p className="text-xs text-gray-500 italic">{t('assetMapping.noComponents')}</p>
                                  )}

                                  <div className="space-y-4">
                                    {uevcb.components.map((comp, compIdx) => (
                                      <ComponentEditor
                                        key={comp.componentId}
                                        comp={comp}
                                        companyId={company.companyId}
                                        companyPlantIds={companyPlantIds}
                                        excludePlantIds={uevcb.components.filter((_, i) => i !== compIdx).map(c => c.portalPlantId).filter(Boolean)}
                                        onChange={(patch) => updateComponent(cIdx, uIdx, compIdx, patch)}
                                        onRemove={() => handleRemoveComponent(cIdx, uIdx, compIdx)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {company.uevcbs.length === 0 && (
                    <p className="text-xs text-gray-500 italic">{t('assetMapping.noUevcbs')}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* FTP Settings */}
        <div className="border-t border-gray-700 pt-4 mt-4">
          <h4 className="text-sm font-medium text-gray-300 mb-3">{t('assetMapping.ftpSettings')}</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.direction')}</label>
              <select
                value={ftpDirection}
                onChange={(e) => setFtpDirection(e.target.value as 'incoming' | 'outgoing')}
                className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="incoming">{t('assetMapping.incoming')}</option>
                <option value="outgoing">{t('assetMapping.outgoing')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.filename')}</label>
              <input
                value={ftpFilename}
                onChange={(e) => setFtpFilename(e.target.value)}
                className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleSave}
            className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors"
          >{t('assetMapping.saveMapping')}</button>
          {isSaved && (
            <span className="text-green-400 text-sm font-medium animate-pulse">{t('assetMapping.saved')}</span>
          )}
        </div>
      </div>
    </section>
  );
}

// --- KGÜP Test Result Panel ---

interface KgupTestResult {
  loading: boolean;
  error?: string;
  raw?: KgupResponse;
  primaryFound?: boolean;
  primaryPlantId?: number;
}

function KgupTestResultPanel({ result, onClose }: { result: KgupTestResult; onClose: () => void }) {
  const { t } = useLocale();
  const [showDetails, setShowDetails] = useState(false);

  if (result.loading) {
    return (
      <div className="px-4 py-3 bg-dark-700 border-t border-gray-700 text-xs text-yellow-300 animate-pulse">
        {t('assetMapping.testKgupLoading')}
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="px-4 py-3 bg-red-900/20 border-t border-red-700">
        <div className="flex items-center justify-between">
          <span className="text-xs text-red-400">{result.error}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs ml-2">✕</button>
        </div>
      </div>
    );
  }

  const raw = result.raw;
  if (!raw) return null;

  const plants = raw.KgupData || [];
  const primaryPlant = plants.find(p => p.PowerPlantId === result.primaryPlantId);
  const primaryHasKgup = primaryPlant ? (primaryPlant.KgupValues || []).some(v => v !== 0) : false;

  // Overall status
  const isOk = result.primaryFound && primaryHasKgup;

  return (
    <div className="px-4 py-3 bg-dark-700 border-t border-gray-700 space-y-2">
      {/* === SINGLE SUMMARY LINE === */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className={isOk
            ? 'text-green-400 font-bold'
            : 'text-red-400 font-bold'
          }>{isOk ? '✓' : '✗'}</span>
          <span className="text-gray-300">
            {!result.primaryFound
              ? `Ana santral (${result.primaryPlantId}) KGUP'ta yok`
              : !primaryHasKgup
                ? `Ana santral bulundu, KGUP hep 0`
                : `Ana santral KGUP OK`
            }
          </span>
          <button
            onClick={() => setShowDetails(d => !d)}
            className="text-gray-500 hover:text-gray-200 text-[10px] underline ml-1"
          >{showDetails ? 'gizle' : 'detay'}</button>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>

      {/* === COLLAPSIBLE DETAILS === */}
      {showDetails && (
        <div className="space-y-3 pt-2 border-t border-gray-600">
          {/* Plant list */}
          <div>
            <div className="text-[10px] text-gray-400 mb-1">
              Portaldan dönen santraller ({plants.length}):
            </div>
            {plants.length === 0 ? (
              <div className="text-xs text-red-400">Hiçbir santral dönmedi!</div>
            ) : (
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {plants.map(p => {
                  const isPrimary = p.PowerPlantId === result.primaryPlantId;
                  const hasKgup = (p.KgupValues || []).some(v => v !== 0);
                  return (
                    <div
                      key={p.PowerPlantId}
                      className={`flex items-center justify-between text-xs px-2 py-0.5 rounded ${
                        isPrimary ? 'bg-yellow-900/30 border border-yellow-700/50' : ''
                      }`}
                    >
                      <span className={isPrimary ? 'text-yellow-200 font-medium' : 'text-gray-300'}>
                        {isPrimary && '★ '}{p.PowerPlantName} (ID: {p.PowerPlantId})
                      </span>
                      <span className={hasKgup ? 'text-green-400' : 'text-gray-500'}>
                        {hasKgup ? 'KGÜP ✓' : 'KGÜP —'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* KGÜP values for primary plant */}
          {primaryPlant && primaryHasKgup && (
            <div>
              <div className="text-[10px] text-gray-400 mb-1">Ana santral KGUP (MWh):</div>
              <div className="grid grid-cols-12 gap-0.5 text-[9px]">
                {(primaryPlant.KgupValues || []).slice(0, 24).map((v, h) => (
                  <div key={h} className="text-center">
                    <div className="text-gray-500">{String(h).padStart(2, '0')}</div>
                    <div className={v !== 0 ? 'text-green-300' : 'text-gray-600'}>{v.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Component Editor (extracted for clarity) ---

interface ComponentEditorProps {
  comp: UEVCBComponent;
  companyId: number;
  companyPlantIds: number[];
  excludePlantIds: number[];
  onChange: (patch: Partial<UEVCBComponent>) => void;
  onRemove: () => void;
}

function ComponentEditor({ comp, companyId, companyPlantIds, excludePlantIds, onChange, onRemove }: ComponentEditorProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [testResult, setTestResult] = useState<{ loading: boolean; data?: any; error?: string } | null>(null);
  const [metricTestResult, setMetricTestResult] = useState<{ loading: boolean; data?: any; error?: string } | null>(null);

  const handleForecastChange = (field: string, value: any) => {
    onChange({ forecastPreference: { ...comp.forecastPreference, [field]: value } });
  };

  const metrics = Array.isArray(comp.monitoring?.metrics) ? comp.monitoring!.metrics : [];

  const updateMetrics = (newMetrics: Array<LabeledMetricMapping | BapSource>) => {
    onChange({ monitoring: { masternode: comp.monitoring?.masternode || '', metrics: newMetrics } });
  };

  const handleTestMetric = async (metric: LabeledMetricMapping) => {
    if (!comp.monitoring?.masternode || !metric.node || (!metric.nodeidentity && metric.nodeidentity !== 0)) {
      setMetricTestResult({ loading: false, error: 'Master node, node name and ID required.' });
      return;
    }

    setMetricTestResult({ loading: true });
    try {
      const res = await monitoringApi.testMetric(comp.monitoring.masternode, metric.node, metric.nodeidentity);
      setMetricTestResult({ loading: false, data: res });
    } catch (err: any) {
      setMetricTestResult({ loading: false, error: err.response?.data?.message || err.message || 'Metric api isteği başarısız oldu.' });
    }
  };

  const handleTestForecast = async () => {
    if (!comp.portalPlantId || !comp.forecastPreference.sourceName) {
      setTestResult({ loading: false, error: 'Lütfen önce portal santrali ve tahmin kaynağı girin.' });
      return;
    }

    setTestResult({ loading: true });

    try {
      const today = new Date();
      const formattedDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

      const res = await forecastApi.getValues({
        companyId,
        powerPlantId: comp.portalPlantId,
        provider: comp.forecastPreference.sourceName,
        startDate: formattedDate,
        endDate: formattedDate,
        minute: 0,
        hour: '12:30',
        columnId: [10],
      });

      setTestResult({ loading: false, data: res });
    } catch (err: any) {
      setTestResult({ loading: false, error: err.message || 'Forecast api isteği başarısız oldu.' });
    }
  };

  return (
    <div className="bg-dark-900 border border-gray-700 rounded-lg overflow-hidden">
      {/* Component header — always visible */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-dark-700 transition-colors"
        onClick={() => setExpanded(prev => !prev)}
      >
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs w-4">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="text-xs font-medium text-white">{comp.displayName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-dark-700 border border-gray-600 text-gray-400">{comp.type}</span>
          {comp.portalPlantId ? (
            <span className="text-xs text-gray-500">Plant: {comp.portalPlantId}</span>
          ) : null}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-gray-500 hover:text-red-400 text-xs px-2"
          title={t('common.remove')}
        >&#x2715;</button>
      </div>

      {/* Component body — collapsible */}
      {expanded && (
      <div className="p-4 pt-2 space-y-3">

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.compType')}</label>
          <select
            value={comp.type}
            onChange={(e) => onChange({ type: e.target.value as UEVCBComponentType })}
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          >
            <option value="BESS">BESS</option>
            <option value="SOLAR">SOLAR</option>
            <option value="WIND">WIND</option>
            <option value="HYDRO">HYDRO</option>
            <option value="THERMAL">THERMAL</option>
            <option value="LOAD">LOAD</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.displayName')}</label>
          <input
            value={comp.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <PlantSelector
            selectedPlantId={comp.portalPlantId || null}
            filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
            excludePlantIds={excludePlantIds}
            onSelect={(p) => onChange({ portalPlantId: p.id })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.forecastSource')}</label>
          <div className="flex items-center gap-2">
            <input
              value={comp.forecastPreference.sourceName}
              onChange={(e) => handleForecastChange('sourceName', e.target.value)}
              placeholder="e.g. OptBESS, EpiasForecast"
              className="flex-1 bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
            />
            <button
              onClick={handleTestForecast}
              className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium rounded transition-colors"
            >
              TEST
            </button>
          </div>
        </div>
      </div>

      {/* Schedule ID — only for BESS */}
      {comp.type === 'BESS' && (
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.scheduleId')}</label>
          <input
            value={comp.scheduleId || ''}
            onChange={(e) => onChange({ scheduleId: e.target.value })}
            placeholder="e.g. 3179 or UUID"
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white font-mono"
          />
        </div>
      )}

      {/* Schedule File Pattern — only for BESS */}
      {comp.type === 'BESS' && (
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.scheduleFilePattern')}</label>
          <input
            value={comp.scheduleFilePattern || ''}
            onChange={(e) => onChange({ scheduleFilePattern: e.target.value })}
            placeholder="Battery_Schedule_{UEVCB_ID}.csv"
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white font-mono"
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('assetMapping.scheduleFilePatternHelp')}</p>
        </div>
      )}

      {/* Monitoring Mapping */}
      <div className="border-t border-gray-700 pt-3">
        <h5 className="text-xs font-semibold text-gray-300 mb-2">{t('assetMapping.monitoringApi')}</h5>
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.masterNode')}</label>
          <input
            value={comp.monitoring?.masternode || ''}
            onChange={(e) => onChange({
              monitoring: { masternode: e.target.value, metrics }
            })}
            placeholder="e.g. SP01011071"
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="block text-xs text-gray-400">{t('assetMapping.metrics')}</label>
            <button
              onClick={() => updateMetrics([...metrics, { tag: 'Other', node: '', nodeidentity: 0 }])}
              className="text-primary-400 text-xs hover:text-primary-300"
            >{t('assetMapping.addMetric')}</button>
          </div>

          {metrics.length === 0 && (
            <p className="text-xs text-gray-500 italic">{t('assetMapping.noMetrics')}</p>
          )}

          {metrics.map((metric, mIdx) => (
            <div key={mIdx} className="bg-dark-800 p-3 rounded border border-gray-700 relative flex flex-col gap-3">
              <button
                onClick={() => { const m = [...metrics]; m.splice(mIdx, 1); updateMetrics(m); }}
                className="absolute top-2 right-2 text-gray-500 hover:text-red-400 text-xs"
              >&#x2715;</button>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">{t('assetMapping.metricType')}</label>
                <div className="flex items-center gap-2">
                  <select
                    className="w-48 bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                    value={'source' in metric ? 'response.data.bap' : metric.tag || 'Other'}
                    onChange={(e) => {
                      const m = [...metrics];
                      if (e.target.value === 'response.data.bap') {
                        m[mIdx] = { tag: 'ActivePower', source: 'response.data.bap' };
                      } else {
                        m[mIdx] = { tag: e.target.value as any, node: '', nodeidentity: 0 };
                      }
                      updateMetrics(m);
                    }}
                  >
                    <option value="SoC">{t('assetMapping.metricSoc')}</option>
                    <option value="ActivePower">{t('assetMapping.metricActivePower')}</option>
                    <option value="Power">{t('assetMapping.metricPower')}</option>
                    <option value="Other">{t('assetMapping.metricOther')}</option>
                    <option value="response.data.bap">{t('assetMapping.metricBapFromSoc')}</option>
                  </select>

                  {'tag' in metric && metric.tag === 'Other' && (
                    <input
                      placeholder={t('assetMapping.customLabel')}
                      className="flex-1 bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                      value={('customLabel' in metric) ? metric.customLabel || '' : ''}
                      onChange={(e) => {
                        const m = [...metrics] as any[];
                        m[mIdx].customLabel = e.target.value;
                        updateMetrics(m);
                      }}
                    />
                  )}
                </div>
              </div>

              {!('source' in metric) && (
                <div className="flex gap-4">
                  <div className="flex-[2]">
                    <label className="block text-xs font-semibold text-gray-400 mb-1">{t('assetMapping.nodeName')}</label>
                    <input
                      placeholder="e.g. Total Soc"
                      className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                      value={'node' in metric ? metric.node : ''}
                      onChange={(e) => {
                        const m = [...metrics] as any[];
                        m[mIdx].node = e.target.value;
                        updateMetrics(m);
                      }}
                    />
                  </div>
                  <div className="flex-[1]">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-semibold text-gray-400">{t('assetMapping.nodeId')}</label>
                      <button
                        onClick={() => handleTestMetric(metric as LabeledMetricMapping)}
                        className="bg-primary-600 hover:bg-primary-700 text-white text-[10px] px-2 py-0.5 rounded shadow"
                      >
                        TEST
                      </button>
                    </div>
                    <input
                      type="number"
                      placeholder="e.g. 3500"
                      className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                      value={'nodeidentity' in metric ? metric.nodeidentity : 0}
                      onChange={(e) => {
                        const m = [...metrics] as any[];
                        m[mIdx].nodeidentity = parseInt(e.target.value) || 0;
                        updateMetrics(m);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      </div>
      )}

      {/* Test Result Popup */}
      {testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-dark-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-dark-900 border-b border-gray-700">
              <h3 className="text-sm font-medium text-white">Forecast Test Result (minute=0)</h3>
              <button
                onClick={() => setTestResult(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 text-xs">
              {testResult.loading ? (
                <div className="flex justify-center py-8 text-primary-400 whitespace-nowrap">Testing...</div>
              ) : testResult.error ? (
                <div className="text-red-400 whitespace-pre-wrap">{testResult.error}</div>
              ) : (
                <pre className="text-gray-300 font-mono whitespace-pre-wrap">
                  {JSON.stringify(testResult.data, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-700 flex justify-end">
              <button
                onClick={() => setTestResult(null)}
                className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metric Test Result Popup */}
      {metricTestResult && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-dark-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-dark-900 border-b border-gray-700">
              <h3 className="text-sm font-medium text-white">Monitoring Metric Test Result (Last 1 min)</h3>
              <button
                onClick={() => setMetricTestResult(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto flex-1 text-xs">
              {metricTestResult.loading ? (
                <div className="flex justify-center py-8 text-primary-400 whitespace-nowrap">Testing...</div>
              ) : metricTestResult.error ? (
                <div className="text-red-400 whitespace-pre-wrap">{metricTestResult.error}</div>
              ) : (
                <pre className="text-gray-300 font-mono whitespace-pre-wrap">
                  {JSON.stringify(metricTestResult.data, null, 2)}
                </pre>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-700 flex justify-end">
              <button
                onClick={() => setMetricTestResult(null)}
                className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
