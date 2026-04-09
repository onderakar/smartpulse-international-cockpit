import { useState, useEffect, useCallback, useRef } from 'react';
import { fileApi, LatestParsedDto } from '../api/file.api';

interface UseFileSourceOptions {
  /** Trigger FTP background refresh on mount (default: true) */
  autoRefresh?: boolean;
}

interface UseFileSourceResult<T> {
  raw: string | null;
  parsed: T | null;
  loading: boolean;
  refreshing: boolean;
  versionNo: number | null;
  fetchedAt: string | null;
  error: string | null;
  /** DB instant read + background FTP refresh */
  refresh: () => Promise<void>;
  /** FTP force-read (wait) + attribute sync + re-fetch */
  forceReadAndSync: () => Promise<any>;
}

export function useFileSource<T = unknown>(key: string, options: UseFileSourceOptions = {}): UseFileSourceResult<T> {
  const { autoRefresh = true } = options;
  const [data, setData] = useState<LatestParsedDto<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchLatest = useCallback(async () => {
    try {
      const result = await fileApi.getLatestParsed<T>(key);
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err: any) {
      // 404 = no version yet, not a hard error
      if (err?.response?.status !== 404 && mountedRef.current) {
        setError(err?.response?.data?.message || err.message);
      }
    }
  }, [key]);

  const triggerFtpRefresh = useCallback(async () => {
    if (mountedRef.current) setRefreshing(true);
    try {
      await fileApi.forceRead(key);
      // Re-fetch from DB to get the (possibly new) version
      await fetchLatest();
    } catch (err: any) {
      console.warn(`[useFileSource] FTP refresh failed for ${key}:`, err.message);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [key, fetchLatest]);

  const refresh = useCallback(async () => {
    await fetchLatest();           // DB instant
    triggerFtpRefresh();           // FTP background (fire and forget)
  }, [fetchLatest, triggerFtpRefresh]);

  const forceReadAndSync = useCallback(async () => {
    if (mountedRef.current) setRefreshing(true);
    try {
      const result = await fileApi.forceReadAndSync(key);
      await fetchLatest();
      return result;
    } catch (err: any) {
      if (mountedRef.current) setError(err?.response?.data?.message || err.message);
      throw err;
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [key, fetchLatest]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      setLoading(true);
      await fetchLatest();
      if (mountedRef.current) setLoading(false);
      if (autoRefresh && mountedRef.current) {
        triggerFtpRefresh();
      }
    })();

    return () => { mountedRef.current = false; };
  }, [fetchLatest, autoRefresh, triggerFtpRefresh]);

  return {
    raw: data?.raw ?? null,
    parsed: data?.parsed ?? null,
    loading,
    refreshing,
    versionNo: data?.versionNo ?? null,
    fetchedAt: data?.fetchedAt ?? null,
    error,
    refresh,
    forceReadAndSync,
  };
}
