import { useState, useMemo } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { getFirstGcp } from '@shared/types/assetMapping.types';
import { monitoringApi } from '../../api/monitoring.api';
import { monitoringCache } from '../../services/monitoringCache';
import toast from 'react-hot-toast';

export function CacheManagement() {
  const { profile } = useProfile();
  const { t } = useLocale();
  const mapping = profile?.assetMapping;
  const gcp = getFirstGcp(mapping);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncingDate, setSyncingDate] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  const handleClearAllCache = async () => {
    setClearingCache(true);
    try {
      await monitoringCache.clearAllCachedDays();
      toast.success(t('cache.allCleared'), { duration: 2000 });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      toast.error(t('cache.clearFailed'));
    } finally {
      setClearingCache(false);
    }
  };

  const handleSync = async (dateStr: string) => {
    if (!gcp?.id) return;

    const companyMatch = mapping?.companies?.find((c: any) =>
      c.gridConnectionPoints.some((u: any) => u.id === gcp.id)
    );
    const companyId = companyMatch?.companyId || 0;

    setSyncStatus('syncing');
    setSyncingDate(dateStr);

    try {
      // Compute dynamic timezone offset from the GCP's timezone (DST-aware)
      const now = new Date();
      const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = now.toLocaleString('en-US', { timeZone: gcp.timezone || 'UTC' });
      const tzOffsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
      const tzOffsetHours = tzOffsetMs / 3600000;
      const sign = tzOffsetHours >= 0 ? '+' : '-';
      const absHours = String(Math.floor(Math.abs(tzOffsetHours))).padStart(2, '0');
      const absMinutes = String(Math.round((Math.abs(tzOffsetHours) % 1) * 60)).padStart(2, '0');
      const offsetStr = `${sign}${absHours}:${absMinutes}`;

      const start = new Date(`${dateStr}T00:00:00.000${offsetStr}`);
      const end = new Date(`${dateStr}T23:59:59.999${offsetStr}`);

      await monitoringApi.refetchLiveMetricsDay(
        gcp.id,
        companyId,
        start.toISOString(),
        end.toISOString()
      );

      setSyncStatus('success');
      toast.success(`${dateStr} — ${t('cache.allCleared')}`, { duration: 6000 });
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncingDate(null);
      }, 3000);
    } catch (err: any) {
      setSyncStatus('error');
      const msg = err.response?.data?.message || err.message || t('cache.clearFailed');
      toast.error(`${dateStr}: ${msg}`);
      setSyncingDate(null);
    }
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const startDayOfWeek = currentMonth.getDay(); // 0 (Sun) to 6 (Sat)
  const emptyDays = (startDayOfWeek + 6) % 7; // Convert to Mon-Sun (0=Mon, 6=Sun)

  const monthName = currentMonth.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
  const todayStr = new Date().toISOString().split('T')[0];

  const days = useMemo(() => {
    const list = [];
    for (let i = 0; i < emptyDays; i++) {
      list.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
      const offset = d.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(d.getTime() - offset)).toISOString().slice(0, 10);
      list.push(localISOTime);
    }
    return list;
  }, [currentMonth, daysInMonth, emptyDays]);

  return (
    <>
      {/* Full Screen Blocking Modal */}
      {syncStatus === 'syncing' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-800 border border-primary-500 rounded-xl p-8 shadow-2xl flex flex-col items-center max-w-sm w-full mx-4">
            <i className="ri-loader-4-line text-5xl text-primary-500 animate-spin mb-4" />
            <h3 className="text-xl font-bold text-white mb-2 tracking-wide">{t('cache.refetchingTitle')}</h3>
            <p className="text-gray-400 text-center text-sm">
              <strong>{syncingDate}</strong> ({gcp?.timezone || 'UTC'}) {t('cache.refetchingDesc')}
            </p>
          </div>
        </div>
      )}

      <section className="bg-dark-800 border border-gray-700 rounded-lg p-6 relative">
        <div className="flex flex-col mb-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <i className="ri-database-2-line text-primary-400" />
            {t('cache.title')}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {t('cache.description')}
          </p>
          <button
            onClick={handleClearAllCache}
            disabled={clearingCache || syncStatus === 'syncing'}
            className="mt-2 px-3 py-1.5 bg-red-600/20 border border-red-500/50 rounded text-red-400 text-xs font-medium hover:bg-red-600/30 transition-colors disabled:opacity-50"
          >
            {clearingCache ? (
              <><i className="ri-loader-4-line animate-spin mr-1" />{t('cache.clearing')}</>
            ) : (
              <><i className="ri-delete-bin-line mr-1" />{t('cache.clearAll')}</>
            )}
          </button>
        </div>

        {!gcp ? (
          <p className="text-gray-500 text-sm">{t('cache.noMapping')}</p>
        ) : (
          <div className="bg-dark-700 p-4 rounded-lg border border-gray-600 max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                disabled={syncStatus === 'syncing'}
                className="p-1 hover:bg-dark-600 rounded text-gray-400 hover:text-white transition-colors"
              >
                <i className="ri-arrow-left-s-line text-xl" />
              </button>
              <div className="font-semibold text-white tracking-wide uppercase">
                {monthName}
              </div>
              <button
                onClick={nextMonth}
                disabled={syncStatus === 'syncing'}
                className="p-1 hover:bg-dark-600 rounded text-gray-400 hover:text-white transition-colors"
              >
                <i className="ri-arrow-right-s-line text-xl" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2 text-center text-xs font-medium text-gray-400">
              <div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div><div>Su</div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {days.map((dateStr, idx) => {
                if (!dateStr) {
                  return <div key={`empty-${idx}`} className="h-10"></div>;
                }

                const isToday = dateStr === todayStr;
                const isFuture = dateStr > todayStr;
                const isSuccess = syncingDate === dateStr && syncStatus === 'success';

                let cellClass = "h-10 rounded flex items-center justify-center text-sm font-medium transition-colors relative border ";

                if (isFuture) {
                  cellClass += "text-gray-600 border-transparent cursor-not-allowed opacity-50";
                } else {
                  cellClass += "cursor-pointer hover:border-primary-500 hover:bg-dark-600 border-dark-600 text-gray-300";
                }

                if (isToday && !isFuture) {
                  cellClass += " !text-primary-400 !font-bold ring-1 ring-primary-500";
                }

                if (isSuccess) {
                  cellClass += " !bg-green-600/20 !border-green-500 !text-green-400";
                }

                const dayNum = parseInt(dateStr.split('-')[2], 10);

                return (
                  <button
                    key={dateStr}
                    disabled={isFuture || syncStatus === 'syncing'}
                    className={cellClass}
                    onClick={() => handleSync(dateStr)}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
