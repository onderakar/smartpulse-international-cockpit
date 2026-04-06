import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { useAuth } from './AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Alert {
  id: string;
  ruleId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

export interface AlertContextValue {
  alerts: Alert[];
  unreadCount: number;
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'read'>) => void;
  dismissAlert: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearByRule: (ruleId: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AlertContext = createContext<AlertContextValue | null>(null);

const MAX_ALERTS = 50;

let alertCounter = 0;
function nextId(): string {
  return `alert-${Date.now()}-${++alertCounter}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AlertProvider({ children }: { children: ReactNode }) {
  const { username } = useAuth();
  const prevUsernameRef = useRef<string | null | undefined>(undefined);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Clear all alerts when user identity changes (multi-tenancy isolation)
  useEffect(() => {
    if (prevUsernameRef.current === undefined) {
      // First mount — just record
      prevUsernameRef.current = username;
      return;
    }
    if (prevUsernameRef.current !== username) {
      prevUsernameRef.current = username;
      setAlerts([]);
    }
  }, [username]);

  const addAlert = useCallback(
    (input: Omit<Alert, 'id' | 'timestamp' | 'read'>) => {
      setAlerts(prev => {
        // Dedup: don't add if an unread alert with same ruleId already exists
        if (prev.some(a => a.ruleId === input.ruleId && !a.read)) {
          return prev;
        }

        const newAlert: Alert = {
          ...input,
          id: nextId(),
          timestamp: new Date(),
          read: false,
        };

        // Fire custom event
        window.dispatchEvent(
          new CustomEvent('alert:new', { detail: newAlert }),
        );

        const next = [newAlert, ...prev];
        // Trim to max
        return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next;
      });
    },
    [],
  );

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const markAsRead = useCallback((id: string) => {
    setAlerts(prev =>
      prev.map(a => (a.id === id ? { ...a, read: true } : a)),
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setAlerts(prev => prev.map(a => (a.read ? a : { ...a, read: true })));
  }, []);

  const clearByRule = useCallback((ruleId: string) => {
    setAlerts(prev => prev.filter(a => a.ruleId !== ruleId));
  }, []);

  const unreadCount = useMemo(
    () => alerts.filter(a => !a.read).length,
    [alerts],
  );

  const value = useMemo<AlertContextValue>(
    () => ({
      alerts,
      unreadCount,
      addAlert,
      dismissAlert,
      markAsRead,
      markAllAsRead,
      clearByRule,
    }),
    [alerts, unreadCount, addAlert, dismissAlert, markAsRead, markAllAsRead, clearByRule],
  );

  return (
    <AlertContext.Provider value={value}>{children}</AlertContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useAlerts(): AlertContextValue {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlerts must be used within AlertProvider');
  }
  return context;
}
