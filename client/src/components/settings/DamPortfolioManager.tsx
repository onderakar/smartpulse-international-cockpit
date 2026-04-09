import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocale } from '../../context/LocaleContext';
import { useProfile } from '../../context/ProfileContext';
import { portfolioMappingApi, PortfolioMappingDto } from '../../api/portfolioMapping.api';
import toast from 'react-hot-toast';

/**
 * DAM & IDM Portfolio Management
 *
 * Layout: Left = SmartPulse Company, Right = Portfolio IDs (tag input with suggestions + manual entry)
 * Data model: company → portfolioId (1:1 per portfolio type, but UI supports free text entry)
 */

interface CompanyRow {
  companyId: number;
  companyName: string;
  portfolioId: string | null;  // currently assigned portfolio ID
}

export function DamPortfolioManager() {
  const { t } = useLocale();
  const { profile } = useProfile();

  const [csvPortfolios, setCsvPortfolios] = useState<string[]>([]);
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [savedMappings, setSavedMappings] = useState<PortfolioMappingDto[]>([]);
  const [sourceVersion, setSourceVersion] = useState<{ versionNo: number; fetchedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const companies = useMemo(() => profile?.assetMapping?.companies ?? [], [profile]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [mappingRes, portfolioRes] = await Promise.all([
        portfolioMappingApi.getMappings(),
        portfolioMappingApi.getDamPortfolios(),
      ]);

      const damMappings = mappingRes.mappings.filter(m => m.portfolioType === 'DAM');
      setSavedMappings(damMappings);
      setCsvPortfolios(portfolioRes.portfolios);
      setSourceVersion(portfolioRes.sourceVersion);

      // Build rows: one per company from AssetMapping
      const mappingByCompany = new Map(damMappings.map(m => [m.companyId, m.externalId]));
      const companyRows: CompanyRow[] = companies.map(c => ({
        companyId: c.companyId,
        companyName: c.companyName || c.fullName || `Company ${c.companyId}`,
        portfolioId: mappingByCompany.get(c.companyId) ?? null,
      }));

      setRows(companyRows);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to load portfolio data');
    } finally {
      setLoading(false);
    }
  }, [companies]);

  useEffect(() => { loadData(); }, [loadData]);

  // Portfolio IDs already assigned to other companies
  const assignedPortfolioIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.portfolioId) set.add(r.portfolioId);
    }
    return set;
  }, [rows]);

  const handlePortfolioChange = (companyId: number, portfolioId: string | null) => {
    setRows(prev => prev.map(r =>
      r.companyId === companyId ? { ...r, portfolioId } : r
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const toSave = rows
        .filter(r => r.portfolioId)
        .map(r => ({ externalId: r.portfolioId!, companyId: r.companyId }));

      const result = await portfolioMappingApi.saveMappings('DAM', toSave);
      toast.success(`${result.saved} mapping(s) saved`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      toast.success(t('damPortfolio.refreshed'));
    } catch {
      toast.error('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  // Unsaved changes detection
  const hasChanges = useMemo(() => {
    const savedByCompany = new Map(savedMappings.map(m => [m.companyId, m.externalId]));
    for (const r of rows) {
      const saved = savedByCompany.get(r.companyId) ?? null;
      if (r.portfolioId !== saved) return true;
    }
    return false;
  }, [rows, savedMappings]);

  const mappedCount = rows.filter(r => r.portfolioId).length;

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
              {csvPortfolios.length > 0 && ` · ${csvPortfolios.length} portfolio(s) in CSV`}
            </p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
        >
          <i className={`ri-refresh-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-400 rounded-full animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <p className="text-gray-500 text-xs text-center py-6">{t('common.configureMapping')}</p>
      ) : (
        <>
          {/* Mapping table */}
          <div className="rounded-lg border border-[#2a2a3e] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#191930]">
                  <th className="text-left px-4 py-2.5 text-gray-400 font-semibold w-1/3">{t('damPortfolio.company')}</th>
                  <th className="text-left px-4 py-2.5 text-gray-400 font-semibold">{t('damPortfolio.portfolioId')}</th>
                  <th className="text-center px-4 py-2.5 text-gray-400 font-semibold w-20">{t('damPortfolio.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.companyId} className="border-t border-[#2a2a3e] hover:bg-[#1e1e42]/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{row.companyName}</span>
                      <span className="text-[10px] text-gray-600 ml-2">#{row.companyId}</span>
                    </td>
                    <td className="px-4 py-3">
                      <PortfolioInput
                        value={row.portfolioId}
                        onChange={val => handlePortfolioChange(row.companyId, val)}
                        suggestions={csvPortfolios}
                        assignedIds={assignedPortfolioIds}
                        currentValue={row.portfolioId}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.portfolioId ? (
                        <span className="text-emerald-400 text-[10px] flex items-center justify-center gap-1">
                          <i className="ri-check-line" /> Mapped
                        </span>
                      ) : (
                        <span className="text-gray-600 text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-[10px] text-gray-500">
              {mappedCount}/{rows.length} companies mapped
            </span>
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

// ── Portfolio Input: combo of text input + dropdown suggestions ──

interface PortfolioInputProps {
  value: string | null;
  onChange: (val: string | null) => void;
  suggestions: string[];
  assignedIds: Set<string>;
  currentValue: string | null;
}

function PortfolioInput({ value, onChange, suggestions, assignedIds, currentValue }: PortfolioInputProps) {
  const { t } = useLocale();
  const [inputText, setInputText] = useState(value ?? '');
  const [showDropdown, setShowDropdown] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value
  useEffect(() => { setInputText(value ?? ''); }, [value]);

  // Available suggestions: not assigned to other companies
  const availableSuggestions = useMemo(() => {
    return suggestions.filter(s => {
      if (s === currentValue) return true; // show own current assignment
      return !assignedIds.has(s);
    });
  }, [suggestions, assignedIds, currentValue]);

  // Filtered by input text
  const filtered = useMemo(() => {
    if (!inputText.trim()) return availableSuggestions;
    const q = inputText.toLowerCase();
    return availableSuggestions.filter(s => s.toLowerCase().includes(q));
  }, [availableSuggestions, inputText]);

  const handleSelect = (portfolioId: string) => {
    setInputText(portfolioId);
    onChange(portfolioId);
    setShowDropdown(false);
  };

  const handleInputBlur = () => {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      setFocused(false);
      setShowDropdown(false);
      // Commit typed value
      const trimmed = inputText.trim();
      if (trimmed) {
        onChange(trimmed);
      } else {
        onChange(null);
        setInputText('');
      }
    }, 200);
  };

  const handleClear = () => {
    setInputText('');
    onChange(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = inputText.trim();
      if (trimmed) {
        onChange(trimmed);
        setShowDropdown(false);
        inputRef.current?.blur();
      }
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  const isFromCsv = value && suggestions.includes(value);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => {
              setInputText(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => { setFocused(true); setShowDropdown(true); }}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            placeholder={t('damPortfolio.typeOrSelect')}
            className={`w-full bg-[#12121c] border rounded px-2.5 py-1.5 text-xs pr-14 transition-colors ${
              value
                ? 'border-emerald-800/40 text-white'
                : focused
                  ? 'border-primary-600/50 text-white'
                  : 'border-[#2a2a3e] text-gray-500'
            }`}
          />
          {/* Tags: CSV indicator + clear button */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isFromCsv && (
              <span className="text-[8px] text-emerald-500/60 bg-emerald-900/20 px-1 py-0.5 rounded">CSV</span>
            )}
            {value && !isFromCsv && (
              <span className="text-[8px] text-amber-500/60 bg-amber-900/20 px-1 py-0.5 rounded">Manual</span>
            )}
            {value && (
              <button
                onClick={handleClear}
                className="text-gray-600 hover:text-red-400 transition-colors"
                tabIndex={-1}
              >
                <i className="ri-close-circle-line text-xs" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Dropdown */}
      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-[#1c1c28] border border-[#2a2a3e] rounded-md shadow-xl max-h-40 overflow-auto">
          {filtered.map(s => {
            const isAssigned = assignedIds.has(s) && s !== currentValue;
            return (
              <button
                key={s}
                onMouseDown={e => { e.preventDefault(); handleSelect(s); }}
                disabled={isAssigned}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  isAssigned
                    ? 'text-gray-600 cursor-not-allowed'
                    : s === value
                      ? 'bg-primary-900/30 text-primary-300'
                      : 'text-gray-300 hover:bg-[#1e1e42]'
                }`}
              >
                <span className="font-mono">{s}</span>
                {isAssigned && <span className="text-[9px] text-gray-600 ml-2">(assigned)</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
