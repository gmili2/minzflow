import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { login as apiLogin, logout as apiLogout, refreshSession, setLogoutHandler, type Me } from './api';
import { shade } from './format';

type Auth = {
  me: Me | null; ready: boolean;
  signIn: (email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  setMe: (m: Me) => void;
  can: (module: string, mode?: 'read' | 'write') => boolean;
};
const Ctx = createContext<Auth>(null as unknown as Auth);

/** Couleur principale de l'entreprise appliquée à toute l'application. */
export function applyBrand(color: string | undefined) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#047857';
  const r = document.documentElement.style;
  r.setProperty('--brand', c);
  r.setProperty('--brand-dark', shade(c, -0.18));
  r.setProperty('--brand-soft', shade(c, 0.78));
  r.setProperty('--brand-tint', c + '1A');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const setMe = useCallback((m: Me | null) => { setMeState(m); applyBrand(m?.tenant?.primaryColor); }, []);

  useEffect(() => {
    refreshSession().then((u) => { setMe(u); setReady(true); });
    setLogoutHandler(() => setMe(null));
    return () => setLogoutHandler(null);
  }, [setMe]);

  const value: Auth = {
    me, ready, setMe,
    signIn: async (e, p) => { const u = await apiLogin(e, p); setMe(u); return u; },
    signOut: async () => { await apiLogout(); setMe(null); },
    can: (module, mode = 'read') => !!me && (mode === 'read' ? me.read : me.write).includes(module),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
