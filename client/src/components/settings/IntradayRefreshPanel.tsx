import { useState, useMemo } from 'react';
import { useLocale } from '../../context/LocaleContext';
import { useProfile } from '../../context/ProfileContext';
import { intradayApi } from '../../api/intraday.api';
import toast from 'react-hot-toast';

export function IntradayRefreshPanel() {
  const { t } = useLocale();
  const { profile } = useProfile();

  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  // Default date range: today
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<{
    newTransactions: number;
    aggregated: { inserted: number; skipped: number };
  } | null>(null);

  // Select all by default on first render
  useMemo(() => {
    if (companies.length > 0 && selectedCompanyIds.size === 0) {
      setSelectedCompanyIds(new Set(companies.map(c => c.companyId)));
    }
  }, [companies]);

  const toggleCompany = (id: number) => {
    setSelectedCompanyIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedCompanyIds.size === companies.length) {
      setSelectedCompanyIds(new Set());
    } else {
      setSelectedCompanyIds(new Set(companies.map(c => c.companyId)));
    }
  };

  const handleRefresh = async () => {
    if (selectedCompanyIds.size === 0) {
      toast.error(t('intraday.selectCompany'));
      return;
    }

    setRefreshing(true);
    setLastResult(null);
    try {
      const result = await intradayApi.refresh(
        [...selectedCompanyIds],
        `${startDate}T00:00:00`,
        `${endDate}T23:59:59`,
      );
      setLastResult(result);
      const total = result.newTransactions;
      const updated = result.aggregated.inserted;
      toast.success(`${total} transactions fetched, ${updated} series updated`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
      {/* Header */}
      <h3 className="text-lg font-medium text-white flex items-center gap-2 mb-4">
        <i className="ri-exchange-line text-primary-400" />
        {t('intraday.title')}
      </h3>

      {companies.length === 0 ? (
        <p className="text-gray-500 text-xs">{t('common.configureMapping')}</p>
      ) : (
        <div className="space-y-4">
          {/* Date range */}
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">{t('intraday.startDate')}</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">{t('intraday.endDate')}</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5"
              />
            </div>
          </div>

          {/* Company selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-gray-500">{t('intraday.companies')}</label>
              <button onClick={toggleAll} className="text-[10px] text-primary-400 hover:text-primary-300 transition-colors">
                {selectedCompanyIds.size === companies.length ? t('intraday.deselectAll') : t('intraday.selectAll')}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {companies.map(c => {
                const selected = selectedCompanyIds.has(c.companyId);
                return (
                  <button
                    key={c.companyId}
                    onClick={() => toggleCompany(c.companyId)}
                    className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                      selected
                        ? 'bg-primary-900/30 border-primary-700/50 text-primary-300'
                        : 'bg-[#12121c] border-[#2a2a3e] text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {c.companyName || c.fullName || `#${c.companyId}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Refresh button + result */}
          <div className="flex items-center justify-between">
            <div>
              {lastResult && (
                <span className="text-[10px] text-gray-500">
                  {lastResult.newTransactions} transactions · {lastResult.aggregated.inserted} series points updated
                </span>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing || selectedCompanyIds.size === 0}
              className="flex items-center gap-1.5 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-md px-4 py-2 transition-colors disabled:opacity-40"
            >
              {refreshing ? (
                <i className="ri-loader-4-line animate-spin text-sm" />
              ) : (
                <i className="ri-download-cloud-line text-sm" />
              )}
              {refreshing ? t('intraday.fetching') : t('intraday.refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
