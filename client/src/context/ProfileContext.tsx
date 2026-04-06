import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { configApi } from '../api/config.api';
import { DashboardProfile, DEFAULT_POLLING_CONFIG } from '@shared/types/dashboard.types';
import { useAuth } from './AuthContext';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';

interface ProfileContextValue {
  profile: DashboardProfile | null;
  loading: boolean;
  groupId: number | null;
  updateProfile: (updates: Partial<DashboardProfile>) => Promise<void>;
  resetProfile: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { status, initialProfile, clearInitialProfile, groupId } = useAuth();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [loading, setLoading] = useState(false);

  // Load profile when authenticated
  useEffect(() => {
    if (status !== 'authenticated') {
      setProfile(null);
      return;
    }

    // If login response included an auto-loaded profile, use it directly
    if (initialProfile) {
      setProfile(initialProfile);
      clearInitialProfile();
      return;
    }

    // Otherwise fetch from server (e.g. on page refresh with existing session)
    setLoading(true);
    configApi.loadProfile()
      .then(loaded => {
        if (loaded) {
          setProfile(loaded);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [status, initialProfile, clearInitialProfile]);

  const prevProfileRef = useRef<DashboardProfile | null>(null);

  const updateProfile = useCallback(async (updates: Partial<DashboardProfile>) => {
    setProfile((prev: DashboardProfile | null) => {
      prevProfileRef.current = prev;
      const now = new Date().toISOString();
      const updated: DashboardProfile = prev
        ? { ...prev, ...updates, updatedAt: now }
        : {
            id: uuidv4(),
            name: 'Default',
            portalEnv: 'prod',
            assetMapping: updates.assetMapping || {} as any,
            polling: updates.polling || DEFAULT_POLLING_CONFIG,
            createdAt: now,
            updatedAt: now,
            ...updates,
          };

      // Save async — rollback on server rejection
      configApi.saveProfile(updated).catch((err: any) => {
        const code = err.response?.data?.code;
        if (code === 'MAPPING_DELETE_BLOCKED') {
          toast.error(err.response?.data?.message || 'Cannot clear mapping');
          setProfile(prevProfileRef.current);
        } else {
          console.error('[ProfileContext] save failed:', err);
        }
      });

      return updated;
    });
  }, []);

  const resetProfile = useCallback(() => {
    setProfile(null);
  }, []);

  return (
    <ProfileContext.Provider value={{ profile, loading, groupId, updateProfile, resetProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfile must be used within ProfileProvider');
  return context;
}
