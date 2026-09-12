import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';

interface FeaturesState {
  hideJimeng: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const FeaturesContext = createContext<FeaturesState>({
  hideJimeng: false,
  loading: true,
  refresh: async () => {},
});

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [hideJimeng, setHideJimeng] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await api.get('/settings/features');
      setHideJimeng(r.data?.data?.hideJimeng ?? false);
    } catch {
      setHideJimeng(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <FeaturesContext.Provider value={{ hideJimeng, loading, refresh }}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
