import { useEffect, useMemo } from 'react';
import { useMonitoring } from '../context/MonitoringContext';
import { useProfile } from '../context/ProfileContext';
import { useAlerts } from '../context/AlertContext';
import { useSocStaleRule, AlertRuleContext } from './alertRules/socStaleRule';
import { useChargeStateChangeRule } from './alertRules/chargeStateChangeRule';
import { useBapDirectionMismatchRule } from './alertRules/bapDirectionMismatchRule';
import { useScheduleData } from './useScheduleData';
import { getFirstUevcb } from '@shared/types/assetMapping.types';

/**
 * Alert engine — runs all alert rules against live monitoring data.
 * Must be rendered inside both MonitoringProvider and AlertProvider.
 */
export function useAlertEngine() {
  const { currentBapPowerMW, currentSocMwh, data, lastUpdated, selectedDate } = useMonitoring();
  const { profile } = useProfile();
  const { addAlert, clearByRule, alerts } = useAlerts();

  const mapping = profile?.assetMapping ?? null;
  const uevcb = useMemo(() => getFirstUevcb(mapping), [mapping]);
  const tz = uevcb?.timezone || 'UTC';

  const schedulePlantId = uevcb?.primaryPortalPlantId ?? null;
  const scheduleDateKey = useMemo(
    () => selectedDate.toLocaleDateString('en-CA', { timeZone: tz }),
    [selectedDate, tz],
  );

  const { rows: scheduleRows } = useScheduleData({
    plantId: schedulePlantId,
    dateKey: scheduleDateKey,
    enabled: schedulePlantId !== null,
  });

  const socStaleCheck = useSocStaleRule();
  const chargeStateCheck = useChargeStateChangeRule();
  const bapMismatchCheck = useBapDirectionMismatchRule();

  useEffect(() => {
    // Don't run until we have data
    if (!lastUpdated) return;

    const ctx: AlertRuleContext = {
      currentBapPowerMW,
      currentSocMwh,
      data,
      lastUpdated,
      scheduleRows,
    };

    // --- Run each rule ---

    // 1. SoC Stale
    const socResult = socStaleCheck(ctx);
    if (socResult) {
      addAlert(socResult);
    } else {
      // Condition cleared — remove any existing alert for this rule
      if (alerts.some(a => a.ruleId === 'soc-stale')) {
        clearByRule('soc-stale');
      }
    }

    // 2. Charge State Changed
    const chargeStateResult = chargeStateCheck(ctx);
    if (chargeStateResult) {
      addAlert(chargeStateResult);
    }

    // 3. BAP Direction Mismatch (Schedule vs Actual)
    const bapMismatchResult = bapMismatchCheck(ctx);
    if (bapMismatchResult) {
      addAlert(bapMismatchResult);
    } else {
      if (alerts.some(a => a.ruleId === 'bap-direction-mismatch')) {
        clearByRule('bap-direction-mismatch');
      }
    }

  }, [lastUpdated, scheduleRows]); // eslint-disable-line react-hooks/exhaustive-deps
  // Runs on polling cycle or when schedule data updates
}
