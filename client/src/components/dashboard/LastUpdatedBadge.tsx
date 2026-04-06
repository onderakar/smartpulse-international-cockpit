import { useState, useEffect } from 'react';
import { formatRelativeTime } from '../../utils/time';
import { useLocale } from '../../context/LocaleContext';

interface LastUpdatedBadgeProps {
  timestamp: Date | null;
}

export function LastUpdatedBadge({ timestamp }: LastUpdatedBadgeProps) {
  const { t } = useLocale();
  const [display, setDisplay] = useState(formatRelativeTime(timestamp));

  // Update display every 5 seconds
  useEffect(() => {
    setDisplay(formatRelativeTime(timestamp));
    const interval = setInterval(() => {
      setDisplay(formatRelativeTime(timestamp));
    }, 5000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <span className="text-xs text-gray-500">
      {t('badge.updated')} {display}
    </span>
  );
}
