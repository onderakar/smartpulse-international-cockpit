import { useState } from 'react';
import { monitoringApi } from '../../api/monitoring.api';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';

export function MonitoringCredentialsForm() {
  const { profile, updateProfile } = useProfile();
  const { t } = useLocale();

  const [username, setUsername] = useState(profile?.monitoringCredentials?.username ?? '');
  const [password, setPassword] = useState(profile?.monitoringCredentials?.password ?? '');
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    if (!username || !password) return;

    updateProfile({
      monitoringCredentials: { username, password },
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleTestConnection = async () => {
    if (!username || !password) return;

    // Always save before testing
    updateProfile({
      monitoringCredentials: { username, password },
    });

    setStatus('testing');
    setErrorMsg('');

    try {
      await monitoringApi.login({ username, password });
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.response?.data?.message || err.message || 'Connection failed');
    }
  };

  return (
    <section className="bg-dark-800 border border-gray-700 rounded-lg p-6">
      <h3 className="text-lg font-medium text-white mb-4">{t('monitoringCreds.title')}</h3>
      <p className="text-xs text-gray-500 mb-4">
        {t('monitoringCreds.description')}
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('monitoringCreds.username')}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t('monitoringCreds.usernamePlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('monitoringCreds.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t('monitoringCreds.passwordPlaceholder')}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!username || !password}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {t('monitoringCreds.saveCredentials')}
          </button>

          <button
            onClick={handleTestConnection}
            disabled={!username || !password || status === 'testing'}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {status === 'testing' ? t('monitoringCreds.testing') : t('monitoringCreds.testConnection')}
          </button>

          {isSaved && (
            <span className="text-green-400 text-sm font-medium animate-pulse">
              {t('monitoringCreds.savedSuccess')}
            </span>
          )}
          {status === 'success' && !isSaved && (
            <span className="text-green-400 text-sm">{t('monitoringCreds.connected')}</span>
          )}
          {status === 'error' && !isSaved && (
            <span className="text-red-400 text-sm">{errorMsg}</span>
          )}
        </div>
      </div>
    </section>
  );
}
