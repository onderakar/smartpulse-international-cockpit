import { useRef, useEffect } from 'react';
import { LiveMonitoringData } from '@shared/types/monitoring.types';
import { ScheduleRow } from '@smartpulse-intl/shared';
import { useAuth } from '../../context/AuthContext';

// ---------------------------------------------------------------------------
// Rule context (shared by all rules)
// ---------------------------------------------------------------------------

export interface AlertRuleContext {
  currentBapPowerMW: number | null;
  currentSocMwh: number | null;
  data: LiveMonitoringData | null;
  lastUpdated: Date | null;
  scheduleRows?: ScheduleRow[];
}

export interface AlertRuleResult {
  ruleId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
}

// ---------------------------------------------------------------------------
// SoC Stale Rule
// ---------------------------------------------------------------------------
// Fires when battery is actively charging/discharging (BAP != 0)
// but SoC hasn't changed for THRESHOLD_MS.

const THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const SOC_TOLERANCE = 0.001; // MWh — ignore sub-kWh noise

export function useSocStaleRule() {
  const { username } = useAuth();
  const prevSocRef = useRef<number | null>(null);
  const lastSocChangeRef = useRef<number>(Date.now());
  const wasActiveRef = useRef(false);

  // Reset refs when user changes (multi-tenancy isolation)
  useEffect(() => {
    prevSocRef.current = null;
    lastSocChangeRef.current = Date.now();
    wasActiveRef.current = false;
  }, [username]);

  return (ctx: AlertRuleContext): AlertRuleResult | null => {
    const { currentBapPowerMW, currentSocMwh } = ctx;

    // Battery idle — reset tracking, no alert
    if (currentBapPowerMW === null || Math.abs(currentBapPowerMW) < 0.01) {
      wasActiveRef.current = false;
      prevSocRef.current = currentSocMwh;
      lastSocChangeRef.current = Date.now();
      return null;
    }

    // Battery is active
    if (!wasActiveRef.current) {
      // Just became active — start tracking
      wasActiveRef.current = true;
      prevSocRef.current = currentSocMwh;
      lastSocChangeRef.current = Date.now();
      return null;
    }

    // Check if SoC changed
    if (currentSocMwh !== null && prevSocRef.current !== null) {
      const delta = Math.abs(currentSocMwh - prevSocRef.current);
      if (delta > SOC_TOLERANCE) {
        // SoC changed — reset timer
        prevSocRef.current = currentSocMwh;
        lastSocChangeRef.current = Date.now();
        return null;
      }
    }

    // SoC hasn't changed — check if stale
    const staleDuration = Date.now() - lastSocChangeRef.current;
    if (staleDuration >= THRESHOLD_MS) {
      const minutes = Math.floor(staleDuration / 60000);
      return {
        ruleId: 'soc-stale',
        severity: 'warning',
        title: 'SoC Degismiyor',
        message: `Batarya aktif (${currentBapPowerMW?.toFixed(2)} MW) ancak SoC ${minutes} dakikadir degismedi.`,
      };
    }

    return null;
  };
}
