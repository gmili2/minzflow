import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { useAuth } from './lib/auth';
import { Spinner } from './lib/ui';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const DocList = lazy(() => import('./pages/DocList'));
const DocEdit = lazy(() => import('./pages/DocEdit'));
const DocView = lazy(() => import('./pages/DocView'));
const PrintDoc = lazy(() => import('./pages/PrintDoc'));
const Parties = lazy(() => import('./pages/Parties'));
const PartyView = lazy(() => import('./pages/PartyView'));
const Stocks = lazy(() => import('./pages/Stocks'));
const Treasury = lazy(() => import('./pages/Treasury'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Settings = lazy(() => import('./pages/Settings'));
const SuperHome = lazy(() => import('./pages/super/SuperHome'));
const TenantForm = lazy(() => import('./pages/super/TenantForm'));

const PAGE_OF: Record<string, string> = { devis: 'devis', bons: 'bons', factures: 'factures', achats: 'achats' };

/** Garde de module : redirige vers le tableau de bord si le rôle n'y a pas accès. */
function Need({ module, children }: { module: string; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(module) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { me, ready } = useAuth();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('mf-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  useEffect(() => { try { localStorage.setItem('mf-theme', theme); } catch { /* stockage indisponible */ } }, [theme]);

  if (!ready) return <div className="theme"><Spinner /></div>;
  if (!me) return <div className="theme"><Routes><Route path="*" element={<Login />} /></Routes></div>;

  if (me.role === 'SUPERADMIN') {
    return (
      <div className={'theme ' + (theme === 'dark' ? 'dark' : '')}>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/super" element={<SuperHome />} />
            <Route path="/super/entreprises/nouvelle" element={<TenantForm />} />
            <Route path="/super/entreprises/:id" element={<TenantForm />} />
            <Route path="*" element={<Navigate to="/super" replace />} />
          </Routes>
        </Suspense>
      </div>
    );
  }

  return (
    <div className={'theme ' + (theme === 'dark' ? 'dark' : '')}>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/imprimer/:id" element={<PrintDoc />} />
          <Route element={<Shell theme={theme} setTheme={setTheme} />}>
            <Route index element={<Dashboard />} />
            {Object.entries(PAGE_OF).map(([seg, mod]) => [
              <Route key={seg} path={`/${seg}`} element={<Need module={mod}><DocList kind={seg} /></Need>} />,
              <Route key={seg + 'n'} path={`/${seg}/nouveau`} element={<Need module={mod}><DocEdit kind={seg} /></Need>} />,
              <Route key={seg + 'e'} path={`/${seg}/:id/modifier`} element={<Need module={mod}><DocEdit kind={seg} /></Need>} />,
              <Route key={seg + 'v'} path={`/${seg}/:id`} element={<Need module={mod}><DocView /></Need>} />,
            ])}
            <Route path="/clients" element={<Need module="clients"><Parties kind="clients" /></Need>} />
            <Route path="/clients/:id" element={<Need module="clients"><PartyView kind="clients" /></Need>} />
            <Route path="/fournisseurs" element={<Need module="fournisseurs"><Parties kind="fournisseurs" /></Need>} />
            <Route path="/fournisseurs/:id" element={<Need module="fournisseurs"><PartyView kind="fournisseurs" /></Need>} />
            <Route path="/stocks" element={<Need module="stocks"><Stocks /></Need>} />
            <Route path="/caisse" element={<Need module="caisse"><Treasury /></Need>} />
            <Route path="/depenses" element={<Need module="depenses"><Expenses /></Need>} />
            <Route path="/bilan" element={<Need module="rapports"><Reports /></Need>} />
            <Route path="/utilisateurs" element={<Need module="utilisateurs"><Users /></Need>} />
            <Route path="/assistant" element={<Need module="assistant"><Assistant /></Need>} />
            <Route path="/parametres" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  );
}
