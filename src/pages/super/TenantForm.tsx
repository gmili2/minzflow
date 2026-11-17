import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CompanyFields, { fromForm, toForm, type CompanyForm } from '../../components/CompanyFields';
import { api, del, patch, post, upload } from '../../lib/api';
import { initials, ROLES } from '../../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useToast } from '../../lib/ui';
import { SuperTop } from './SuperHome';

type TUser = { id: string; name: string; email: string; role: string; active: boolean; lastLoginAt: string | null };
type Tenant = Record<string, unknown> & { id: string; slug: string; name: string; logoUrl: string | null; active: boolean; primaryColor: string; users: TUser[] };
const genPass = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');

export default function TenantForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useToast();
  const [t, setT] = useState<Tenant | null>(null);
  const [f, setF] = useState<CompanyForm>(toForm({}));
  const [admin, setAdmin] = useState({ name: '', email: '', password: genPass() });
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [userModal, setUserModal] = useState<{ id?: string; name: string; email: string; password: string; role: string } | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string; id: string } | null>(null);
  const [loading, setLoading] = useState(!!id);

  const load = async () => { if (!id) return; const x = await api<Tenant>('/super/tenants/' + id); setT(x); setF(toForm(x)); setLoading(false); };
  useEffect(() => { setLogo(null); setPreview(null); load().catch((e: Error) => { setErr(e.message); setLoading(false); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!logo) return; const u = URL.createObjectURL(logo); setPreview(u); return () => URL.revokeObjectURL(u); }, [logo]);

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      if (id) {
        await patch('/super/tenants/' + id, fromForm(f));
        if (logo) await upload(`/super/tenants/${id}/logo`, logo);
        setLogo(null); await load(); notify('Entreprise enregistrée');
      } else {
        const x = await post<{ id: string }>('/super/tenants', { ...fromForm(f), admin });
        if (logo) await upload(`/super/tenants/${x.id}/logo`, logo).catch((e: Error) => notify('Logo non enregistré : ' + e.message));
        setCreated({ email: admin.email, password: admin.password, id: x.id });
      }
    } catch (e) { setErr((e as Error).message); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!t) return;
    if (t.active && !confirm(`Suspendre ${t.name} ? Ses utilisateurs ne pourront plus se connecter.`)) return;
    await patch('/super/tenants/' + t.id, { active: !t.active }); await load(); notify(t.active ? 'Espace suspendu' : 'Espace réactivé');
  };
  const remove = async () => {
    if (!t) return;
    const c = prompt(`Suppression DÉFINITIVE de ${t.name} et de toutes ses données.\nPour confirmer, saisissez : ${t.slug}`);
    if (c === null) return;
    try { await del('/super/tenants/' + t.id, { confirm: c }); notify('Entreprise supprimée'); nav('/super'); } catch (e) { notify((e as Error).message); }
  };
  const saveUser = async () => {
    if (!userModal || !t) return;
    try {
      if (userModal.id) await patch('/super/users/' + userModal.id, { name: userModal.name, email: userModal.email, role: userModal.role, ...(userModal.password && { password: userModal.password }) });
      else await post(`/super/tenants/${t.id}/users`, { name: userModal.name, email: userModal.email, password: userModal.password });
      notify(userModal.password ? `Enregistré — mot de passe : ${userModal.password}` : 'Utilisateur enregistré');
      setUserModal(null); await load();
    } catch (e) { notify((e as Error).message); }
  };

  const logoSrc = preview ?? t?.logoUrl ?? null;
  return (
    <>
      <SuperTop />
      <main className="content" style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <button className="link-btn" onClick={() => nav('/super')}><Icon name="left" size={16} />Entreprises</button>
        <PageHead title={id ? t?.name ?? '…' : 'Nouvelle entreprise'} sub={id ? `Identifiant : ${t?.slug ?? ''}` : 'Renseignez la fiche, le logo, la couleur et le compte administrateur, puis enregistrez.'}>
          {t && <Pill label={t.active ? 'Active' : 'Suspendue'} cls={t.active ? 'p-green' : 'p-red'} />}
          <button className="btn btn-green" onClick={save} disabled={busy || !f.name.trim()}><Icon name="check" size={18} />{busy ? 'Enregistrement…' : id ? 'Enregistrer' : 'Créer l’entreprise'}</button>
        </PageHead>
        {err && <div className="err" role="alert">{err}</div>}
        {loading ? <Spinner /> : (
          <>
            <section className="card">
              <div className="card-h"><h2>Logo et aperçu</h2></div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="logo-prev">{logoSrc ? <img src={logoSrc} alt="Logo" /> : 'Aucun logo'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label htmlFor="logo" className="btn btn-ghost"><Icon name="upload" size={18} />Choisir un logo</label>
                    <input id="logo" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
                    {t?.logoUrl && !logo && <button className="btn btn-red" onClick={async () => { await del(`/super/tenants/${t.id}/logo`); await load(); }}>Retirer</button>}
                  </div>
                  <span className="muted" style={{ fontSize: 12.5 }}>PNG, JPG ou WebP, 3 Mo max.{logo && ' Le logo sera envoyé à l’enregistrement.'}</span>
                </div>
                <div style={{ marginLeft: 'auto', background: '#0F1A2B', borderRadius: 14, padding: '16px 18px', minWidth: 240 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#fff' }}>
                    <span className="logo-badge" style={{ background: f.primaryColor }}>{logoSrc ? <img src={logoSrc} alt="" /> : initials(f.name || 'M').slice(0, 1)}</span>
                    <b>{f.name || 'Nom de l’entreprise'}</b>
                  </div>
                  <button className="btn btn-sm" style={{ background: f.primaryColor, color: '#fff', marginTop: 12 }}>+ Nouvelle facture</button>
                </div>
              </div>
            </section>
            <section className="card"><CompanyFields f={f} set={setF} /></section>
            {!id ? (
              <section className="card">
                <div className="card-h"><h2><Icon name="shield" color="var(--brand)" />Compte administrateur de l’entreprise</h2></div>
                <div className="form">
                  <label className="fld">Nom complet *<input className="inp" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} /></label>
                  <label className="fld">Email de connexion *<input className="inp" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></label>
                  <label className="fld full">Mot de passe * (8 caractères min.)
                    <div style={{ display: 'flex', gap: 8 }}><input className="inp" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} /><button type="button" className="btn btn-ghost" onClick={() => setAdmin({ ...admin, password: genPass() })}>Générer</button></div>
                  </label>
                </div>
                <p className="muted" style={{ fontSize: 13 }}>L'administrateur pourra ensuite créer ses propres utilisateurs (comptable, commercial, lecture seule).</p>
              </section>
            ) : t && (
              <>
                <section className="card">
                  <div className="card-h"><h2>Utilisateurs</h2><button className="btn btn-ghost btn-sm" onClick={() => setUserModal({ name: '', email: '', password: genPass(), role: 'ADMIN' })}><Icon name="plus" size={16} />Ajouter un administrateur</button></div>
                  <div className="tbl">
                    {t.users.map((u) => (
                      <div key={u.id} className="tr" style={{ gridTemplateColumns: '2fr 1fr .8fr 1.2fr 60px' }}>
                        <span><b>{u.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{u.email}</span></span>
                        <span>{ROLES[u.role]}</span><span><Pill label={u.active ? 'Actif' : 'Inactif'} cls={u.active ? 'p-green' : 'p-gray'} /></span>
                        <span className="muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais connecté'}</span>
                        <span className="row-act"><button className="mini" aria-label={`Modifier ${u.name}`} onClick={() => setUserModal({ id: u.id, name: u.name, email: u.email, password: '', role: u.role })}><Icon name="edit" size={15} /></button></span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="card" style={{ borderColor: '#F3C4C4' }}>
                  <div className="card-h"><h2>Zone sensible</h2></div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className={'btn ' + (t.active ? 'btn-red' : 'btn-green')} onClick={toggle}>{t.active ? 'Suspendre l’espace' : 'Réactiver l’espace'}</button>
                    <button className="btn btn-red" onClick={remove}><Icon name="trash" size={18} />Supprimer définitivement</button>
                  </div>
                </section>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-green" onClick={save} disabled={busy || !f.name.trim()}><Icon name="check" size={18} />{id ? 'Enregistrer' : 'Créer l’entreprise'}</button></div>
          </>
        )}
      </main>
      {userModal && (
        <Modal title={userModal.id ? 'Modifier l’utilisateur' : 'Nouvel administrateur'} onClose={() => setUserModal(null)} footer={<><button className="btn btn-ghost" onClick={() => setUserModal(null)}>Annuler</button><button className="btn btn-green" onClick={saveUser}>Enregistrer</button></>}>
          <div className="form">
            <label className="fld">Nom<input className="inp" value={userModal.name} onChange={(e) => setUserModal({ ...userModal, name: e.target.value })} /></label>
            <label className="fld">Email de connexion<input className="inp" type="email" value={userModal.email} onChange={(e) => setUserModal({ ...userModal, email: e.target.value })} /></label>
            {userModal.id && <label className="fld">Rôle<select className="inp" value={userModal.role} onChange={(e) => setUserModal({ ...userModal, role: e.target.value })}>{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            <label className="fld full">{userModal.id ? 'Nouveau mot de passe (vide = inchangé)' : 'Mot de passe'}
              <div style={{ display: 'flex', gap: 8 }}><input className="inp" value={userModal.password} onChange={(e) => setUserModal({ ...userModal, password: e.target.value })} /><button type="button" className="btn btn-ghost" onClick={() => setUserModal({ ...userModal, password: genPass() })}>Générer</button></div>
            </label>
          </div>
        </Modal>
      )}
      {created && (
        <Modal title="Entreprise créée 🎉" onClose={() => { setCreated(null); nav('/super/entreprises/' + created.id); }} footer={<button className="btn btn-green" onClick={() => { setCreated(null); nav('/super/entreprises/' + created.id); }}>Terminé</button>}>
          <p>Communiquez ces accès à l'administrateur (le mot de passe n'est plus affiché ensuite) :</p>
          <div className="stat" style={{ fontSize: 15, lineHeight: 1.8 }}>
            Adresse : <b>{location.origin}</b><br />Email : <b>{created.email}</b><br />Mot de passe : <b>{created.password}</b>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { navigator.clipboard?.writeText(`MizanFlow — ${location.origin}\nEmail : ${created.email}\nMot de passe : ${created.password}`); notify('Accès copiés'); }}>Copier les accès</button>
        </Modal>
      )}
    </>
  );
}
