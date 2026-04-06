import { useLocale } from '../../context/LocaleContext';
import { TranslationKey } from '@shared/constants/translations';
import { AlertRuleContext, AlertRuleResult } from './socStaleRule';
import { ScheduleRow } from '@smartpulse-intl/shared';

// ---------------------------------------------------------------------------
// BAP Direction Mismatch Rule
// ---------------------------------------------------------------------------
// Fires when Schedule BAP and Actual BAP have different signs (directions)
// for the current slot or the immediately preceding slot.
//
// Mismatch cases:
//   Schedule +  vs  Actual -    (discharge scheduled, actually charging)
//   Schedule +  vs  Actual 0    (discharge scheduled, actually idle)
//   Schedule -  vs  Actual +    (charge scheduled, actually discharging)
//   Schedule -  vs  Actual 0    (charge scheduled, actually idle)
//   Schedule 0  vs  Actual +    (idle scheduled, actually discharging)
//   Schedule 0  vs  Actual -    (idle scheduled, actually charging)

const BAP_THRESHOLD = 0.05; // MW — below this absolute value is "zero"

type BapSign = -1 | 0 | 1;

function bapSign(value: number): BapSign {
  if (value > BAP_THRESHOLD) return 1;
  if (value < -BAP_THRESHOLD) return -1;
  return 0;
}

function signLabel(sign: BapSign, t: (key: TranslationKey) => string): string {
  if (sign > 0) return t('alerts.bapMismatch.discharge');
  if (sign < 0) return t('alerts.bapMismatch.charge');
  return t('alerts.bapMismatch.zero');
}

/** Find the schedule slot that contains the given timestamp */
function findCurrentSlot(rows: ScheduleRow[], tsMs: number): ScheduleRow | undefined {
  return rows.find(r => {
    const start = new Date(r.Delivery_Start).getTime();
    const end = new Date(r.Delivery_End).getTime();
    return tsMs >= start && tsMs < end;
  });
}

/** Find the slot immediately before the given slot */
function findPrevSlot(rows: ScheduleRow[], currentSlot: ScheduleRow): ScheduleRow | undefined {
  const currentStartMs = new Date(currentSlot.Delivery_Start).getTime();
  return rows.find(r => {
    const endMs = new Date(r.Delivery_End).getTime();
    return Math.abs(endMs - currentStartMs) < 1000; // within 1s tolerance
  });
}

/** Average of actual BAP data points within [startMs, endMs) */
function avgBapInRange(
  bapPoints: { timestamp: number; value: number }[],
  startMs: number,
  endMs: number,
): number | null {
  const pts = bapPoints.filter(p => p.timestamp >= startMs && p.timestamp < endMs);
  if (pts.length === 0) return null;
  return pts.reduce((sum, p) => sum + p.value, 0) / pts.length;
}

export function useBapDirectionMismatchRule() {
  const { t } = useLocale();

  // AlertContext already deduplicates unread alerts with the same ruleId,
  // so we can return the result on every cycle without extra ref-tracking.
  // When condition clears, useAlertEngine calls clearByRule('bap-direction-mismatch').

  return (ctx: AlertRuleContext): AlertRuleResult | null => {
    const { data, scheduleRows } = ctx;
    if (!data?.batteryActivePower?.length || !scheduleRows?.length) return null;

    const now = Date.now();
    const currentSlot = findCurrentSlot(scheduleRows, now);
    if (!currentSlot) return null;

    const prevSlot = findPrevSlot(scheduleRows, currentSlot);

    const mismatches: string[] = [];

    const checkSlot = (slot: ScheduleRow, label: string) => {
      const startMs = new Date(slot.Delivery_Start).getTime();
      const endMs = new Date(slot.Delivery_End).getTime();

      const scheduleBap = Number(slot.Battery_Active_Power_MW) || 0;
      const actualBap = avgBapInRange(data.batteryActivePower, startMs, endMs);
      if (actualBap === null) return;

      const schedSign = bapSign(scheduleBap);
      const actSign = bapSign(actualBap);

      if (schedSign !== actSign) {
        const slotTime = slot.Delivery_Start.slice(11, 16); // HH:MM
        mismatches.push(
          `${label} (${slotTime}): ${t('alerts.bapMismatch.scheduled')} ${scheduleBap.toFixed(2)} MW [${signLabel(schedSign, t)}] → ${t('alerts.bapMismatch.actual')} ${actualBap.toFixed(2)} MW [${signLabel(actSign, t)}]`
        );
      }
    };

    checkSlot(currentSlot, t('alerts.bapMismatch.currentSlot'));
    if (prevSlot) {
      checkSlot(prevSlot, t('alerts.bapMismatch.prevSlot'));
    }

    if (mismatches.length === 0) return null;

    return {
      ruleId: 'bap-direction-mismatch',
      severity: 'warning',
      title: t('alerts.bapMismatch.title'),
      message: mismatches.join(' / '),
    };
  };
}
