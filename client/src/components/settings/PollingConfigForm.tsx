import { useState, useEffect } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { DEFAULT_POLLING_CONFIG } from '@shared/types/dashboard.types';

export function PollingConfigForm() {
    const { profile, updateProfile } = useProfile();
    const { t } = useLocale();
    const polling = profile?.polling || DEFAULT_POLLING_CONFIG;
    const [scheduleIntervalSeconds, setScheduleIntervalSeconds] = useState(
        polling.scheduleIntervalSeconds || 300
    );
    const [intervalSeconds, setIntervalSeconds] = useState(
        polling.intervalSeconds || 60
    );

    useEffect(() => {
        if (profile?.polling) {
            setScheduleIntervalSeconds(profile.polling.scheduleIntervalSeconds || 300);
            setIntervalSeconds(profile.polling.intervalSeconds || 60);
        }
    }, [profile?.polling]);

    const handleSave = async () => {
        await updateProfile({
            polling: {
                ...polling,
                scheduleIntervalSeconds: Number(scheduleIntervalSeconds),
                intervalSeconds: Number(intervalSeconds),
            },
        });
    };

    return (
        <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                    <i className="ri-timer-line text-primary-400" />
                    {'API Query Intervals'}
                </h3>
                <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded text-sm transition-colors"
                >
                    {t('common.save') || 'Save'}
                </button>
            </div>
            <div className="flex flex-col gap-4">
                <div>
                    <label className="block text-sm text-[#a0a0b0] mb-1">
                        Monitoring API Target Refresh (Seconds)
                    </label>
                    <input
                        type="number"
                        min="5"
                        value={intervalSeconds}
                        onChange={(e) => setIntervalSeconds(e.target.value as any)}
                        className="w-full bg-[#13131a] border border-[#2a2a3e] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    />
                    <p className="text-xs text-[#a0a0b0] mt-1">
                        The frontend UI refresh rate for Live Monitoring data charts. Defaults to 60.
                    </p>
                </div>
                <div>
                    <label className="block text-sm text-[#a0a0b0] mb-1">
                        Schedule API Target Refresh (Seconds)
                    </label>
                    <input
                        type="number"
                        min="10"
                        value={scheduleIntervalSeconds}
                        onChange={(e) => setScheduleIntervalSeconds(e.target.value as any)}
                        className="w-full bg-[#13131a] border border-[#2a2a3e] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500"
                    />
                    <p className="text-xs text-[#a0a0b0] mt-1">
                        The background refresh rate for the FTP battery schedule endpoint. Defaults to 300 (5 minutes).
                    </p>
                </div>
            </div>
        </div>
    );
}
