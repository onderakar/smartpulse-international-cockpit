import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi } from '../api/auth.api';
import { PortalPlant, PortalCompany } from '@shared/types/auth.types';
import { DashboardProfile } from '@shared/types/dashboard.types';
import { TRANSLATIONS, AppLocale } from '@shared/constants/translations';
import toast from 'react-hot-toast';

/** Read locale directly from localStorage (AuthContext may render outside LocaleProvider) */
function getLocale(): AppLocale {
  try {
    const v = localStorage.getItem('smartpulse-locale');
    if (v === 'en' || v === 'tr') return v;
  } catch { /* ignore */ }
  return 'tr';
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'loading' | 'error';

interface AuthState {
  status: AuthStatus;
  plants: PortalPlant[];
  companies: PortalCompany[];
  username: string | null;
  groupId: number | null;
  groupName: string | null;
  initialProfile: DashboardProfile | null;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string, env: string) => Promise<void>;
  logout: () => Promise<void>;
  clearInitialProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_STATE: AuthState = {
  status: 'unauthenticated',
  plants: [],
  companies: [],
  username: null,
  groupId: null,
  groupName: null,
  initialProfile: null,
  error: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'checking',
    plants: [],
    companies: [],
    username: null,
    groupId: null,
    groupName: null,
    initialProfile: null,
    error: null,
  });

  // Check session on mount
  useEffect(() => {
    authApi.checkSession()
      .then(res => {
        if (res.loggedIn && res.plants) {
          setState({
            status: 'authenticated',
            plants: res.plants,
            companies: res.companies ?? [],
            username: res.username ?? null,
            groupId: res.groupId ?? null,
            groupName: res.groupName ?? null,
            initialProfile: null,
            error: null,
          });
        } else {
          setState(EMPTY_STATE);
        }
      })
      .catch(() => {
        setState(EMPTY_STATE);
      });
  }, []);

  // Keep-alive: periodically ping portal to prevent session expiry (every 5 min)
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const interval = setInterval(() => {
      authApi.checkSession()
        .then(res => {
          if (!res.loggedIn) {
            setState(EMPTY_STATE);
            toast.error(TRANSLATIONS['auth.sessionExpired'][getLocale()]);
          }
        })
        .catch(() => {
          // Silent fail — next interval will retry
        });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [state.status]);

  // Listen for auth:expired events from axios interceptor
  useEffect(() => {
    const handler = () => {
      setState(EMPTY_STATE);
      toast.error(TRANSLATIONS['auth.sessionExpired'][getLocale()]);
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const login = useCallback(async (username: string, password: string, env: string) => {
    setState(prev => ({ ...prev, status: 'loading', error: null }));
    try {
      const res = await authApi.login({ username, password, env });
      setState({
        status: 'authenticated',
        plants: res.plants,
        companies: res.companies ?? [],
        username: res.username,
        groupId: res.groupId ?? null,
        groupName: res.groupName ?? null,
        initialProfile: res.profile,
        error: null,
      });
    } catch (err: any) {
      const message = err.response?.data?.message || err.message || 'Login failed';
      setState({ ...EMPTY_STATE, status: 'error', error: message });
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setState(EMPTY_STATE);
    }
  }, []);

  const clearInitialProfile = useCallback(() => {
    setState(prev => ({ ...prev, initialProfile: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, clearInitialProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
