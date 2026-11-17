import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { Icon } from '../lib/ui';

type Notif = { kind: string; title: string; sub: string; page: string; id?: string };
type Hit = { kind: string; id: string; title: string; sub: string; page: string };

const NAV: { id: string; label: string; icon: string; path?: string; kids?: { id: string; label: string; icon: string; path: string }[] }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'grid', path: '/' },
  { id: 'ventes', label: 'Ventes', icon: 'store', kids: [
    { id: 'devis', label: 'Devis', icon: 'devis', path: '/devis' },
    { id: 'bons', label: 'Bons de Livraison', icon: 'cart', path: '/bons' },
    { id: 'factures', label: 'Factures', icon: 'facture', path: '/factures' },
  ] },
  { id: 'achats', label: 'Achats', icon: 'bag', path: '/achats' },
  { id: 'stocks', label: 'Stocks', icon: 'box', path: '/stocks' },
  { id: 'clients', label: 'Clients', icon: 'users', path: '/clients' },
  { id: 'fournisseurs', label: 'Fournisseurs', icon: 'truck', path: '/fournisseurs' },
  { id: 'compta', label: 'Comptabilité', icon: 'calc', kids: [
    { id: 'caisse', label: 'Trésorerie', icon: 'cash', path: '/caisse' },
    { id: 'depenses', label: 'Dépenses', icon: 'wallet', path: '/depenses' },
    { id: 'rapports', label: 'Bilan', icon: 'pie', path: '/bilan' },
  ] },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: 'shield', path: '/utilisateurs' },
  { id: 'assistant', label: 'Assistant IA', icon: 'spark', path: '/assistant' },
  { id: 'parametres', label: 'Paramètres', icon: 'settings', path: '/parametres' },
];
const PATHS: Record<string, string> = { devis: '/devis', bons: '/bons', factures: '/factures', achats: '/achats', stocks: '/stocks', clients: '/clients', fournisseurs: '/fournisseurs' };
const KIND_ICON: Record<string, string> = { retard: 'hourglass', stock: 'box', bl: 'cart', devis: 'devis' };

export function Avatar({ name, url, cls = '' }: { name: string; url?: string | null; cls?: string }) {
  return <span className={'avatar ' + cls}>{url ? <img src={url} alt="" /> : initials(name)}</span>;
}

export default function Shell({ theme, setTheme }: { theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  const { me, can, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({ ventes: true, compta: true });
  const [side, setSide] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [drop, setDrop] = useState<'notif' | 'user' | 'search' | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  // Alertes rafraîchies à chaque changement de page (et toutes les 2 minutes).
  useEffect(() => {
    const load = () => api<Notif[]>('/notifications').then(setNotifs).catch(() => undefined);
    load();
    const t = window.setInterval(load, 120_000);
    return () => window.clearInterval(t);
  }, [loc.pathname]);
  useEffect(() => { setSide(false); setDrop(null); }, [loc.pathname]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => api<Hit[]>('/search?q=' + encodeURIComponent(q.trim())).then((h) => { setHits(h); setDrop('search'); }).catch(() => undefined), 220);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (topRef.current && !topRef.current.contains(e.target as Node)) setDrop(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!me) return null;
  const counts: Record<string, number> = {
    bons: notifs.filter((n) => n.kind === 'bl').length,
    factures: notifs.filter((n) => n.kind === 'retard').length,
    stocks: notifs.filter((n) => n.kind === 'stock').length,
    devis: notifs.filter((n) => n.kind === 'devis').length,
  };
  const active = (path: string) => (path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(path));
  const allowed = (id: string) => id === 'parametres' || can(id === 'rapports' ? 'rapports' : id);

  const openHit = (h: Hit) => {
    setQ(''); setHits([]); setDrop(null);
    if (h.kind === 'client') nav('/clients/' + h.id);
    else if (h.kind === 'fournisseur') nav('/fournisseurs/' + h.id);
    else if (h.kind === 'produit') nav('/stocks?p=' + h.id);
    else nav(`${PATHS[h.page]}/${h.id}`);
  };
  const openNotif = (n: Notif) => {
    setDrop(null);
    if (n.id && n.page !== 'stocks') nav(`${PATHS[n.page]}/${n.id}`); else nav(PATHS[n.page] ?? '/');
  };

  return (
    <div className="app">
      <aside className={'side' + (side ? ' open' : '')} aria-label="Navigation principale">
        <div className="brand">
          <span className="logo-badge">{me.tenant?.logoUrl ? <img src={me.tenant.logoUrl} alt="" /> : initials(me.tenant?.name ?? 'M').slice(0, 1)}</span>
          <span className="brand-name" title={me.tenant?.name}>{me.tenant?.name ?? 'MizanFlow'}</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            if (n.kids) {
              const kids = n.kids.filter((k) => allowed(k.id));
              if (!kids.length) return null;
              const childActive = kids.some((k) => active(k.path));
              const isOpen = open[n.id] || childActive;
              const hidden = isOpen ? 0 : kids.reduce((s, k) => s + (counts[k.id] ?? 0), 0);
              return (
                <div key={n.id}>
                  <button className={'nav-btn' + (!isOpen && childActive ? ' active' : '')} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [n.id]: !isOpen })}>
                    <Icon name={n.icon} />{n.label}
                    {hidden > 0 && <span className="nav-count">{hidden}</span>}
                    <span className={'chev' + (isOpen ? ' open' : '')}><Icon name="chev" size={16} /></span>
                  </button>
                  {isOpen && (
                    <div className="subnav">
                      {kids.map((k) => (
                        <button key={k.id} className={'sub-btn' + (active(k.path) ? ' active' : '')} onClick={() => nav(k.path)}>
                          <Icon name={k.icon} size={17} />{k.label}{!!counts[k.id] && <span className="nav-count">{counts[k.id]}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            if (!allowed(n.id)) return null;
            return (
              <button key={n.id} className={'nav-btn' + (active(n.path!) ? ' active' : '')} onClick={() => nav(n.path!)}>
                <Icon name={n.icon} />{n.label}{!!counts[n.id] && <span className="nav-count">{counts[n.id]}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', padding: '20px 20px 0', fontSize: 12, color: '#64748B' }}>Propulsé par <b style={{ color: '#94A3B8' }}>MizanFlow</b></div>
      </aside>
      {side && <div className="overlay" style={{ zIndex: 140, padding: 0 }} onClick={() => setSide(false)} />}

      <div className="main">
        <div className="top" ref={topRef}>
          <button className="icon-btn mobile-nav" onClick={() => setSide(true)} aria-label="Ouvrir le menu"><Icon name="menu" /></button>
          <div className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setDrop('search')} placeholder="Rechercher un client, une facture, un article…" aria-label="Recherche globale" />
            {drop === 'search' && q.trim().length >= 2 && (
              <div className="drop">
                {hits.length ? hits.map((h) => (
                  <button key={h.kind + h.id} className="drop-item" onClick={() => openHit(h)}>
                    <span className="pill p-gray" style={{ minWidth: 86, justifyContent: 'center' }}>{({ client: 'Client', fournisseur: 'Fournisseur', produit: 'Article', DEVIS: 'Devis', BL: 'BL', FACTURE: 'Facture', AVOIR: 'Avoir', BC: 'Commande' } as Record<string, string>)[h.kind]}</span>
                    <span><b>{h.title}</b><br /><span className="muted" style={{ fontSize: 13 }}>{h.sub}</span></span>
                  </button>
                )) : <div className="empty" style={{ padding: 16 }}>Aucun résultat</div>}
              </div>
            )}
          </div>
          <div className="top-right">
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" onClick={() => setDrop(drop === 'notif' ? null : 'notif')} aria-label={`Alertes (${notifs.length})`}>
                <Icon name="bell" />{notifs.length > 0 && <span className="badge">{notifs.length > 99 ? '99+' : notifs.length}</span>}
              </button>
              {drop === 'notif' && (
                <div className="drop-r" style={{ maxHeight: 440, overflowY: 'auto' }}>
                  <div style={{ padding: '6px 10px 8px', fontWeight: 700 }}>Alertes</div>
                  {notifs.length ? notifs.map((n, i) => (
                    <button key={i} className="drop-item" onClick={() => openNotif(n)}>
                      <span className="act-ic" style={{ width: 36, height: 36, background: 'var(--soft)' }}><Icon name={KIND_ICON[n.kind] ?? 'bell'} size={17} /></span>
                      <span><b style={{ fontSize: 13.5 }}>{n.title}</b><br /><span className="muted" style={{ fontSize: 12.5 }}>{n.sub}</span></span>
                    </button>
                  )) : <div className="empty" style={{ padding: 16 }}>Rien à signaler 👌</div>}
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button className="user" onClick={() => setDrop(drop === 'user' ? null : 'user')} aria-haspopup="menu">
                <Avatar name={me.name} url={me.avatarUrl} />
                <span><b style={{ fontSize: 15 }}>{me.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{me.roleLabel}</span></span>
                <Icon name="chev" size={16} />
              </button>
              {drop === 'user' && (
                <div className="drop-r" style={{ width: 260 }} role="menu">
                  <div style={{ padding: '8px 12px' }}><b>{me.name}</b><div className="muted" style={{ fontSize: 13 }}>{me.email}</div></div>
                  <div className="drop-sep" />
                  <button className="drop-item" onClick={() => nav('/parametres')}><Icon name="settings" size={18} />Mon profil et paramètres</button>
                  <button className="drop-item" onClick={() => signOut()}><Icon name="logout" size={18} />Se déconnecter</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
