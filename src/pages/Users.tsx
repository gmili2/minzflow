import { useState } from 'react';
import { Avatar } from '../components/Shell';
import { api, del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_CLS, ROLES } from '../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useData, useToast } from '../lib/ui';

type U = { id: string; name: string; email: string; role: string; active: boolean; avatarUrl: string | null; lastLoginAt: string | null };
const DESC: Record<string, string> = {
  ADMIN: 'Accès complet, gère les utilisateurs et la fiche société.',
  COMPTABLE: 'Tous les modules (ventes, achats, trésorerie, bilan), sans gestion des utilisateurs.',
  COMMERCIAL: 'Devis, bons de livraison, factures et clients. Consulte le stock.',
  LECTURE: 'Consulte tout, ne modifie rien.',
};
const genPass = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');

export default function Users() {
  const { me, can } = useAuth();
  const notify = useToast();
  const { data, error, loading, reload } = useData(() => api<U[]>('/users'));
  const [form, setForm] = useState<{ id?: string; name: string; email: string; role: string; active: boolean; password: string } | null>(null);
  const [err, setErr] = useState('');
  const write = can('utilisateurs', 'write');

  const save = async () => {
    if (!form) return;
    setErr('');
    try {
      if (form.id) await patch('/users/' + form.id, { name: form.name, email: form.email, role: form.role, active: form.active, ...(form.password && { password: form.password }) });
      else await post('/users', { name: form.name, email: form.email, role: form.role, password: form.password });
      notify(form.id ? 'Utilisateur mis à jour' : `Compte créé pour ${form.email}${form.password ? ' — communiquez-lui son mot de passe' : ''}`);
      setForm(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <>
      <PageHead title="Utilisateurs" sub="Les membres de votre équipe et leurs droits d'accès.">
        {write && <button className="btn btn-green" onClick={() => { setErr(''); setForm({ name: '', email: '', role: 'COMMERCIAL', active: true, password: genPass() }); }}><Icon name="plus" size={18} />Nouvel utilisateur</button>}
      </PageHead>
      <div className="grid2">
        <section className="card">
          {error && <div className="err">{error}</div>}
          {loading && !data ? <Spinner /> : (
            <div className="tbl">
              <div className="tr th cols-usr"><span>Utilisateur</span><span>Rôle</span><span>Statut</span><span>Dernière connexion</span><span /></div>
              {(data ?? []).map((u) => (
                <div key={u.id} className="tr cols-usr">
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name={u.name} url={u.avatarUrl} cls="sm" /><span><b>{u.name}{u.id === me?.id && ' (vous)'}</b><br /><span className="muted" style={{ fontSize: 13 }}>{u.email}</span></span></span>
                  <span><Pill label={ROLES[u.role]} cls={ROLE_CLS[u.role]} /></span>
                  <span><Pill label={u.active ? 'Actif' : 'Inactif'} cls={u.active ? 'p-green' : 'p-gray'} /></span>
                  <span className="muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais'}</span>
                  <span className="row-act">{write && <>
                    <button className="mini" aria-label={`Modifier ${u.name}`} onClick={() => { setErr(''); setForm({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, password: '' }); }}><Icon name="edit" size={15} /></button>
                    {u.id !== me?.id && <button className="mini del" aria-label={`Supprimer ${u.name}`} onClick={async () => { if (confirm(`Supprimer le compte de ${u.name} ?`)) { try { await del('/users/' + u.id); notify('Utilisateur supprimé'); reload(); } catch (e) { notify((e as Error).message); } } }}><Icon name="trash" size={15} /></button>}
                  </>}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-h"><h2><Icon name="shield" color="#10B981" />Rôles</h2></div>
          {Object.entries(DESC).map(([r, d]) => <div key={r} className="role-row"><Pill label={ROLES[r]} cls={ROLE_CLS[r]} /><span className="muted">{d}</span></div>)}
        </section>
      </div>
      {form && (
        <Modal title={form.id ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'} onClose={() => setForm(null)} footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Annuler</button><button className="btn btn-green" onClick={save} disabled={!form.name.trim() || !form.email.trim()}>Enregistrer</button></>}>
          {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form">
            <label className="fld">Nom complet *<input className="inp" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="fld">Email de connexion *<input className="inp" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <div className="fld full">Rôle<div className="chips">{Object.entries(ROLES).map(([k, l]) => <button key={k} type="button" className={'chip' + (form.role === k ? ' on' : '')} onClick={() => setForm({ ...form, role: k })}>{l}</button>)}</div><span className="muted" style={{ fontWeight: 500 }}>{DESC[form.role]}</span></div>
            <label className="fld full">{form.id ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
              <div style={{ display: 'flex', gap: 8 }}><input className="inp" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><button type="button" className="btn btn-ghost" onClick={() => setForm({ ...form, password: genPass() })}>Générer</button></div>
            </label>
            {form.id && form.id !== me?.id && <label className="toggle full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Compte actif</label>}
          </div>
        </Modal>
      )}
    </>
  );
}
