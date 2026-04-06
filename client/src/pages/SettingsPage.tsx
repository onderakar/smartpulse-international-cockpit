import { useRef } from 'react';
import { AssetMappingForm } from '../components/settings/AssetMappingForm';
import { MonitoringCredentialsForm } from '../components/settings/MonitoringCredentialsForm';
import { GQLTestConfig } from '../components/settings/GQLTestConfig';
import { CacheManagement } from '../components/settings/CacheManagement';
import { PollingConfigForm } from '../components/settings/PollingConfigForm';
import { useLocale } from '../context/LocaleContext';
import { useProfile } from '../context/ProfileContext';
import { DashboardProfile } from '@shared/types/dashboard.types';
import toast from 'react-hot-toast';

export function SettingsPage() {
  const { t } = useLocale();
  const { profile, updateProfile } = useProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (!profile) return;

    // Deep clone and sanitize
    const sanitized = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    delete sanitized.id;
    delete sanitized.createdAt;
    delete sanitized.updatedAt;

    // Mask password
    const creds = sanitized.monitoringCredentials as { username?: string; password?: string } | undefined;
    if (creds?.password) {
      creds.password = '***';
    }

    const json = JSON.stringify(sanitized, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smartpulse-settings-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(t('settings.exportSuccess'));
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as Partial<DashboardProfile>;

        // Validate required fields
        if (!parsed.assetMapping || !parsed.polling) {
          toast.error(t('settings.importError'));
          return;
        }

        // Preserve existing password if masked
        if (parsed.monitoringCredentials?.password === '***' && profile?.monitoringCredentials?.password) {
          parsed.monitoringCredentials.password = profile.monitoringCredentials.password;
        }

        // Strip regenerated fields
        delete parsed.id;
        delete (parsed as Record<string, unknown>).createdAt;
        delete (parsed as Record<string, unknown>).updatedAt;

        // Confirm if current mapping has companies and import would change it
        const existingCount = profile?.assetMapping?.companies?.length ?? 0;
        if (existingCount > 0 && parsed.assetMapping) {
          if (!window.confirm(t('settings.importConfirmMapping'))) return;
        }

        updateProfile(parsed);
        toast.success(t('settings.importSuccess'));
      } catch {
        toast.error(t('settings.importParseError'));
      }
    };
    reader.onerror = () => toast.error(t('settings.importParseError'));
    reader.readAsText(file);

    // Reset so re-uploading the same file works
    e.target.value = '';
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-white mb-6">{t('settings.title')}</h2>
      <div className="space-y-6">
        <AssetMappingForm />
        <MonitoringCredentialsForm />
        <GQLTestConfig />
        <CacheManagement />
        <PollingConfigForm />

        {/* Schedule BAP Editable toggle */}
        <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-white flex items-center gap-2">
                <i className="ri-edit-line text-primary-400" />
                {t('settings.scheduleBapEditable')}
              </h3>
              <p className="text-xs text-[#a0a0b0] mt-1">{t('settings.scheduleBapEditableDesc')}</p>
            </div>
            <button
              onClick={() => updateProfile({ scheduleBapEditable: !(profile?.scheduleBapEditable ?? true) })}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                (profile?.scheduleBapEditable ?? true) ? 'bg-primary-600' : 'bg-gray-700'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                (profile?.scheduleBapEditable ?? true) ? 'translate-x-5' : ''
              }`} />
            </button>
          </div>
        </div>

        {/* Export / Import */}
        <div className="bg-gray-800 rounded-xl p-5">
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={!profile}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('settings.exportSettings')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-gray-600 hover:bg-gray-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('settings.importSettings')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
