import { useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  callback: () => Promise<void>;
  intervalMs: number;
  enabled: boolean;
  immediate?: boolean;
}

export function usePolling({ callback, intervalMs, enabled, immediate = true }: UsePollingOptions) {
  const savedCallback = useRef(callback);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const start = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (immediate) {
      savedCallback.current().catch(console.error);
    }

    intervalRef.current = setInterval(() => {
      savedCallback.current().catch(console.error);
    }, intervalMs);
  }, [intervalMs, immediate]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [enabled, start, stop]);

  const triggerNow = useCallback(() => {
    savedCallback.current().catch(console.error);
  }, []);

  return { triggerNow };
}
