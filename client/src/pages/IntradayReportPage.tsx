import { useState, useEffect, useMemo, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ColDef, ModuleRegistry, ValueFormatterParams } from 'ag-grid-community';
import { useProfile } from '../context/ProfileContext';
import { useLocale } from '../context/LocaleContext';
import { intradayApi, IntradayTransactionDto } from '../api/intraday.api';
import toast from 'react-hot-toast';

ModuleRegistry.registerModules([AllCommunityModule]);

export function IntradayReportPage() {
  const { t } = useLocale();
  const { profile } = useProfile();
  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [transactions, setTransactions] = useState<IntradayTransactionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-select first company
  useEffect(() => {
    if (companies.length > 0 && selectedCompanyId === null) {
      setSelectedCompanyId(companies[0].companyId);
    }
  }, [companies, selectedCompanyId]);

  const loadData = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const result = await intradayApi.getTransactions(
        selectedCompanyId,
        `${date}T00:00:00`,
        `${date}T23:59:59`,
      );
      setTransactions(result.transactions);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, date]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = useCallback(async () => {
    if (!selectedCompanyId) return;
    setRefreshing(true);
    try {
      await intradayApi.refresh(
        [selectedCompanyId],
        `${date}T00:00:00`,
        `${date}T23:59:59`,
      );
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [selectedCompanyId, date, loadData]);

  // ── Dashboard Calculations ──
  const stats = useMemo(() => {
    const buys = transactions.filter(r => r.direction === true);
    const sells = transactions.filter(r => r.direction === false);

    const totalBuyMWh = buys.reduce((s, r) => s + r.quantity, 0);
    const totalSellMWh = sells.reduce((s, r) => s + r.quantity, 0);

    // Weighted Buy MCP Delta: (MCP - Price) * Qty / sum(Qty)
    const buyWithMcp = buys.filter(r => r.mcp != null);
    const weightedBuyDelta = buyWithMcp.length > 0
      ? buyWithMcp.reduce((s, r) => s + (r.mcp! - r.price) * r.quantity, 0) /
        buyWithMcp.reduce((s, r) => s + r.quantity, 0)
      : null;

    // Weighted Sell MCP Delta: (Price - MCP) * Qty / sum(Qty)
    const sellWithMcp = sells.filter(r => r.mcp != null);
    const weightedSellDelta = sellWithMcp.length > 0
      ? sellWithMcp.reduce((s, r) => s + (r.price - r.mcp!) * r.quantity, 0) /
        sellWithMcp.reduce((s, r) => s + r.quantity, 0)
      : null;

    return { totalBuyMWh, totalSellMWh, weightedBuyDelta, weightedSellDelta, buyCount: buys.length, sellCount: sells.length };
  }, [transactions]);

  // ── AG Grid Column Definitions ──
  const columnDefs = useMemo<ColDef<IntradayTransactionDto>[]>(() => [
    {
      headerName: 'Dir',
      field: 'direction',
      width: 75,
      filter: true,
      cellRenderer: (params: any) => {
        const isBuy = params.value;
        return (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            isBuy ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'
          }`}>
            {isBuy ? 'BUY' : 'SELL'}
          </span>
        );
      },
    },
    {
      headerName: 'Delivery',
      field: 'deliveryStart',
      width: 100,
      filter: 'agTextColumnFilter',
      valueFormatter: (p: ValueFormatterParams) => p.value ? new Date(p.value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
      sort: 'asc',
    },
    {
      headerName: 'Del. End',
      field: 'deliveryEnd',
      width: 90,
      filter: 'agTextColumnFilter',
      valueFormatter: (p: ValueFormatterParams) => p.value ? new Date(p.value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
    },
    {
      headerName: 'Contract',
      field: 'contractName',
      width: 140,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Product',
      field: 'productType',
      width: 100,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Qty (MW)',
      field: 'quantity',
      width: 95,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => p.value != null ? Number(p.value).toFixed(2) : '',
    },
    {
      headerName: 'Price',
      field: 'price',
      width: 90,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => p.value != null ? Number(p.value).toFixed(2) : '',
    },
    {
      headerName: 'MCP',
      field: 'mcp',
      width: 85,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => p.value != null ? Number(p.value).toFixed(2) : '—',
    },
    {
      headerName: 'MCP Δ',
      width: 90,
      type: 'numericColumn',
      valueGetter: (params: any) => {
        const row = params.data as IntradayTransactionDto;
        if (row.mcp == null) return null;
        return row.direction ? (row.mcp - row.price) : (row.price - row.mcp);
      },
      valueFormatter: (p: ValueFormatterParams) => p.value != null ? (p.value >= 0 ? '+' : '') + Number(p.value).toFixed(2) : '—',
      cellStyle: (params: any) => {
        if (params.value == null) return {};
        return { color: params.value >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 };
      },
    },
    {
      headerName: 'SMP',
      field: 'smp',
      width: 85,
      filter: 'agNumberColumnFilter',
      type: 'numericColumn',
      valueFormatter: (p: ValueFormatterParams) => p.value != null ? Number(p.value).toFixed(2) : '—',
    },
    {
      headerName: 'Trade Time',
      field: 'tradeTime',
      width: 110,
      filter: 'agTextColumnFilter',
      valueFormatter: (p: ValueFormatterParams) => p.value ? new Date(p.value).toLocaleTimeString('en-GB') : '',
    },
    {
      headerName: 'Status',
      field: 'status',
      width: 75,
      filter: 'agNumberColumnFilter',
    },
    {
      headerName: 'Order Type',
      field: 'orderType',
      width: 100,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'User',
      field: 'username',
      width: 110,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Explanation',
      field: 'explanation',
      width: 150,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Trade ID',
      field: 'remoteTradeId',
      width: 130,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Order ID',
      field: 'remoteOrderId',
      width: 130,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Platform',
      field: 'platformCode',
      width: 90,
      filter: 'agTextColumnFilter',
    },
    {
      headerName: 'Area',
      field: 'areaCode',
      width: 80,
      filter: 'agTextColumnFilter',
    },
  ], []);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    resizable: true,
    suppressMovable: false,
  }), []);

  const selectedCompany = companies.find(c => c.companyId === selectedCompanyId);

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Top Filter Bar */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <i className="ri-bar-chart-grouped-line text-primary-400" />
            {t('intradayReport.title')}
          </h2>
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => setSelectedCompanyId(parseInt(e.target.value))}
            className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5"
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
            onChange={e => setDate(e.target.value)}
            className="bg-[#12121c] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing || !selectedCompanyId}
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className={`ri-download-cloud-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('intraday.fetching') : 'Fetch IDM'}
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className={`ri-refresh-line text-sm ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Dashboard Widgets */}
      <div className="grid grid-cols-4 gap-3 mb-4 shrink-0">
        {/* Total Buy */}
        <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('intradayReport.totalBuy')}</div>
          <div className="text-2xl font-bold text-emerald-400">{stats.totalBuyMWh.toFixed(1)}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">MWh · {stats.buyCount} trades</div>
        </div>
        {/* Total Sell */}
        <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('intradayReport.totalSell')}</div>
          <div className="text-2xl font-bold text-red-400">{stats.totalSellMWh.toFixed(1)}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">MWh · {stats.sellCount} trades</div>
        </div>
        {/* Buy MCP Delta */}
        <DeltaWidget
          label={t('intradayReport.buyDelta')}
          value={stats.weightedBuyDelta}
          subtitle="Weighted avg (MCP − Price)"
          positiveIsGood={true}
        />
        {/* Sell MCP Delta */}
        <DeltaWidget
          label={t('intradayReport.sellDelta')}
          value={stats.weightedSellDelta}
          subtitle="Weighted avg (Price − MCP)"
          positiveIsGood={true}
        />
      </div>

      {/* Context info */}
      <div className="flex items-center gap-3 mb-2 text-[10px] text-gray-500 shrink-0">
        {selectedCompany && (
          <span>{selectedCompany.companyName || selectedCompany.fullName} · {date} · {transactions.length} transactions</span>
        )}
      </div>

      {/* AG Grid */}
      <div className="flex-1 min-h-0 ag-theme-alpine-dark rounded-lg overflow-hidden border border-[#2a2a3e]">
        <AgGridReact<IntradayTransactionDto>
          rowData={transactions}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows={true}
          rowHeight={32}
          headerHeight={36}
          suppressCellFocus={true}
          enableCellTextSelection={true}
          loading={loading}
        />
      </div>
    </div>
  );
}

// ── Delta Widget ──
function DeltaWidget({ label, value, subtitle, positiveIsGood }: {
  label: string;
  value: number | null;
  subtitle: string;
  positiveIsGood: boolean;
}) {
  const isPositive = value != null && value >= 0;
  const isGood = positiveIsGood ? isPositive : !isPositive;
  const colorClass = value == null ? 'text-gray-500' : isGood ? 'text-emerald-400' : 'text-red-400';
  const bgBorder = value == null ? 'border-[#2a2a3e]' : isGood ? 'border-emerald-900/40' : 'border-red-900/40';

  return (
    <div className={`bg-[#1c1c28] border ${bgBorder} rounded-lg p-4`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>
        {value != null ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}` : '—'}
      </div>
      <div className="text-[10px] text-gray-600 mt-0.5">{subtitle}</div>
    </div>
  );
}
