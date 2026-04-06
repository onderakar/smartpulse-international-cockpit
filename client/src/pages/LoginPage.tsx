import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';

export function LoginPage() {
  const { login, status, error } = useAuth();
  const navigate = useNavigate();
  const { t } = useLocale();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [env, setEnv] = useState('prod');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password, env);
      navigate('/dashboard', { replace: true });
    } catch {
      // Error is handled in AuthContext
    }
  };

  const isLoading = status === 'loading';

  return (
    <div className="flex items-center justify-center min-h-screen bg-dark-900">
      <div className="w-full max-w-md p-8 bg-dark-800 rounded-xl border border-gray-700 shadow-2xl">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">
            <span className="text-white">smart</span><span className="text-primary-400">Pulse</span>
            <span className="text-gray-400 text-lg ml-2">{t('login.title')}</span>
          </h1>
          <p className="text-gray-400 mt-2 text-sm">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Environment selector */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('login.environment')}</label>
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="prod">{t('login.envProd')}</option>
              <option value="staging">{t('login.envStaging')}</option>
              <option value="demo">{t('login.envDemo')}</option>
            </select>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('login.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('login.usernamePlaceholder')}
              required
              autoFocus
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('login.passwordPlaceholder')}
              required
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary-600 hover:bg-primary-700 disabled:bg-primary-800 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            {isLoading ? t('login.loggingIn') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
