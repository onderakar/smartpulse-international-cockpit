import { useState, useRef, useEffect, useCallback } from 'react';
import { useAlerts, Alert } from '../../context/AlertContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'az once';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk once`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat once`;
  return `${Math.floor(hours / 24)} gun once`;
}

const SEVERITY_COLORS: Record<Alert['severity'], string> = {
  info: 'bg-primary-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
};

const SEVERITY_TEXT: Record<Alert['severity'], string> = {
  info: 'text-primary-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlertBell() {
  const { alerts, unreadCount, markAsRead, markAllAsRead } = useAlerts();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={toggle}
        className="relative p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-dark-700 transition-colors"
        title="Bildirimler"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 bg-dark-800 border border-gray-700 rounded-lg shadow-2xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/50">
            <span className="text-sm font-medium text-gray-200">
              Bildirimler
              {unreadCount > 0 && (
                <span className="ml-1.5 text-xs text-gray-500">({unreadCount})</span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[11px] text-primary-400 hover:text-primary-300 transition-colors"
              >
                Tumunu oku
              </button>
            )}
          </div>

          {/* Alert list */}
          <div className="max-h-72 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-gray-500">
                Bildirim yok
              </div>
            ) : (
              alerts.map(alert => (
                <button
                  key={alert.id}
                  onClick={() => markAsRead(alert.id)}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-b border-gray-700/30 hover:bg-dark-700/50 transition-colors ${
                    !alert.read ? 'bg-dark-700/20' : ''
                  }`}
                >
                  {/* Severity bar */}
                  <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${SEVERITY_COLORS[alert.severity]}`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${SEVERITY_TEXT[alert.severity]}`}>
                        {alert.title}
                      </span>
                      {!alert.read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                      {alert.message}
                    </p>
                    <span className="text-[10px] text-gray-600 mt-1 block">
                      {timeAgo(alert.timestamp)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
