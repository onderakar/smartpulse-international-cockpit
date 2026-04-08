import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useProfile } from '../context/ProfileContext';
import { ftpApi } from '../api/ftp.api';
import { MultiBatteryTechParams } from '@shared/types/techParams.types';
import { useLocale } from '../context/LocaleContext';

export function BatteryParamsPage() {
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;
  const { t } = useLocale();

  const [multiParams, setMultiParams] = useState<MultiBatteryTechParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ftpDirection = mapping?.ftpDirection ?? 'incoming';
  const ftpFilename = mapping?.ftpFilename ?? 'Technical_Parameters.csv';

  const loadParams = useCallback(async () => {
    if (!mapping) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ftpApi.readMultiTechParams(ftpDirection, ftpFilename);
      setMultiParams(result.parsed);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || t('batteryParams.loadFailed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mapping, ftpDirection, ftpFilename, t]);

  useEffect(() => {
    loadParams();
  }, [loadParams]);

  const handleSyncAttributes = useCallback(async () => {
    if (!mapping) return;
    setSyncing(true);
    try {
      const result = await ftpApi.syncAttributes(ftpDirection, ftpFilename);
      toast.success(t('batteryParams.attrSynced', { gcps: String(result.gcpsUpdated), comps: String(result.componentsUpdated) }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [mapping, ftpDirection, ftpFilename, t]);

  // Column letters (A, B, C, ...) for Excel-style header
  const colLetters = useMemo(() => {
    if (!multiParams) return [];
    return multiParams.plantIds.map((_, i) => {
      let letter = '';
      let n = i;
      do {
        letter = String.fromCharCode(65 + (n % 26)) + letter;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      return letter;
    });
  }, [multiParams]);

  if (!mapping) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryParams.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('common.configureMapping')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-[1600px] mx-auto flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1e1e34] border border-[#2d2d4a] rounded-md px-3 py-1.5">
            <i className="ri-file-excel-2-line text-emerald-400 text-sm" />
            <span className="text-xs text-gray-300 font-medium">{ftpFilename}</span>
          </div>
          {multiParams && (
            <span className="text-[10px] text-gray-500">
              {multiParams.plantIds.length} {t('batteryParams.batteries')} &times; {multiParams.variableOrder.length} {t('batteryParams.variables')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncAttributes}
            disabled={syncing || !multiParams}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className="ri-database-2-line text-sm" />
            {syncing ? t('common.saving') : t('batteryParams.syncAttributes')}
          </button>
          <button
            onClick={loadParams}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-[#1e1e34] border border-[#2d2d4a] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className="ri-refresh-line text-sm" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-orange-900/20 border border-orange-800/40 rounded-md px-4 py-2.5 mb-3 flex items-center justify-between shrink-0">
          <span className="text-orange-300 text-xs">{error}</span>
          <button onClick={loadParams} className="text-orange-400 hover:text-orange-300 text-xs underline ml-4">{t('common.retry')}</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-md p-12 text-center">
          <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-400 rounded-full animate-spin mb-2" />
          <p className="text-gray-500 text-xs">{t('batteryParams.loadingParams')}</p>
        </div>
      )}

      {/* Spreadsheet Table */}
      {!loading && multiParams && multiParams.variableOrder.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-[#2d2d4a] bg-[#12121e] shadow-xl select-text"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d2d4a #12121e' }}
        >
          <table className="w-full border-collapse" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif", fontSize: '11px' }}>
            {/* Column letter row (A, B, C...) */}
            <thead className="sticky top-0 z-20">
              {/* Letter row */}
              <tr>
                <th className="sticky left-0 z-30 bg-[#191930] border-b border-r border-[#2d2d4a] w-[40px] min-w-[40px]" />
                <th className="sticky left-[40px] z-30 bg-[#191930] border-b border-r border-[#2d2d4a] min-w-[240px]" />
                {multiParams.plantIds.map((_, i) => (
                  <th key={i} className="bg-[#191930] text-center px-1 py-1 text-[9px] text-gray-600 font-normal border-b border-r border-[#2d2d4a] min-w-[130px]">
                    {colLetters[i]}
                  </th>
                ))}
              </tr>
              {/* Header row with plant names */}
              <tr>
                <th className="sticky left-0 z-30 bg-[#1c1c35] border-b border-r border-[#2d2d4a] text-center text-[9px] text-gray-600 font-normal py-1.5 w-[40px] min-w-[40px]">
                  #
                </th>
                <th className="sticky left-[40px] z-30 bg-[#1c1c35] text-left px-3 py-1.5 text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-r border-[#2d2d4a] min-w-[240px]">
                  Variable
                </th>
                {multiParams.plantIds.map(plantId => (
                  <th
                    key={plantId}
                    className="bg-[#1c1c35] text-center px-3 py-1.5 text-[10px] text-emerald-400/80 font-semibold border-b border-r border-[#2d2d4a] min-w-[130px] whitespace-nowrap"
                  >
                    {plantId}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {multiParams.variableOrder.map((variable, rowIdx) => {
                const bgColor = rowIdx % 2 === 0 ? '#14142a' : '#171730';
                return (
                  <tr key={variable} className="group hover:!bg-[#1e1e42] transition-colors duration-75">
                    {/* Row number */}
                    <td
                      className="sticky left-0 z-10 text-center py-[5px] text-[9px] text-gray-600 border-b border-r border-[#2d2d4a] select-none"
                      style={{ backgroundColor: bgColor }}
                    >
                      {rowIdx + 1}
                    </td>
                    {/* Variable name */}
                    <td
                      className="sticky left-[40px] z-10 px-3 py-[5px] text-gray-300 font-medium border-b border-r border-[#2d2d4a] whitespace-nowrap group-hover:text-white"
                      style={{ backgroundColor: bgColor }}
                    >
                      {variable}
                    </td>
                    {/* Values */}
                    {multiParams.plantIds.map(plantId => {
                      const val = multiParams.rawByPlant[plantId]?.[variable];
                      const display = val !== undefined && val !== null ? String(val) : '';
                      const isNum = display !== '' && !isNaN(Number(display));
                      return (
                        <td
                          key={plantId}
                          className={`px-3 py-[5px] border-b border-r border-[#2d2d4a] tabular-nums ${
                            isNum
                              ? 'text-right text-gray-200'
                              : display === ''
                                ? 'text-center text-gray-700'
                                : 'text-left text-blue-300/70'
                          }`}
                        >
                          {display || '\u00B7'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* No data */}
      {!loading && !error && multiParams && multiParams.variableOrder.length === 0 && (
        <div className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-md p-8 text-center">
          <p className="text-gray-500 text-xs">{t('batteryParams.noDataInCsv')}</p>
        </div>
      )}
    </div>
  );
}
