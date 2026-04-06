import { useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AlertRuleContext, AlertRuleResult } from './socStaleRule';

export type ChargeStatus = 'idle' | 'charging' | 'discharging';

export function useChargeStateChangeRule() {
    const { username } = useAuth();
    const prevStateRef = useRef<ChargeStatus | null>(null);
    const prevSocRef = useRef<number | null>(null);

    // Reset refs when user changes (multi-tenancy isolation)
    useEffect(() => {
        prevStateRef.current = null;
        prevSocRef.current = null;
    }, [username]);

    return (ctx: AlertRuleContext): AlertRuleResult | null => {
        const { currentBapPowerMW, currentSocMwh } = ctx;

        // Track SoC to update the prev reference
        if (prevSocRef.current === null && currentSocMwh !== null) {
            prevSocRef.current = currentSocMwh;
        }

        // Determine current status based on Active Power
        let currentStatus: ChargeStatus = 'idle';
        if (currentBapPowerMW !== null) {
            if (currentBapPowerMW < -0.01) currentStatus = 'charging';
            else if (currentBapPowerMW > 0.01) currentStatus = 'discharging';
        }

        // On first load, just record state
        if (prevStateRef.current === null) {
            prevStateRef.current = currentStatus;
            if (currentSocMwh !== null) prevSocRef.current = currentSocMwh;
            return null;
        }

        let alertResult: AlertRuleResult | null = null;

        // Condition 1: Charge State Changed (Idle -> Charging -> Discharging)
        if (currentStatus !== prevStateRef.current) {
            const prevStatus = prevStateRef.current;

            const labels: Record<ChargeStatus, string> = {
                idle: 'Beklemede (0 MW)',
                charging: 'Şarj Oluyor',
                discharging: 'Deşarj Oluyor'
            };

            alertResult = {
                ruleId: `charge-status-change-${Date.now()}`,
                severity: 'info',
                title: 'ŞARJ Durumu Değişti',
                message: `Batarya durumu "${labels[prevStatus]}" konumundan "${labels[currentStatus]}" konumuna geçti. Güncel SoC: ${currentSocMwh?.toFixed(2) || '-'} MWh`,
            };

            prevStateRef.current = currentStatus;
            if (currentSocMwh !== null) prevSocRef.current = currentSocMwh;

            return alertResult;
        }

        // Condition 2: Literal charge amount (SoC) changed significantly? 
        // The user strictly asked "Eğer şarj miktarı bir önceki data pointten değiştiyse ŞARJ durumu değişti diye bir alarm".
        // I will trigger it if SoC changed by more than 0.1 MWh (to avoid spamming every second on tiny fluctuations),
        // OR if BAP itself jumped significantly.
        // Let's rely on the state transition above primarily, but if they specifically want it on ANY SoC change:
        if (currentSocMwh !== null && prevSocRef.current !== null) {
            const delta = Math.abs(currentSocMwh - prevSocRef.current);
            // Firing if SoC changes by more than 0.01 MWh between points (to respect the literal request while mitigating spam)
            if (delta > 0.01 && alertResult === null) {
                alertResult = {
                    ruleId: `soc-amount-change-${Date.now()}`,
                    severity: 'info',
                    title: 'Şarj Miktarı / Durumu Değişti',
                    message: `Şarj miktarı değişti. Eski: ${prevSocRef.current.toFixed(2)}, Yeni: ${currentSocMwh.toFixed(2)} MWh.`,
                };
                prevSocRef.current = currentSocMwh;
                return alertResult;
            }
        }

        if (currentSocMwh !== null) prevSocRef.current = currentSocMwh;

        return null;
    };
}
