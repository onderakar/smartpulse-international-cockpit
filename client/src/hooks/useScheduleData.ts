import { useState, useCallback, useRef } from 'react';
import { ScheduleRow, SCHEDULE_POLLING_INTERVAL_SECONDS } from '@smartpulse-intl/shared';
import { scheduleApi } from '../api/schedule.api';
import { usePolling } from './usePolling';
import { useProfile } from '../context/ProfileContext';

interface UseScheduleDataOptions {
  plantId: number | null;
  dateKey?: string;
  enabled?: boolean;
}

interface UseScheduleDataResult {
  rows: ScheduleRow[];
  header: string[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  hasExternalChanges: boolean;
  fetchSchedule: () => void;
}

export function useScheduleData({ plantId, dateKey, enabled = true }: UseScheduleDataOptions): UseScheduleDataResult {
  const { profile } = useProfile();
  const pollingInterval = profile?.polling?.scheduleIntervalSeconds ?? SCHEDULE_POLLING_INTERVAL_SECONDS;

  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [header, setHeader] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const isFirstLoad = useRef(true);

  const fetchCallback = useCallback(async () => {
    if (!plantId) return;

    // Only show loading on first fetch
    if (isFirstLoad.current) {
      setLoading(true);
    }

    try {
      const result = await scheduleApi.readSchedule(plantId, dateKey);
      setRows(result.rows);
      setHeader(result.header);
      setLastFetchedAt(result.lastFetchedAt);
      setError(null);

      // After first load, flag external changes on subsequent polls
      if (!isFirstLoad.current && result.hasChanges) {
        setHasExternalChanges(true);
      }
      isFirstLoad.current = false;
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Schedule yuklenemedi';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [plantId, dateKey]);

  const { triggerNow } = usePolling({
    callback: fetchCallback,
    intervalMs: pollingInterval * 1000,
    enabled: enabled && plantId !== null,
    immediate: true,
  });

  return {
    rows,
    header,
    loading,
    error,
    lastFetchedAt,
    hasExternalChanges,
    fetchSchedule: triggerNow,
  };
}
