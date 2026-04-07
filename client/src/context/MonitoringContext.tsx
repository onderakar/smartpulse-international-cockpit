import { createContext, useContext, useState, type ReactNode } from 'react';
import { LiveSnapshot, LiveMonitoringData } from '@smartpulse-intl/shared';

/** Stub MonitoringContext — will be replaced when monitoring integration is built. */

interface MonitoringContextValue {
  currentBapPowerMW: number | null;
  currentSocMwh: number | null;
  data: LiveMonitoringData | null;
  lastUpdated: number | null;
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  liveSnapshot: LiveSnapshot | null;
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const value: MonitoringContextValue = {
    currentBapPowerMW: null,
    currentSocMwh: null,
    data: null,
    lastUpdated: null,
    selectedDate,
    setSelectedDate,
    liveSnapshot: null,
  };

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
}

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) {
    // Return safe defaults if used outside provider
    return {
      currentBapPowerMW: null,
      currentSocMwh: null,
      data: null,
      lastUpdated: null,
      selectedDate: new Date(),
      setSelectedDate: () => {},
      liveSnapshot: null,
    };
  }
  return ctx;
}
