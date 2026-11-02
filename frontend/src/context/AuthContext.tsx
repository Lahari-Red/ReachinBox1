import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getToken, setUnauthorizedHandler, TOKEN_KEY } from '../api/client';
import { authApi } from '../api/endpoints';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (googleCredential: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    void authApi.logout().catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    });
    if (!getToken()) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (credential: string) => {
    const { token, user } = await authApi.loginWithGoogle(credential);
    localStorage.setItem(TOKEN_KEY, token);
    setUser(user);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
