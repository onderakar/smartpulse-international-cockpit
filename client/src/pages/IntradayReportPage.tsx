import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { useProfile } from '../context/ProfileContext';
import { useLocale } from '../context/LocaleContext';
import { intradayApi, IntradayTransactionDto, PaginatedTransactionsResponse, HeatmapResponse } from '../api/intraday.api';
import toast from 'react-hot-toast';

type SortDir = 'asc' | 'desc';

// ══════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════

export function IntradayReportPage() {
  const { t } = useLocale();
  const { profile } = useProfile();
  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  // ── Top filters ──
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  // ── Pagination & Sort ──
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState('deliveryStart');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<'raw' | 'analysis'>('raw');

  // ── Column Filters ──
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState<string | null>(null);

  // ── Data ──
  const [data, setData] = useState<PaginatedTransactionsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // ── API Sync rate limit ──
  const [syncing, setSyncing] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-select first company
  useEffect(() => {
    if (companies.length > 0 && selectedCompanyId === null) {
      setSelectedCompanyId(companies[0].companyId);
    }
  }, [companies, selectedCompanyId]);

  const loadData = useCallback(async (resetPage = false) => {
    if (!selectedCompanyId) return;
    const p = resetPage ? 1 : page;
    if (resetPage) setPage(1);
    setLoading(true);
    try {
      const result = await intradayApi.getTransactions({
        companyId: selectedCompanyId,
        startDate: `${date}T00:00:00`,
        endDate: `${date}T23:59:59`,
        page: p,
        pageSize,
        sortBy,
        sortDir,
        filters,
      });
      setData(result);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, date, page, pageSize, sortBy, sortDir, filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = () => loadData(true);

  const startCooldown = (seconds: number) => {
    setCooldownSec(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSec(prev => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Cleanup cooldown on unmount
  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  const handleSyncFromApi = async () => {
    if (!selectedCompanyId || syncing || cooldownSec > 0) return;
    setSyncing(true);
    try {
      const result = await intradayApi.refresh(
        [selectedCompanyId],
        `${date}T00:00:00`,
        `${date}T23:59:59`,
      );
      toast.success(`Synced ${result.newTransactions} transactions from SmartPulse`);
      // Start 5 min cooldown
      startCooldown(300);
      // Reload grid
      await loadData(true);
    } catch (err: any) {
      if (err?.response?.status === 429) {
        const retryAfter = err.response.data?.retryAfterSec || 60;
        startCooldown(retryAfter);
        toast.error(`Rate limited. Try again in ${formatCooldown(retryAfter)}`);
      } else {
        toast.error(err?.response?.data?.message || 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const updateFilter = (key: string, value: string) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  };

  const removeFilter = (key: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  };

  const clearAllFilters = () => {
    setFilters({});
    setPage(1);
  };

  // ── CSV Export ──
  const [exporting, setExporting] = useState(false);

  const handleExportCsv = async () => {
    if (!selectedCompanyId || exporting) return;

    if (data && data.total > 2500) {
      toast.error(
        `Too many rows (${data.total.toLocaleString()}). Apply filters to narrow the result before exporting.`,
        { duration: 5000 },
      );
      return;
    }

    setExporting(true);
    try {
      const result = await intradayApi.exportAll({
        companyId: selectedCompanyId,
        startDate: `${date}T00:00:00`,
        endDate: `${date}T23:59:59`,
        sortBy,
        sortDir,
        filters,
      });

      const csvRows = [
        // Header
        [
          'ID', 'Direction', 'Delivery Start', 'Delivery End', 'Contract', 'Product',
          'Qty (MW)', 'Price', 'MCP', 'SMP', 'Trade Time', 'Status', 'Order Type',
          'Username', 'Platform', 'Area', 'Explanation', 'Trade ID', 'Order ID',
          'Contract ID', 'Company', 'Revision', 'Bot ID', 'Alert',
        ].join(','),
        // Rows
        ...result.transactions.map(tx => [
          tx.id,
          tx.direction ? 'BUY' : 'SELL',
          tx.deliveryStart,
          tx.deliveryEnd,
          `"${(tx.contractName || '').replace(/"/g, '""')}"`,
          tx.productType || '',
          tx.quantity,
          tx.price,
          tx.mcp ?? '',
          tx.smp ?? '',
          tx.tradeTime,
          tx.status,
          tx.orderType || '',
          `"${(tx.username || '').replace(/"/g, '""')}"`,
          tx.platformCode || '',
          tx.areaCode || '',
          `"${(tx.explanation || '').replace(/"/g, '""')}"`,
          tx.remoteTradeId || '',
          tx.remoteOrderId || '',
          tx.contractId || '',
          `"${(tx.companyName || '').replace(/"/g, '""')}"`,
          tx.revisionNo,
          tx.smartbotId ?? '',
          `"${(tx.alertName || '').replace(/"/g, '""')}"`,
        ].join(',')),
      ].join('\n');

      const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `idm_transactions_${date}${Object.keys(filters).length > 0 ? '_filtered' : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Close filter dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-filter-popup]') && !target.closest('[data-filter-trigger]')) {
        setFilterOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const transactions = data?.transactions ?? [];
  const stats = data?.stats ?? { totalBuyMWh: 0, totalSellMWh: 0, buyCount: 0, sellCount: 0, weightedBuyDelta: null as number | null, weightedSellDelta: null as number | null };
  const selectedCompany = companies.find(c => c.companyId === selectedCompanyId);
  const activeFilterCount = Object.keys(filters).length;

  // For distinct value fetching
  const distinctParams = useMemo(() => ({
    companyId: selectedCompanyId!,
    startDate: `${date}T00:00:00`,
    endDate: `${date}T23:59:59`,
  }), [selectedCompanyId, date]);

  return (
    <div className="p-4 flex flex-col h-full overflow-hidden">
      {/* ── Top Bar ── */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <i className="ri-bar-chart-grouped-line text-primary-400" />
            {t('intradayReport.title')}
          </h2>
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => { setSelectedCompanyId(parseInt(e.target.value)); setPage(1); setFilters({}); }}
            className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5 focus:border-primary-500 focus:outline-none transition-colors"
          >
            {companies.map(c => (
              <option key={c.companyId} value={c.companyId}>
                {c.companyName || c.fullName || `#${c.companyId}`}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setPage(1); setFilters({}); }}
            className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5 focus:border-primary-500 focus:outline-none transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40 hover:border-primary-500/40"
          >
            <i className={`ri-refresh-line text-sm ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
          <button
            onClick={handleSyncFromApi}
            disabled={syncing || cooldownSec > 0}
            className={`flex items-center gap-1.5 text-xs rounded-md px-3 py-1.5 transition-all border
              ${cooldownSec > 0
                ? 'text-gray-500 bg-[#12121c] border-[#2a2a3e] cursor-not-allowed'
                : 'text-primary-400 hover:text-white bg-[#12121c] border-primary-500/30 hover:border-primary-500/60 hover:bg-primary-500/5'
              } disabled:opacity-60`}
            title={cooldownSec > 0 ? `Wait ${formatCooldown(cooldownSec)}` : 'Fetch latest data from SmartPulse API'}
          >
            <i className={`ri-cloud-line text-sm ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? 'Syncing...' : cooldownSec > 0 ? formatCooldown(cooldownSec) : 'Sync API'}
          </button>
        </div>
      </div>

      {/* ── Dashboard Widgets ── */}
      <div className="grid grid-cols-4 gap-3 mb-4 shrink-0">
        <StatCard label={t('intradayReport.totalBuy')} value={stats.totalBuyMWh.toFixed(1)} unit="MWh" sub={`${stats.buyCount} trades`} color="emerald" />
        <StatCard label={t('intradayReport.totalSell')} value={stats.totalSellMWh.toFixed(1)} unit="MWh" sub={`${stats.sellCount} trades`} color="red" />
        <DeltaCard label={t('intradayReport.buyDelta')} value={stats.weightedBuyDelta} sub="Weighted avg (MCP − Price)" />
        <DeltaCard label={t('intradayReport.sellDelta')} value={stats.weightedSellDelta} sub="Weighted avg (Price − MCP)" />
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-0 mb-3 shrink-0 border-b border-[#2a2a3e]">
        <button
          onClick={() => setActiveTab('raw')}
          className={`px-4 py-2 text-xs font-medium transition-all relative
            ${activeTab === 'raw'
              ? 'text-primary-400'
              : 'text-gray-500 hover:text-gray-300'}`}
        >
          <i className="ri-table-line mr-1.5" />Raw Data
          {data && <span className="ml-1.5 text-[10px] text-gray-600">{data.total}</span>}
          {activeTab === 'raw' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary-500 rounded-t" />}
        </button>
        <button
          onClick={() => setActiveTab('analysis')}
          className={`px-4 py-2 text-xs font-medium transition-all relative
            ${activeTab === 'analysis'
              ? 'text-primary-400'
              : 'text-gray-500 hover:text-gray-300'}`}
        >
          <i className="ri-line-chart-line mr-1.5" />Analysis
          {activeTab === 'analysis' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary-500 rounded-t" />}
        </button>
      </div>

      {/* ── Tab: Raw Data ── */}
      {activeTab === 'raw' && (<>
      {/* Active Filter Chips + Context */}
      <div className="flex items-center justify-between mb-2 shrink-0 min-h-[28px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-500">
            {selectedCompany && `${selectedCompany.companyName || selectedCompany.fullName} · ${date}`}
            {data && ` · ${data.total} transactions`}
          </span>
          {activeFilterCount > 0 && (
            <>
              <span className="text-[10px] text-gray-600">|</span>
              {Object.entries(filters).map(([key, val]) => (
                <FilterChip key={key} filterKey={key} value={val} onRemove={() => removeFilter(key)} />
              ))}
              <button
                onClick={clearAllFilters}
                className="text-[10px] text-gray-500 hover:text-red-400 transition-colors flex items-center gap-0.5"
              >
                <i className="ri-delete-bin-line text-[10px]" /> Clear all
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">Rows:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}
            className="bg-[#12121c] border border-[#2a2a3e] text-gray-400 text-[10px] rounded px-1.5 py-0.5 focus:outline-none"
          >
            {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={handleExportCsv}
            disabled={exporting || !data || data.total === 0}
            title={data && data.total > 2500 ? `${data.total.toLocaleString()} rows — apply filters first` : 'Export filtered data as CSV'}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-emerald-400 bg-[#12121c] border border-[#2a2a3e] hover:border-emerald-500/30 rounded px-2 py-0.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className={`ri-download-line text-xs ${exporting ? 'animate-pulse' : ''}`} />
            {exporting ? 'Exporting…' : 'CSV'}
          </button>
        </div>
      </div>

      {/* Table ── */}
      <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-[#2a2a3e] bg-[#12121c]">
        {/* Header — not scrollable, allows filter popups to overflow */}
        <div className="shrink-0 relative z-10 overflow-visible">
          <table className="w-full text-xs text-left border-collapse min-w-[1200px]">
            <thead>
            <tr className="bg-[#1a1a2e]">
              {COLUMNS.map(col => (
                <th
                  key={col.field}
                  className={`relative group border-b border-[#2a2a3e] ${col.width || ''} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                >
                  <div
                    className={`px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wider select-none whitespace-nowrap flex items-center gap-1
                      ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}
                      ${col.sortable !== false ? 'cursor-pointer' : ''}
                      ${sortBy === col.field ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'} transition-colors`}
                    onClick={() => col.sortable !== false && handleSort(col.field)}
                  >
                    <span>{col.header}</span>
                    {sortBy === col.field && (
                      <i className={`ri-arrow-${sortDir === 'asc' ? 'up' : 'down'}-s-line text-primary-400 text-xs`} />
                    )}
                  </div>
                  {/* Filter icon — always in header, visible on hover or when active */}
                  {col.filterType && (
                    <button
                      data-filter-trigger
                      onClick={e => { e.stopPropagation(); setFilterOpen(filterOpen === col.field ? null : col.field); }}
                      className={`absolute ${col.align === 'right' ? 'left-1' : 'right-1'} top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition-all
                        ${hasActiveFilter(col.field, filters)
                          ? 'opacity-100 text-primary-400 bg-primary-500/10'
                          : 'opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 hover:bg-[#2a2a3e]'}`}
                    >
                      <i className="ri-filter-3-line text-[10px]" />
                    </button>
                  )}
                  {/* Filter Popup */}
                  {filterOpen === col.field && col.filterType && (
                    <div data-filter-popup className={`absolute top-full z-20 mt-0.5 ${col.align === 'right' ? 'right-0' : 'left-0'}`}>
                      {col.filterType === 'checklist' ? (
                        <ChecklistFilter
                          field={col.field}
                          distinctParams={distinctParams}
                          selected={filters[col.field + '_in']?.split(',').filter(Boolean) ?? []}
                          onChange={vals => updateFilter(col.field + '_in', vals.join(','))}
                          onClose={() => setFilterOpen(null)}
                          renderLabel={col.field === 'direction'
                            ? (v) => v === 'true' ? 'BUY' : v === 'false' ? 'SELL' : v
                            : undefined}
                          renderBadge={col.field === 'direction'
                            ? (v) => v === 'true'
                              ? <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1.5" />
                              : <span className="w-2 h-2 rounded-full bg-red-400 inline-block mr-1.5" />
                            : undefined}
                        />
                      ) : col.filterType === 'numeric' ? (
                        <NumericFilter
                          field={col.field}
                          min={filters[col.field + '_min'] || ''}
                          max={filters[col.field + '_max'] || ''}
                          onChange={(min, max) => {
                            updateFilter(col.field + '_min', min);
                            updateFilter(col.field + '_max', max);
                          }}
                          onClose={() => setFilterOpen(null)}
                        />
                      ) : null}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          </table>
        </div>
        {/* Body — scrollable, fixed height */}
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          <table className="w-full text-xs text-left border-collapse min-w-[1200px]">
          <tbody>
            {loading && transactions.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-20 text-gray-600">
                <div className="flex flex-col items-center gap-2">
                  <i className="ri-loader-4-line animate-spin text-2xl text-primary-500/50" />
                  <span className="text-xs">Loading transactions...</span>
                </div>
              </td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-20 text-gray-600">
                <div className="flex flex-col items-center gap-2">
                  <i className="ri-inbox-line text-3xl text-gray-700" />
                  <span className="text-xs">No transactions found</span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} className="text-[10px] text-primary-400 hover:text-primary-300 mt-1">
                      Clear filters and try again
                    </button>
                  )}
                </div>
              </td></tr>
            ) : (
              transactions.map((tx, idx) => (
                <tr
                  key={tx.id}
                  className={`border-b border-[#1e1e30]/60 transition-colors hover:bg-primary-500/[0.04]
                    ${idx % 2 === 0 ? 'bg-[#12121c]' : 'bg-[#14141f]'}`}
                >
                  {COLUMNS.map(col => (
                    <td
                      key={col.field}
                      className={`px-3 py-[7px] whitespace-nowrap ${col.width || ''} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                    >
                      {col.render ? col.render(tx) : (tx as any)[col.field] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 shrink-0">
          <span className="text-[10px] text-gray-500 tabular-nums">
            {((data.page - 1) * data.pageSize) + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex items-center gap-0.5">
            <PagBtn disabled={page <= 1} onClick={() => setPage(1)} icon="ri-skip-back-mini-line" />
            <PagBtn disabled={page <= 1} onClick={() => setPage(p => p - 1)} icon="ri-arrow-left-s-line" />
            {generatePageNumbers(data.page, data.totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`d${i}`} className="px-1 text-[10px] text-gray-600 select-none">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={`min-w-[28px] h-7 rounded text-[11px] font-medium transition-all
                    ${page === p
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/25'
                      : 'text-gray-500 hover:text-white hover:bg-[#1a1a2e]'
                    }`}
                >
                  {p}
                </button>
              )
            )}
            <PagBtn disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(p => p + 1)} icon="ri-arrow-right-s-line" />
            <PagBtn disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage(data?.totalPages ?? 1)} icon="ri-skip-forward-mini-line" />
          </div>
        </div>
      )}
      </>)}

      {/* ── Tab: Analysis ── */}
      {activeTab === 'analysis' && selectedCompanyId && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TradingHeatmap companyId={selectedCompanyId} date={date} />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
// Trading Heatmap
// ══════════════════════════════════════════════

function TradingHeatmap({ companyId, date }: { companyId: number; date: string }) {
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    intradayApi.getHeatmapData(
      companyId,
      `${date}T00:00:00`,
      `${date}T23:59:59`,
    ).then(data => {
      if (!cancelled) { setHeatmap(data); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [companyId, date]);

  // ALL hooks must be called before any early return
  const yLabels = useMemo(() =>
    heatmap?.deliverySlots.map(s =>
      new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    ) ?? []
  , [heatmap?.deliverySlots]);

  const maxQty = useMemo(() =>
    heatmap?.data.length ? Math.max(...heatmap.data.map(d => d[2]), 1) : 1
  , [heatmap?.data]);

  const chartHeight = useMemo(() => Math.max(400, yLabels.length * 24 + 100), [yLabels.length]);

  const option = useMemo(() => {
    if (!heatmap) return {};
    return {
      tooltip: {
        position: 'top' as const,
        formatter: (params: any) => {
          const [x, y, qty, detail] = params.data;
          const slot = yLabels[y];
          const bucket = heatmap.bucketLabels[x];
          return `
            <div style="font-size:11px;line-height:1.6">
              <div style="font-weight:600;margin-bottom:4px">${slot} · ${bucket} before delivery</div>
              <div>Volume: <b>${qty} MW</b> (${detail.count} trades)</div>
              <div style="color:#4ade80">Buy: ${detail.buyQty} MW</div>
              <div style="color:#f87171">Sell: ${detail.sellQty} MW</div>
              <div>Avg Price: ${detail.avgPrice.toFixed(2)}</div>
            </div>
          `;
        },
        backgroundColor: '#1c1c28',
        borderColor: '#2a2a3e',
        textStyle: { color: '#e5e7eb' },
      },
      grid: {
        top: 40,
        bottom: 50,
        left: 70,
        right: 30,
        containLabel: false,
      },
      xAxis: {
        type: 'category' as const,
        data: heatmap.bucketLabels,
        position: 'top' as const,
        axisLabel: { color: '#6b7280', fontSize: 10, fontWeight: 500 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: yLabels,
        axisLabel: { color: '#9ca3af', fontSize: 10, fontFamily: 'monospace' },
        axisLine: { show: false },
        axisTick: { show: false },
        splitArea: { show: false },
      },
      visualMap: {
        min: 0,
        max: maxQty,
        calculable: true,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 5,
        itemWidth: 12,
        itemHeight: 120,
        textStyle: { color: '#6b7280', fontSize: 10 },
        inRange: {
          color: ['#1a1a2e', '#164e3e', '#059669', '#10b981', '#34d399', '#6ee7b7'],
        },
        formatter: (val: number) => `${val.toFixed(0)} MW`,
      },
      series: [{
        name: 'Trade Volume',
        type: 'heatmap',
        data: heatmap.data.map(d => [d[0], d[1], d[2], d[3]]),
        label: {
          show: true,
          color: '#e5e7eb',
          fontSize: 9,
          fontFamily: 'monospace',
          formatter: (params: any) => {
            const val = params.data[2];
            return val >= 1 ? val.toFixed(0) : val > 0 ? val.toFixed(1) : '';
          },
        },
        emphasis: {
          itemStyle: {
            borderColor: '#a78bfa',
            borderWidth: 2,
            shadowBlur: 10,
            shadowColor: 'rgba(167, 139, 250, 0.4)',
          },
        },
        itemStyle: { borderColor: '#12121c', borderWidth: 1, borderRadius: 2 },
      }],
    };
  }, [heatmap, yLabels, maxQty]);

  // Early returns AFTER all hooks
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-600">
          <i className="ri-loader-4-line animate-spin text-2xl text-primary-500/50 block mb-2" />
          <span className="text-xs">Loading heatmap...</span>
        </div>
      </div>
    );
  }

  if (!heatmap || heatmap.data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-600">
          <i className="ri-fire-line text-3xl text-gray-700 block mb-2" />
          <span className="text-xs">No heatmap data available</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
      <div className="mb-3">
        <h3 className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <i className="ri-fire-line text-orange-400" />
          Trading Activity Heatmap
          <span className="text-[10px] text-gray-600 font-normal ml-1">— Volume by time-before-delivery</span>
        </h3>
      </div>
      <div className="rounded-lg border border-[#2a2a3e] bg-[#12121c] p-2">
        <ReactECharts
          option={option}
          notMerge={false}
          lazyUpdate={true}
          style={{ height: chartHeight, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Column Definitions
// ══════════════════════════════════════════════

interface ColumnDef {
  field: string;
  header: string;
  width?: string;
  align?: 'right' | 'center';
  filterType?: 'checklist' | 'numeric';
  sortable?: boolean;
  render?: (tx: IntradayTransactionDto) => React.ReactNode;
}

function hasActiveFilter(field: string, filters: Record<string, string>): boolean {
  return !!(filters[field] || filters[field + '_in'] || filters[field + '_min'] || filters[field + '_max']);
}

const fmtTime = (v: string | null) => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtTimeFull = (v: string | null) => v ? new Date(v).toLocaleTimeString('en-GB') : '—';
const fmtPrice = (v: number | null) => v != null ? v.toFixed(2) : '—';
const fmtQty = (v: number | null) => v != null ? v.toFixed(1) : '—';

const COLUMNS: ColumnDef[] = [
  {
    field: 'direction',
    header: 'Dir',
    width: 'w-[68px]',
    align: 'center',
    filterType: 'checklist',
    render: tx => (
      <span className={`inline-flex items-center justify-center w-[42px] py-[3px] rounded text-[10px] font-bold tracking-wide leading-none
        ${tx.direction
          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/20'
          : 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/20'
        }`}>
        {tx.direction ? 'BUY' : 'SELL'}
      </span>
    ),
  },
  {
    field: 'deliveryStart',
    header: 'Delivery',
    width: 'w-[80px]',
    render: tx => <span className="text-gray-300">{fmtTime(tx.deliveryStart)}</span>,
  },
  {
    field: 'deliveryEnd',
    header: 'Del. End',
    width: 'w-[80px]',
    render: tx => <span className="text-gray-400">{fmtTime(tx.deliveryEnd)}</span>,
  },
  {
    field: 'contractName',
    header: 'Contract',
    width: 'w-[140px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-300 truncate block max-w-[130px]" title={tx.contractName || ''}>{tx.contractName || '—'}</span>,
  },
  {
    field: 'productType',
    header: 'Product',
    width: 'w-[90px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400">{tx.productType || '—'}</span>,
  },
  {
    field: 'quantity',
    header: 'Qty (MW)',
    width: 'w-[85px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="font-mono tabular-nums text-gray-200">{fmtQty(tx.quantity)}</span>,
  },
  {
    field: 'price',
    header: 'Price',
    width: 'w-[85px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="font-mono tabular-nums text-gray-200">{fmtPrice(tx.price)}</span>,
  },
  {
    field: 'mcp',
    header: 'MCP',
    width: 'w-[85px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="font-mono tabular-nums text-gray-400">{fmtPrice(tx.mcp)}</span>,
  },
  {
    field: 'mcpDelta',
    header: 'MCP Δ',
    width: 'w-[85px]',
    align: 'right',
    sortable: false,
    render: tx => {
      if (tx.mcp == null) return <span className="text-gray-600">—</span>;
      const delta = tx.direction ? (tx.mcp - tx.price) : (tx.price - tx.mcp);
      return (
        <span className={`font-mono tabular-nums font-semibold ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
        </span>
      );
    },
  },
  {
    field: 'smp',
    header: 'SMP',
    width: 'w-[85px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="font-mono tabular-nums text-gray-400">{fmtPrice(tx.smp)}</span>,
  },
  {
    field: 'tradeTime',
    header: 'Trade Time',
    width: 'w-[92px]',
    render: tx => <span className="text-gray-400 tabular-nums">{fmtTimeFull(tx.tradeTime)}</span>,
  },
  {
    field: 'status',
    header: 'Sts',
    width: 'w-[52px]',
    align: 'center',
    filterType: 'checklist',
    render: tx => (
      <span className={`text-[10px] font-semibold tabular-nums ${tx.status === 1 ? 'text-emerald-400' : tx.status === 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
        {tx.status}
      </span>
    ),
  },
  {
    field: 'orderType',
    header: 'Order',
    width: 'w-[80px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400">{tx.orderType || '—'}</span>,
  },
  {
    field: 'username',
    header: 'User',
    width: 'w-[100px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400 truncate block max-w-[90px]" title={tx.username || ''}>{tx.username || '—'}</span>,
  },
  {
    field: 'platformCode',
    header: 'Platform',
    width: 'w-[72px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-500">{tx.platformCode || '—'}</span>,
  },
  {
    field: 'areaCode',
    header: 'Area',
    width: 'w-[60px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-500">{tx.areaCode || '—'}</span>,
  },
  {
    field: 'explanation',
    header: 'Explanation',
    width: 'w-[150px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400 truncate block max-w-[140px]" title={tx.explanation || ''}>{tx.explanation || '—'}</span>,
  },
  {
    field: 'remoteTradeId',
    header: 'Trade ID',
    width: 'w-[120px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-500 font-mono text-[10px] truncate block max-w-[110px]" title={tx.remoteTradeId}>{tx.remoteTradeId || '—'}</span>,
  },
  {
    field: 'remoteOrderId',
    header: 'Order ID',
    width: 'w-[120px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-500 font-mono text-[10px] truncate block max-w-[110px]" title={tx.remoteOrderId || ''}>{tx.remoteOrderId || '—'}</span>,
  },
  {
    field: 'contractId',
    header: 'Contract ID',
    width: 'w-[100px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-500 font-mono text-[10px]">{tx.contractId || '—'}</span>,
  },
  {
    field: 'companyName',
    header: 'Company',
    width: 'w-[110px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400 truncate block max-w-[100px]" title={tx.companyName}>{tx.companyName || '—'}</span>,
  },
  {
    field: 'revisionNo',
    header: 'Rev',
    width: 'w-[50px]',
    align: 'center',
    filterType: 'numeric',
    render: tx => <span className="text-gray-500 font-mono tabular-nums">{tx.revisionNo}</span>,
  },
  {
    field: 'smartbotId',
    header: 'Bot ID',
    width: 'w-[65px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="text-gray-500 font-mono tabular-nums">{tx.smartbotId ?? '—'}</span>,
  },
  {
    field: 'alertName',
    header: 'Alert',
    width: 'w-[100px]',
    filterType: 'checklist',
    render: tx => <span className="text-gray-400 truncate block max-w-[90px]" title={tx.alertName || ''}>{tx.alertName || '—'}</span>,
  },
  {
    field: 'id',
    header: 'ID',
    width: 'w-[60px]',
    align: 'right',
    filterType: 'numeric',
    render: tx => <span className="text-gray-600 font-mono tabular-nums text-[10px]">{tx.id}</span>,
  },
];

// ══════════════════════════════════════════════
// Filter Components
// ══════════════════════════════════════════════

/** Excel-style checklist filter: fetches distinct values from DB */
function ChecklistFilter({ field, distinctParams, selected, onChange, onClose, renderLabel, renderBadge }: {
  field: string;
  distinctParams: { companyId: number; startDate: string; endDate: string };
  selected: string[];
  onChange: (vals: string[]) => void;
  onClose: () => void;
  renderLabel?: (v: string) => string;
  renderBadge?: (v: string) => React.ReactNode;
}) {
  const [values, setValues] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loadingValues, setLoadingValues] = useState(true);
  // Buffer selection locally — only commit to parent on Apply
  const [localSelected, setLocalSelected] = useState<string[]>(selected);

  useEffect(() => {
    let cancelled = false;
    setLoadingValues(true);
    // For direction, use static values
    if (field === 'direction') {
      setValues(['true', 'false']);
      setLoadingValues(false);
      return;
    }
    intradayApi.getDistinctValues(
      distinctParams.companyId,
      distinctParams.startDate,
      distinctParams.endDate,
      field,
    ).then(vals => {
      if (!cancelled) { setValues(vals); setLoadingValues(false); }
    }).catch(() => {
      if (!cancelled) setLoadingValues(false);
    });
    return () => { cancelled = true; };
  }, [field, distinctParams.companyId, distinctParams.startDate, distinctParams.endDate]);

  const filtered = search
    ? values.filter(v => (renderLabel?.(v) ?? v).toLowerCase().includes(search.toLowerCase()))
    : values;

  const isAllSelected = filtered.length > 0 && filtered.every(v => localSelected.includes(v));

  const toggleValue = (val: string) => {
    setLocalSelected(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const toggleAll = () => {
    if (isAllSelected) {
      // Deselect filtered
      setLocalSelected(prev => prev.filter(v => !filtered.includes(v)));
    } else {
      // Select all filtered
      const merged = new Set([...localSelected, ...filtered]);
      setLocalSelected([...merged]);
    }
  };

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg shadow-2xl shadow-black/40 min-w-[180px] max-w-[240px] overflow-hidden">
      {/* Search */}
      <div className="p-2 border-b border-[#2a2a3e]">
        <div className="relative">
          <i className="ri-search-line absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-[10px]" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()}
            placeholder="Search..."
            className="w-full bg-[#12121c] border border-[#2a2a3e] text-white text-[11px] rounded pl-6 pr-2 py-1 focus:border-primary-500 focus:outline-none placeholder-gray-600"
          />
        </div>
      </div>

      {/* Select all / Clear */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#2a2a3e]/50">
        <button onClick={toggleAll} className="text-[10px] text-primary-400 hover:text-primary-300 transition-colors">
          {isAllSelected ? 'Deselect all' : 'Select all'}
        </button>
        {localSelected.length > 0 && (
          <button onClick={() => { onChange([]); setLocalSelected([]); onClose(); }} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Values */}
      <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
        {loadingValues ? (
          <div className="py-4 text-center text-gray-600 text-[10px]">
            <i className="ri-loader-4-line animate-spin mr-1" />Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center text-gray-600 text-[10px]">No values</div>
        ) : (
          filtered.map(val => {
            const isChecked = localSelected.includes(val);
            const label = renderLabel?.(val) ?? val;
            return (
              <div
                key={val}
                onClick={() => toggleValue(val)}
                className={`flex items-center gap-2 px-2.5 py-[5px] cursor-pointer transition-colors text-[11px]
                  ${isChecked ? 'bg-primary-500/[0.06] text-white' : 'text-gray-400 hover:bg-[#1e1e30] hover:text-gray-200'}`}
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all
                  ${isChecked
                    ? 'bg-primary-600 border-primary-500'
                    : 'border-gray-600 bg-transparent'}`}>
                  {isChecked && <i className="ri-check-line text-[9px] text-white" />}
                </span>
                {renderBadge?.(val)}
                <span className="truncate">{label}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Apply */}
      <div className="p-2 border-t border-[#2a2a3e] flex justify-end">
        <button
          onClick={() => { onChange(localSelected); onClose(); }}
          className="text-[10px] bg-primary-600 hover:bg-primary-500 text-white px-3 py-1 rounded transition-colors font-medium"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** Numeric range filter: min/max inputs with quick presets */
function NumericFilter({ field, min, max, onChange, onClose }: {
  field: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  onClose: () => void;
}) {
  const [localMin, setLocalMin] = useState(min);
  const [localMax, setLocalMax] = useState(max);

  const apply = () => {
    onChange(localMin, localMax);
    onClose();
  };

  const clear = () => {
    setLocalMin('');
    setLocalMax('');
    onChange('', '');
    onClose();
  };

  const presets = useMemo(() => {
    if (field === 'quantity') return [
      { label: '> 0', fn: () => { setLocalMin('0.01'); setLocalMax(''); } },
      { label: '≥ 10', fn: () => { setLocalMin('10'); setLocalMax(''); } },
      { label: '≥ 50', fn: () => { setLocalMin('50'); setLocalMax(''); } },
    ];
    if (field === 'price' || field === 'mcp' || field === 'smp') return [
      { label: '> 0', fn: () => { setLocalMin('0.01'); setLocalMax(''); } },
      { label: '> 100', fn: () => { setLocalMin('100'); setLocalMax(''); } },
      { label: '< 50', fn: () => { setLocalMin(''); setLocalMax('50'); } },
    ];
    return [];
  }, [field]);

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg shadow-2xl shadow-black/40 w-[200px] overflow-hidden">
      <div className="p-2.5 space-y-2">
        {/* Quick presets */}
        {presets.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => { p.fn(); }}
                className="text-[10px] px-2 py-0.5 rounded bg-[#12121c] border border-[#2a2a3e] text-gray-400 hover:text-white hover:border-primary-500/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Min/Max inputs */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5 block">Min</label>
            <input
              autoFocus
              type="number"
              step="any"
              value={localMin}
              onChange={e => setLocalMin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              placeholder="—"
              className="w-full bg-[#12121c] border border-[#2a2a3e] text-white text-[11px] rounded px-2 py-1 focus:border-primary-500 focus:outline-none tabular-nums font-mono placeholder-gray-700"
            />
          </div>
          <span className="text-gray-600 text-xs mt-3">–</span>
          <div className="flex-1">
            <label className="text-[9px] text-gray-600 uppercase tracking-wider mb-0.5 block">Max</label>
            <input
              type="number"
              step="any"
              value={localMax}
              onChange={e => setLocalMax(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              placeholder="—"
              className="w-full bg-[#12121c] border border-[#2a2a3e] text-white text-[11px] rounded px-2 py-1 focus:border-primary-500 focus:outline-none tabular-nums font-mono placeholder-gray-700"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-[#2a2a3e] flex items-center justify-between">
        <button onClick={clear} className="text-[10px] text-gray-500 hover:text-red-400 transition-colors">
          Clear
        </button>
        <button
          onClick={apply}
          className="text-[10px] bg-primary-600 hover:bg-primary-500 text-white px-3 py-1 rounded transition-colors font-medium"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Shared Components
// ══════════════════════════════════════════════

function FilterChip({ filterKey, value, onRemove }: { filterKey: string; value: string; onRemove: () => void }) {
  // Prettify filter display
  const field = filterKey.replace(/_in$/, '').replace(/_min$/, '').replace(/_max$/, '');
  const suffix = filterKey.endsWith('_in') ? '' : filterKey.endsWith('_min') ? ' ≥' : filterKey.endsWith('_max') ? ' ≤' : '';

  let displayVal = value;
  if (filterKey.endsWith('_in')) {
    const vals = value.split(',');
    if (field === 'direction') {
      displayVal = vals.map(v => v === 'true' ? 'BUY' : 'SELL').join(', ');
    } else {
      displayVal = vals.length > 2 ? `${vals.length} selected` : vals.join(', ');
    }
  }

  const colDef = COLUMNS.find(c => c.field === field);
  const label = colDef?.header || field;

  return (
    <span className="inline-flex items-center gap-1 bg-primary-500/10 text-primary-400 ring-1 ring-inset ring-primary-500/20 rounded-full px-2 py-0.5 text-[10px] font-medium">
      <span className="text-primary-400/60">{label}{suffix}:</span>
      <span className="max-w-[100px] truncate">{displayVal}</span>
      <button onClick={onRemove} className="hover:text-red-400 transition-colors ml-0.5">
        <i className="ri-close-line text-[10px]" />
      </button>
    </span>
  );
}

function StatCard({ label, value, unit, sub, color }: {
  label: string; value: string; unit: string; sub: string; color: 'emerald' | 'red' | 'gray';
}) {
  const styles = {
    emerald: { text: 'text-emerald-400', border: 'border-emerald-500/15', bg: 'bg-emerald-500/[0.03]' },
    red: { text: 'text-red-400', border: 'border-red-500/15', bg: 'bg-red-500/[0.03]' },
    gray: { text: 'text-gray-500', border: 'border-[#2a2a3e]', bg: '' },
  }[color];

  return (
    <div className={`bg-[#1c1c28] ${styles.bg} border ${styles.border} rounded-lg p-4`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-bold ${styles.text} tabular-nums leading-none`}>
        {value}
        {unit && <span className="text-sm font-normal text-gray-600 ml-1.5">{unit}</span>}
      </div>
      <div className="text-[10px] text-gray-600 mt-1.5">{sub}</div>
    </div>
  );
}

function DeltaCard({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  const isPositive = value != null && value >= 0;
  const color = value == null ? 'text-gray-500' : isPositive ? 'text-emerald-400' : 'text-red-400';
  const border = value == null ? 'border-[#2a2a3e]' : isPositive ? 'border-emerald-500/15' : 'border-red-500/15';
  const bg = value == null ? '' : isPositive ? 'bg-emerald-500/[0.03]' : 'bg-red-500/[0.03]';

  return (
    <div className={`bg-[#1c1c28] ${bg} border ${border} rounded-lg p-4`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">{label}</div>
      <div className={`text-2xl font-bold ${color} tabular-nums leading-none font-mono`}>
        {value != null ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : '—'}
      </div>
      <div className="text-[10px] text-gray-600 mt-1.5">{sub}</div>
    </div>
  );
}

function PagBtn({ disabled, onClick, icon }: { disabled: boolean; onClick: () => void; icon: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-[#1a1a2e] disabled:opacity-25 disabled:cursor-not-allowed transition-all"
    >
      <i className={`${icon} text-sm`} />
    </button>
  );
}

function formatCooldown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
