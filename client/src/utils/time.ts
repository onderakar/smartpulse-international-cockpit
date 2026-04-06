/**
 * Format a date as relative time string (e.g. "2 min ago")
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return 'Never';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

/**
 * Get the time window boundaries for monitoring data fetch.
 */
export function getTimeWindow(hoursBack: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: now.toISOString(),
  };
}
