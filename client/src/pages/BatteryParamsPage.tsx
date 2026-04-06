import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useProfile } from '../context/ProfileContext';
import { ftpApi } from '../api/ftp.api';
import { MultiBatteryTechParams } from '@shared/types/techParams.types';
import { BatteryParamsEditor } from '../components/battery-params/BatteryParamsEditor';
import { useLocale } from '../context/LocaleContext';

interface BessItem {
  plantId: number;          // component's own portalPlantId
  parentPlantId: number;    // GCP's numeric id (matched via Asset_ID in CSV)
  csvColumnKey: string | null; // CSV column key (e.g. "Oze_3179"), resolved after CSV load
  displayName: string;
  gcpName: string;
}

export function BatteryParamsPage() {
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;
  const { t } = useLocale();

  // Extract BESS components from asset mapping
  const bessList = useMemo<BessItem[]>(() => {
    if (!mapping?.companies) return [];
    const result: BessItem[] = [];
    for (const company of mapping.companies) {
      for (const gcp of company.gridConnectionPoints) {
        for (const comp of gcp.components) {
          if (comp.type === 'BESS' && comp.portalPlantId > 0) {
            result.push({
              plantId: comp.portalPlantId,
              parentPlantId: gcp.id,
              csvColumnKey: null, // resolved after CSV loads
              displayName: comp.displayName,
              gcpName: gcp.name,
            });
          }
        }
      }
    }
    return result;
  }, [mapping]);

  const [multiParams, setMultiParams] = useState<MultiBatteryTechParams | null>(null);
  const [selectedCsvKey, setSelectedCsvKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Build a map: parentPlantId -> CSV column key using Asset_ID row
  const plantToCsvKey = useMemo<Record<number, string>>(() => {
    if (!multiParams) return {};
    const map: Record<number, string> = {};
    for (const colKey of multiParams.plantIds) {
      const assetId = multiParams.rawByPlant[colKey]?.['Asset_ID'];
      if (assetId !== undefined) {
        map[Number(assetId)] = colKey;
      }
    }
    return map;
  }, [multiParams]);

  // Resolve csvColumnKey on bessList items after CSV loads
  const resolvedBessList = useMemo(() => {
    return bessList.map(b => ({
      ...b,
      csvColumnKey: plantToCsvKey[b.parentPlantId] ?? null,
    }));
  }, [bessList, plantToCsvKey]);

  // Auto-select first BESS that has CSV data
  useEffect(() => {
    if (!selectedCsvKey && resolvedBessList.length > 0) {
      const withData = resolvedBessList.find(b => b.csvColumnKey !== null);
      if (withData?.csvColumnKey) {
        setSelectedCsvKey(withData.csvColumnKey);
      }
    }
  }, [resolvedBessList, selectedCsvKey]);

  const ftpDirection = mapping?.ftpDirection ?? 'incoming';
  const ftpFilename = mapping?.ftpFilename ?? 'Technical_Parameters.csv';

  const loadParams = useCallback(async () => {
    if (!mapping) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ftpApi.readMultiTechParams(ftpDirection, ftpFilename);
      setMultiParams(result.parsed);
      setDirty(false);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || t('batteryParams.loadFailed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mapping, ftpDirection, ftpFilename, t]);

  // Load params on mount
  useEffect(() => {
    loadParams();
  }, [loadParams]);

  const handleParamChange = useCallback((variableKey: string, value: string | number) => {
    if (!multiParams || !selectedCsvKey) return;
    setMultiParams(prev => {
      if (!prev) return prev;
      const updatedRaw = { ...prev.rawByPlant };
      updatedRaw[selectedCsvKey] = { ...updatedRaw[selectedCsvKey], [variableKey]: value };
      return { ...prev, rawByPlant: updatedRaw };
    });
    setDirty(true);
  }, [multiParams, selectedCsvKey]);

  const handleSave = useCallback(async () => {
    if (!multiParams || !mapping) return;
    setSaving(true);
    try {
      await ftpApi.writeMultiTechParams(ftpDirection, ftpFilename, multiParams);
      setDirty(false);
      toast.success(t('batteryParams.paramsSaved'));
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || t('common.saveFailed');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [multiParams, mapping, ftpDirection, ftpFilename, t]);

  const handleDiscard = useCallback(() => {
    loadParams();
  }, [loadParams]);

  const selectedRawParams = selectedCsvKey && multiParams?.rawByPlant[selectedCsvKey]
    ? multiParams.rawByPlant[selectedCsvKey]
    : null;

  const selectedBessItem = resolvedBessList.find(b => b.csvColumnKey === selectedCsvKey);

  // No mapping configured
  if (!mapping) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryParams.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">
            {t('common.configureMapping')}
          </p>
        </div>
      </div>
    );
  }

  // No BESS components
  if (resolvedBessList.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryParams.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">
            {t('batteryParams.noBess')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">{t('batteryParams.title')}</h2>
        <button
          onClick={loadParams}
          disabled={loading}
          className="text-xs text-primary-400 hover:text-primary-300 transition-colors disabled:text-gray-600"
        >
          &#8635; {t('common.refresh')}
        </button>
      </div>

      {/* Battery selector */}
      <div className="mb-6">
        <span className="text-xs text-gray-500 block mb-2">{t('batteryParams.batteries')}</span>
        <div className="flex flex-wrap gap-2">
          {resolvedBessList.map(bess => {
            const csvKey = bess.csvColumnKey;
            const isSelected = csvKey === selectedCsvKey;
            const hasData = csvKey !== null && multiParams?.rawByPlant[csvKey] !== undefined;
            return (
              <button
                key={`${bess.plantId}-${bess.parentPlantId}`}
                onClick={() => csvKey && setSelectedCsvKey(csvKey)}
                disabled={!csvKey}
                className={`text-left px-4 py-2.5 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-primary-600/20 border-primary-500 text-primary-300'
                    : csvKey
                      ? 'bg-dark-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      : 'bg-dark-800 border-gray-700 text-gray-600 cursor-not-allowed'
                }`}
              >
                <div className="text-sm font-medium">{bess.displayName}</div>
                <div className="text-xs opacity-60 mt-0.5">
                  {bess.gcpName} &middot; {t('schedule.plant')}: {bess.parentPlantId}
                  {!hasData && multiParams && !csvKey && (
                    <span className="ml-1 text-yellow-500">({t('batteryParams.notInCsv')})</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-orange-900/30 border border-orange-700 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-orange-300 text-sm">{error}</span>
          <button
            onClick={loadParams}
            className="text-orange-300 hover:text-orange-200 text-xs underline ml-4"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('batteryParams.loadingParams')}</p>
        </div>
      )}

      {/* Params editor */}
      {!loading && selectedRawParams && selectedBessItem && multiParams && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            {t('batteryParams.techParams')} &mdash; {selectedBessItem.displayName}
          </h3>

          <BatteryParamsEditor
            rawParams={selectedRawParams}
            variableOrder={multiParams.variableOrder}
            onChange={handleParamChange}
          />

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            {dirty && (
              <button
                onClick={handleDiscard}
                className="text-sm text-gray-400 hover:text-gray-300 transition-colors"
              >
                {t('common.discard')}
              </button>
            )}
            {dirty && (
              <span className="text-xs text-yellow-500">{t('common.unsavedChanges')}</span>
            )}
          </div>
        </div>
      )}

      {/* No data for selected plant */}
      {!loading && !error && multiParams && selectedCsvKey && !selectedRawParams && (
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">
            {t('batteryParams.noDataInCsv')} ({selectedCsvKey}).
          </p>
        </div>
      )}
    </div>
  );
}
