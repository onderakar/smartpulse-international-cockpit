import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { getFirstGcp } from '@shared/types/assetMapping.types';
import { Link, useLocation } from 'react-router-dom';
import { AlertBell } from './AlertBell';

export function Header() {
  const { logout } = useAuth();
  const { profile } = useProfile();
  const { locale, setLocale, t } = useLocale();
  const location = useLocation();
  const activeGcp = getFirstGcp(profile?.assetMapping);

  const isActive = (path: string) =>
    location.pathname === path ? 'text-primary-400 border-b-2 border-primary-400' : 'text-gray-400 hover:text-gray-200';

  return (
    <header className="bg-dark-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
      {/* Left: Nav */}
      <div className="flex items-center gap-6">
        <img src="/smartpulse-logo.svg" alt="smartPulse" className="h-6 mr-4" />
        <nav className="flex gap-4">
          <Link to="/dashboard" className={`pb-1 text-sm font-medium transition-colors ${isActive('/dashboard')}`}>
            {t('nav.dashboard')}
          </Link>
          <Link to="/battery-params" className={`pb-1 text-sm font-medium transition-colors ${isActive('/battery-params')}`}>
            {t('nav.batteryParams')}
          </Link>
          <Link to="/forecast" className={`pb-1 text-sm font-medium transition-colors ${isActive('/forecast')}`}>
            {t('nav.forecast')}
          </Link>
          <Link to="/battery-program" className={`pb-1 text-sm font-medium transition-colors ${isActive('/battery-program')}`}>
            {t('nav.batteryProgram')}
          </Link>
          <Link to="/settings" className={`pb-1 text-sm font-medium transition-colors ${isActive('/settings')}`}>
            {t('nav.settings')}
          </Link>
        </nav>
      </div>

      {/* Right: Lang + Alerts + Plant info + Logout */}
      <div className="flex items-center gap-4">
        {/* Language toggle */}
        <div className="flex items-center rounded-md border border-gray-600 overflow-hidden text-[11px]">
          <button
            onClick={() => setLocale('tr')}
            className={`px-2 py-1 transition-colors ${
              locale === 'tr'
                ? 'bg-primary-600 text-white'
                : 'bg-dark-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            TR
          </button>
          <button
            onClick={() => setLocale('en')}
            className={`px-2 py-1 transition-colors ${
              locale === 'en'
                ? 'bg-primary-600 text-white'
                : 'bg-dark-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            EN
          </button>
        </div>
        <AlertBell />
        {activeGcp && (
          <span className="text-xs text-gray-400 bg-dark-700 px-3 py-1 rounded-full">
            {activeGcp.name}
          </span>
        )}
        <button
          onClick={logout}
          className="text-xs text-gray-400 hover:text-red-400 transition-colors"
        >
          {t('common.logout')}
        </button>
      </div>
    </header>
  );
}
