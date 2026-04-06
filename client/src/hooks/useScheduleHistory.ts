import { useState, useCallback, useRef } from 'react';
import { ScheduleHistoryData, SCHEDULE_POLLING_INTERVAL_SECONDS } from '@smartpulse-intl/shared';
import { scheduleApi } from '../api/schedule.api';
import { usePolling } from './usePolling';
import { useProfile } from '../context/ProfileContext';

interface UseScheduleHistoryOptions {
    plantId: number | null;
    dateKey?: string;
    enabled?: boolean;
}

export function useScheduleHistory({ plantId, dateKey, enabled = true }: UseScheduleHistoryOptions) {
    const { profile } = useProfile();
    const pollingInterval = profile?.polling?.scheduleIntervalSeconds ?? SCHEDULE_POLLING_INTERVAL_SECONDS;

    const [history, setHistory] = useState<ScheduleHistoryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const isFirstLoad = useRef(true);

    const fetchCallback = useCallback(async () => {
        if (!plantId) return;

        if (isFirstLoad.current) {
            setLoading(true);
        }

        try {
            const result = await scheduleApi.readHistory(plantId, dateKey);
            setHistory(result);
            setError(null);
            isFirstLoad.current = false;
        } catch (err: any) {
            setError(err.message || 'Failed to load history');
        } finally {
            setLoading(false);
        }
    }, [plantId, dateKey]);

    usePolling({
        callback: fetchCallback,
        intervalMs: pollingInterval * 1000,
        enabled: enabled && plantId !== null,
        immediate: true,
    });

    return { history, loading, error, fetchHistory: fetchCallback };
}
