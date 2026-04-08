import { useState, useEffect, useMemo } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { PlantSelector } from './PlantSelector';
import { AutoMappingButton } from './AutoMappingButton';
import {
  AssetMapping, CompanyMapping, GridConnectionPoint, GcpComponent,
  LabeledMetricMapping, BapSource, ComponentType,
  migrateAssetMapping,
} from '@shared/types/assetMapping.types';
import { ExtensionAttributes } from '@shared/types/attributes.types';
import { getDefinitionsForScope, mergeDefinitions } from '@shared/constants/attributeDefinitions';
import { configApi } from '../../api/config.api';

export function AssetMappingForm() {
  const { profile, updateProfile } = useProfile();
  const { companies: portalCompanies, plants: portalPlants } = useAuth();
  const { t } = useLocale();

  // Merged attribute definitions (system seed + custom from profile)
  const allDefs = useMemo(() => mergeDefinitions(profile?.customAttributeDefinitions), [profile?.customAttributeDefinitions]);

  // Local edit state
  const [companies, setCompanies] = useState<CompanyMapping[]>([]);
  const [ftpDirection, setFtpDirection] = useState<'incoming' | 'outgoing'>('incoming');
  const [ftpFilename, setFtpFilename] = useState('Technical_Parameters.csv');

  // Fold/unfold state
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set());
  const [expandedGcps, setExpandedGcps] = useState<Set<number>>(new Set());
  const [expandedComponents, setExpandedComponents] = useState<Set<number>>(new Set());

  // Inline GCP creation form state per company
  const [newGcpForm, setNewGcpForm] = useState<Record<number, { id: string; name: string }>>({});

  const toggleComponents = (gcpId: number) => {
    setExpandedComponents(prev => {
      const next = new Set(prev);
      if (next.has(gcpId)) next.delete(gcpId);
      else next.add(gcpId);
      return next;
    });
  };

  // Save status
  const [isSaved, setIsSaved] = useState(false);

  // Clear all confirm dialog
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCompanies = useMemo(() => {
    if (!searchQuery.trim()) return companies;
    const q = searchQuery.toLowerCase();
    return companies.filter(company => {
      if (company.companyName.toLowerCase().includes(q)) return true;
      return company.gridConnectionPoints.some(gcp => {
        if (gcp.name.toLowerCase().includes(q)) return true;
        return gcp.components.some(comp => comp.displayName.toLowerCase().includes(q));
      });
    });
  }, [companies, searchQuery]);

  // Load from profile
  useEffect(() => {
    if (profile?.assetMapping) {
      const migrated = migrateAssetMapping(profile.assetMapping);
      setCompanies(migrated.companies || []);
      setFtpDirection(migrated.ftpDirection || 'incoming');
      setFtpFilename(migrated.ftpFilename || 'Technical_Parameters.csv');
      // Keep sections collapsed by default on load
      setExpandedCompanies(new Set());
      setExpandedGcps(new Set());
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
      gridConnectionPoints: [],
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

  // --- GCP operations ---
  const handleAddGcp = (companyIdx: number) => {
    const company = companies[companyIdx];
    const form = newGcpForm[company.companyId];
    if (!form?.id || !form?.name) return;
    const gcpId = parseInt(form.id, 10);
    if (isNaN(gcpId)) return;

    const newGcp: GridConnectionPoint = {
      id: gcpId,
      name: form.name,
      timezone: company.timezone,
      components: [],
    };
    const updated = [...companies];
    updated[companyIdx] = {
      ...updated[companyIdx],
      gridConnectionPoints: [...updated[companyIdx].gridConnectionPoints, newGcp],
    };
    setCompanies(updated);
    setExpandedGcps(prev => new Set(prev).add(gcpId));
    setNewGcpForm(prev => ({ ...prev, [company.companyId]: { id: '', name: '' } }));
  };

  const handleRemoveGcp = (companyIdx: number, gcpIdx: number) => {
    const updated = [...companies];
    updated[companyIdx] = {
      ...updated[companyIdx],
      gridConnectionPoints: updated[companyIdx].gridConnectionPoints.filter((_, i) => i !== gcpIdx),
    };
    setCompanies(updated);
  };

  const toggleGcp = (gcpId: number) => {
    setExpandedGcps(prev => {
      const next = new Set(prev);
      if (next.has(gcpId)) next.delete(gcpId);
      else next.add(gcpId);
      return next;
    });
  };

  const updateGcp = (companyIdx: number, gcpIdx: number, patch: Partial<GridConnectionPoint>) => {
    const updated = [...companies];
    const gcps = [...updated[companyIdx].gridConnectionPoints];
    gcps[gcpIdx] = { ...gcps[gcpIdx], ...patch };
    updated[companyIdx] = { ...updated[companyIdx], gridConnectionPoints: gcps };
    setCompanies(updated);
  };

  // --- Component operations ---
  const handleAddComponent = (companyIdx: number, gcpIdx: number) => {
    const newComp: GcpComponent = {
      componentId: `COMP_${Date.now()}`,
      type: 'BESS',
      displayName: 'New Asset',
      portalPlantId: 0,
      forecastPreference: { sourceName: 'FinalForecast', beforeMinutes: 0 },
    };
    updateGcp(companyIdx, gcpIdx, {
      components: [...companies[companyIdx].gridConnectionPoints[gcpIdx].components, newComp],
    });
  };

  const handleRemoveComponent = (companyIdx: number, gcpIdx: number, compIdx: number) => {
    const comps = companies[companyIdx].gridConnectionPoints[gcpIdx].components.filter((_, i) => i !== compIdx);
    updateGcp(companyIdx, gcpIdx, { components: comps });
  };

  const updateComponent = (companyIdx: number, gcpIdx: number, compIdx: number, patch: Partial<GcpComponent>) => {
    const comps = [...companies[companyIdx].gridConnectionPoints[gcpIdx].components];
    comps[compIdx] = { ...comps[compIdx], ...patch };
    updateGcp(companyIdx, gcpIdx, { components: comps });
  };

  // --- Auto Mapping ---
  const handleMappingComplete = () => {
    window.location.reload();
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

  // --- Clear all ---
  const handleClearAll = async () => {
    if (!profile) return;
    const cleared = { ...profile, assetMapping: { companies: [], ftpDirection, ftpFilename } };
    setCompanies([]);
    setShowClearConfirm(false);
    try {
      await configApi.saveProfile(cleared, true /* forceMapping */);
    } catch (err) {
      console.error('[AssetMappingForm] clearAll failed:', err);
    }
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

        {/* Search */}
        {companies.length > 0 && (
          <div>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('assetMapping.searchPlaceholder')}
              className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-500"
            />
          </div>
        )}

        {/* Company panels */}
        {filteredCompanies.map((company, cIdx) => {
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
                  <span className="text-xs text-gray-500">| {company.gridConnectionPoints.length} GCP</span>
                  <span className="text-xs text-gray-500">| {company.timezone}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveCompany(company.companyId); }}
                    className="text-gray-500 hover:text-red-400 text-xs px-2"
                    title={t('assetMapping.removeCompany')}
                  >{t('assetMapping.removeCompany')}</button>
                </div>
              </div>

              {/* Company body */}
              {isExpanded && (
                <div className="p-4 space-y-4 bg-dark-800">
                  {/* Add GCP — inline form */}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder={t('assetMapping.gcpIdPlaceholder')}
                      value={newGcpForm[company.companyId]?.id || ''}
                      onChange={(e) => setNewGcpForm(prev => ({
                        ...prev,
                        [company.companyId]: { ...prev[company.companyId], id: e.target.value, name: prev[company.companyId]?.name || '' }
                      }))}
                      className="w-32 bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      type="text"
                      placeholder={t('assetMapping.gcpNamePlaceholder')}
                      value={newGcpForm[company.companyId]?.name || ''}
                      onChange={(e) => setNewGcpForm(prev => ({
                        ...prev,
                        [company.companyId]: { ...prev[company.companyId], name: e.target.value, id: prev[company.companyId]?.id || '' }
                      }))}
                      className="flex-1 bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      onClick={() => handleAddGcp(cIdx)}
                      className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >{t('assetMapping.addGcp')}</button>
                  </div>

                  {/* GCP panels */}
                  {company.gridConnectionPoints.map((gcp, gIdx) => {
                    const isGcpExpanded = expandedGcps.has(gcp.id);
                    return (
                      <div key={gcp.id} className="border border-gray-700 rounded-lg overflow-hidden">
                        {/* GCP header */}
                        <div
                          className="flex items-center justify-between px-4 py-2 bg-dark-900 cursor-pointer hover:bg-dark-700 transition-colors"
                          onClick={() => toggleGcp(gcp.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs w-4">{isGcpExpanded ? '\u25BC' : '\u25B6'}</span>
                            <span className="text-sm text-gray-200">{gcp.name}</span>
                            <span className="text-xs text-gray-500">ID: {gcp.id}</span>
                            <span className="text-xs text-gray-500">| {gcp.components.length} comp</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveGcp(cIdx, gIdx); }}
                              className="text-gray-500 hover:text-red-400 text-xs px-2"
                              title={t('common.remove')}
                            >{t('common.remove')}</button>
                          </div>
                        </div>

                        {/* GCP body */}
                        {isGcpExpanded && (
                          <div className="p-4 space-y-4">
                            {/* GCP metadata */}
                            <div className="flex items-center gap-4">
                              <div className="flex-1">
                                <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.gcpName')}</label>
                                <input
                                  value={gcp.name}
                                  onChange={(e) => updateGcp(cIdx, gIdx, { name: e.target.value })}
                                  className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white"
                                />
                              </div>
                            </div>

                            {/* GCP Technical Attributes */}
                            <AttributeEditor
                              attributes={gcp.attributes ?? {}}
                              scope="GCP"
                              allDefs={allDefs}
                              onChange={(attrs) => updateGcp(cIdx, gIdx, { attributes: attrs })}
                            />

                            {/* Components — collapsible */}
                            <div className="border-t border-gray-700 pt-3">
                              <div
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => toggleComponents(gcp.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs w-4">{expandedComponents.has(gcp.id) ? '\u25BC' : '\u25B6'}</span>
                                  <h5 className="text-xs font-medium text-gray-300">
                                    {t('assetMapping.components')}
                                    <span className="text-gray-500 ml-1">({gcp.components.length})</span>
                                  </h5>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAddComponent(cIdx, gIdx); }}
                                  className="bg-dark-700 hover:bg-dark-600 text-primary-400 text-xs font-medium px-3 py-1 rounded border border-gray-600 transition-colors"
                                >{t('assetMapping.addComponent')}</button>
                              </div>

                              {expandedComponents.has(gcp.id) && (
                                <div className="mt-3">
                                  {gcp.components.length === 0 && (
                                    <p className="text-xs text-gray-500 italic">{t('assetMapping.noComponents')}</p>
                                  )}

                                  <div className="space-y-4">
                                    {gcp.components.map((comp, compIdx) => (
                                      <ComponentEditor
                                        key={comp.componentId}
                                        comp={comp}
                                        companyPlantIds={companyPlantIds}
                                        excludePlantIds={gcp.components.filter((_, i) => i !== compIdx).map(c => c.generation?.portalPlantId ?? c.consumption?.portalPlantId ?? c.portalPlantId).filter((id): id is number => !!id)}
                                        allDefs={allDefs}
                                        onChange={(patch) => updateComponent(cIdx, gIdx, compIdx, patch)}
                                        onRemove={() => handleRemoveComponent(cIdx, gIdx, compIdx)}
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

                  {company.gridConnectionPoints.length === 0 && (
                    <p className="text-xs text-gray-500 italic">{t('assetMapping.noGcps')}</p>
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
          <AutoMappingButton
            companies={companies}
            onMappingComplete={handleMappingComplete}
          />
          <button
            onClick={handleSave}
            className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-6 py-2 rounded-lg transition-colors"
          >{t('assetMapping.saveMapping')}</button>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="bg-red-700 hover:bg-red-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >{t('assetMapping.clearAll')}</button>
          {isSaved && (
            <span className="text-green-400 text-sm font-medium animate-pulse">{t('assetMapping.saved')}</span>
          )}
        </div>
      </div>

      {/* Clear All Confirm Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-dark-800 border border-gray-600 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-3">{t('assetMapping.clearAllConfirmTitle')}</h3>
            <p className="text-gray-300 text-sm mb-6">{t('assetMapping.clearAllConfirmBody')}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-gray-600 rounded-lg transition-colors"
              >{t('common.cancel')}</button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-800 text-white rounded-lg transition-colors"
              >{t('assetMapping.clearAll')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// --- Component Editor (extracted for clarity) ---

interface ComponentEditorProps {
  comp: GcpComponent;
  companyPlantIds: number[];
  excludePlantIds: number[];
  allDefs: import('@shared/types/attributes.types').AttributeDefinition[];
  onChange: (patch: Partial<GcpComponent>) => void;
  onRemove: () => void;
}

function ComponentEditor({ comp, companyPlantIds, excludePlantIds, allDefs, onChange, onRemove }: ComponentEditorProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  const handleForecastChange = (field: string, value: any) => {
    onChange({ forecastPreference: { ...comp.forecastPreference, [field]: value } });
  };

  const metrics = Array.isArray(comp.monitoring?.metrics) ? comp.monitoring!.metrics : [];

  const updateMetrics = (newMetrics: Array<LabeledMetricMapping | BapSource>) => {
    onChange({ monitoring: { masternode: comp.monitoring?.masternode || '', metrics: newMetrics } });
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
          {(comp.portalPlantId || comp.generation?.portalPlantId || comp.consumption?.portalPlantId) ? (
            <span className="text-xs text-gray-500">
              {comp.portalPlantId
                ? `Plant: ${comp.portalPlantId}`
                : [
                    comp.generation  && `Gen: ${comp.generation.portalPlantId}`,
                    comp.consumption && `Con: ${comp.consumption.portalPlantId}`,
                  ].filter(Boolean).join(' / ')
              }
            </span>
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
            onChange={(e) => onChange({ type: e.target.value as ComponentType })}
            className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          >
            <option value="BESS">BESS</option>
            <option value="SOLAR">SOLAR</option>
            <option value="WIND">WIND</option>
            <option value="HYDRO">HYDRO</option>
            <option value="THERMAL">THERMAL</option>
            <option value="LOAD">LOAD</option>
            <option value="CONSUMPTION">CONSUMPTION</option>
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

      {/* Portal Plant Mapping */}
      <div className="border border-gray-700 rounded-lg p-3 mb-3 space-y-2">
        <p className="text-[10px] text-gray-500 italic">{t('assetMapping.plantMappingNote')}</p>

        <PlantSelector
          label={t('assetMapping.directPlant')}
          selectedPlantId={comp.portalPlantId ?? null}
          filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
          excludePlantIds={excludePlantIds}
          onSelect={(p) => onChange({ portalPlantId: p.id })}
          onClear={() => onChange({ portalPlantId: undefined })}
        />

        {comp.type !== 'CONSUMPTION' && (
          <PlantSelector
            label={t('assetMapping.generationPlant')}
            selectedPlantId={comp.generation?.portalPlantId ?? null}
            filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
            excludePlantIds={excludePlantIds}
            onSelect={(p) => onChange({
              generation: { ...(comp.generation ?? {}), portalPlantId: p.id },
            })}
            onClear={() => onChange({ generation: undefined })}
          />
        )}

        <PlantSelector
          label={t('assetMapping.consumptionPlant')}
          selectedPlantId={comp.consumption?.portalPlantId ?? null}
          filterPlantIds={companyPlantIds.length > 0 ? companyPlantIds : undefined}
          excludePlantIds={excludePlantIds}
          onSelect={(p) => onChange({
            consumption: { ...(comp.consumption ?? {}), portalPlantId: p.id },
          })}
          onClear={() => onChange({ consumption: undefined })}
        />
      </div>

      {/* Forecast Source */}
      <div className="mb-3">
        <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.forecastSource')}</label>
        <input
          value={comp.forecastPreference.sourceName}
          onChange={(e) => handleForecastChange('sourceName', e.target.value)}
          placeholder="e.g. OptBESS, EpiasForecast"
          className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
        />
      </div>

      {/* Schedule ID — shown for all component types */}
      <div className="mb-3">
        <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.scheduleId')}</label>
        <input
          value={comp.scheduleId || ''}
          onChange={(e) => onChange({ scheduleId: e.target.value })}
          placeholder="e.g. 3179 or UUID"
          className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white font-mono"
        />
      </div>

      {/* Schedule File Pattern — shown for all component types */}
      <div className="mb-3">
        <label className="block text-xs text-gray-400 mb-1">{t('assetMapping.scheduleFilePattern')}</label>
        <input
          value={comp.scheduleFilePattern || ''}
          onChange={(e) => onChange({ scheduleFilePattern: e.target.value })}
          placeholder="Battery_Schedule_{GCP_ID}.csv"
          className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white font-mono"
        />
        <p className="text-[10px] text-gray-500 mt-1">{t('assetMapping.scheduleFilePatternHelp')}</p>
      </div>

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
                    <label className="block text-xs font-semibold text-gray-400 mb-1">{t('assetMapping.nodeId')}</label>
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

      {/* Component Technical Attributes */}
      <AttributeEditor
        attributes={comp.attributes ?? {}}
        scope="COMPONENT"
        componentType={comp.type}
        allDefs={allDefs}
        onChange={(attrs) => onChange({ attributes: attrs })}
      />

      </div>
      )}
    </div>
  );
}

/** Editable attribute fields for an entity, filtered by scope and component type */
function AttributeEditor({ attributes, scope, componentType, allDefs, onChange }: {
  attributes: ExtensionAttributes;
  scope: 'GCP' | 'COMPONENT' | 'SUBCOMPONENT';
  componentType?: ComponentType;
  allDefs: import('@shared/types/attributes.types').AttributeDefinition[];
  onChange: (attrs: ExtensionAttributes) => void;
}) {
  const { t } = useLocale();
  const definitions = getDefinitionsForScope(allDefs, scope, componentType);
  if (definitions.length === 0) return null;

  const handleChange = (key: string, raw: string, dataType: string) => {
    const updated = { ...attributes };
    if (raw === '') {
      delete updated[key];
    } else if (dataType === 'number') {
      const n = parseFloat(raw);
      updated[key] = isNaN(n) ? null : n;
    } else if (dataType === 'boolean') {
      updated[key] = raw === 'true';
    } else {
      updated[key] = raw;
    }
    onChange(updated);
  };

  // Group by def.group
  const groups = new Map<string, typeof definitions>();
  for (const def of definitions) {
    const list = groups.get(def.group) || [];
    list.push(def);
    groups.set(def.group, list);
  }

  return (
    <div className="border-t border-gray-700 pt-2">
      <h5 className="text-xs font-medium text-gray-400 mb-2">{t('assetMapping.technicalAttributes')}</h5>
      {Array.from(groups.entries()).map(([group, defs]) => (
        <div key={group} className="mb-2">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{t(`attrGroup.${group}` as any)}</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-1">
            {defs.map(def => (
              <div key={def.key}>
                <label className="block text-[10px] text-gray-500 mb-0.5">
                  {t(def.labelKey as any)}
                  {def.unit && <span className="text-gray-600 ml-1">({def.unit})</span>}
                </label>
                {def.dataType === 'boolean' ? (
                  <select
                    value={attributes[def.key] != null ? String(attributes[def.key]) : ''}
                    onChange={(e) => handleChange(def.key, e.target.value, def.dataType)}
                    className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="">—</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : def.dataType === 'enum' && def.enumValues ? (
                  <select
                    value={attributes[def.key] != null ? String(attributes[def.key]) : ''}
                    onChange={(e) => handleChange(def.key, e.target.value, def.dataType)}
                    className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="">—</option>
                    {def.enumValues.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input
                    type={def.dataType === 'number' ? 'number' : 'text'}
                    step={def.dataType === 'number' ? 'any' : undefined}
                    value={attributes[def.key] != null ? String(attributes[def.key]) : ''}
                    onChange={(e) => handleChange(def.key, e.target.value, def.dataType)}
                    className="w-full bg-dark-700 border border-gray-600 rounded px-2 py-1 text-xs text-white"
                    placeholder="—"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
