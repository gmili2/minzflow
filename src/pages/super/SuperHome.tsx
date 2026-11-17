import { useState } from 'react';
import { post } from '../../lib/api';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dh0, initials, norm } from '../../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useData, useToast } from '../../lib/ui';

export type TenantRow = {
  id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string; city: string | null; email: string | null; phone: string | null; ice: string | null;
  active: boolean; createdAt: string; users: number; clients: number; documents: number; ca: number; lastLogin: string | null;
};

export function SuperTop() {
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  const notify = useToast();
  const [pw, setPw] = useState<{ current: string; next: string; confirm: string } | null>(null);
  const [err, setErr] = useState('');
  const savePw = async () => {
    if (!pw) return;
    if (pw.next !== pw.confirm) return setErr('Les deux mots de passe ne correspondent pas');
    try { await post('/auth/password', { current: pw.current, next: pw.next }); setPw(null); notify('Mot de passe modifié'); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="super-top">
      <button className="link-btn" style={{ color: '#fff', gap: 12 }} onClick={() => nav('/super')}>
        <span className="logo-badge" style={{ background: '#2F6F64' }}>M</span>
        <span className="brand-name">MIZAN<span style={{ color: '#2DD4BF' }}>FLOW</span></span>
        <Pill label="Super-admin" cls="p-purple" />
      </button>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 14, color: '#C9D6E6' }}>{me?.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => { setErr(''); setPw({ current: '', next: '', confirm: '' }); }}><Icon name="shield" size={16} />Mon mot de passe</button>
        <button className="btn btn-ghost btn-sm" onClick={() => signOut()}><Icon name="logout" size={16} />Déconnexion</button>
      </div>
      {pw && (
        <Modal title="Changer mon mot de passe" onClose={() => setPw(null)} footer={<><button className="btn btn-ghost" onClick={() => setPw(null)}>Annuler</button><button className="btn btn-green" onClick={savePw} disabled={!pw.current || pw.next.length < 8}>Enregistrer</button></>}>
          {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form">
            <label className="fld full">Mot de passe actuel<input className="inp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
            <label className="fld">Nouveau (8 caractères min.)<input className="inp" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
            <label className="fld">Confirmation<input className="inp" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function SuperHome() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'on' | 'off'>('all');
  const { data, error, loading } = useData(() => api<TenantRow[]>('/super/tenants'));
  const rows = (data ?? []).filter((t) => (f === 'all' || (f === 'on') === t.active) && (!q || norm(`${t.name} ${t.city ?? ''} ${t.email ?? ''} ${t.ice ?? ''}`).includes(norm(q))));
  const cols = '2.4fr 1fr .8fr .8fr 1.1fr 1.1fr .9fr 40px';
  return (
    <>
      <SuperTop />
      <main className="content" style={{ maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <PageHead title="Entreprises" sub="Créez et gérez les espaces de vos clients MizanFlow.">
          <button className="btn btn-green" onClick={() => nav('/super/entreprises/nouvelle')}><Icon name="plus" size={18} />Nouvelle entreprise</button>
        </PageHead>
        <div className="stats">
          <div className="stat"><span className="muted">Entreprises</span><b>{data?.length ?? 0}</b></div>
          <div className="stat"><span className="muted">Actives</span><b className="pos">{(data ?? []).filter((t) => t.active).length}</b></div>
          <div className="stat"><span className="muted">Utilisateurs</span><b>{(data ?? []).reduce((s, t) => s + t.users, 0)}</b></div>
          <div className="stat"><span className="muted">CA facturé (toutes entreprises)</span><b>{dh0((data ?? []).reduce((s, t) => s + t.ca, 0))}</b></div>
        </div>
        <section className="card">
          <div className="filters">
            <div className="fld">Statut<div className="chips">{([['all', 'Toutes'], ['on', 'Actives'], ['off', 'Suspendues']] as const).map(([k, l]) => <button key={k} className={'chip' + (f === k ? ' on' : '')} onClick={() => setF(k)}>{l}</button>)}</div></div>
            <label className="fld" style={{ flex: '1 1 260px', maxWidth: 420 }}>Recherche<input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville, ICE…" /></label>
          </div>
          {error && <div className="err">{error}</div>}
          {loading ? <Spinner /> : (
            <div className="tbl">
              <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Entreprise</span><span>Ville</span><span className="num">Utilisateurs</span><span className="num">Documents</span><span className="num">CA facturé</span><span>Dernière connexion</span><span>Statut</span><span /></div>
              {rows.map((t) => (
                <div key={t.id} className="tr clickable" style={{ gridTemplateColumns: cols }} onClick={() => nav('/super/entreprises/' + t.id)}>
                  <span className="tenant-card">
                    <span className="logo-badge" style={{ background: t.primaryColor }}>{t.logoUrl ? <img src={t.logoUrl} alt="" /> : initials(t.name).slice(0, 1)}</span>
                    <span><b>{t.name}</b><br /><span className="muted" style={{ fontSize: 12.5 }}>{t.email ?? t.slug}</span></span>
                  </span>
                  <span>{t.city ?? '—'}</span><span className="num">{t.users}</span><span className="num">{t.documents}</span><span className="num">{dh0(t.ca)}</span>
                  <span className="muted">{t.lastLogin ? new Date(t.lastLogin).toLocaleDateString('fr-FR') : 'Jamais'}</span>
                  <span><Pill label={t.active ? 'Active' : 'Suspendue'} cls={t.active ? 'p-green' : 'p-red'} /></span>
                  <span className="row-act"><Icon name="right" size={16} /></span>
                </div>
              ))}
              {!rows.length && <div className="empty">{data?.length ? 'Aucun résultat.' : 'Aucune entreprise : créez la première.'}</div>}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
