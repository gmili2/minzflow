import { useEffect, useState } from 'react';
import { Avatar } from '../components/Shell';
import CompanyFields, { fromForm, toForm, type CompanyForm } from '../components/CompanyFields';
import type { Company } from '../components/DocSheet';
import { api, del, patch, post, upload, type Me } from '../lib/api';
import { applyBrand, useAuth } from '../lib/auth';
import { Icon, PageHead, Spinner, useToast } from '../lib/ui';

export default function Settings() {
  const { me, setMe, can } = useAuth();
  const notify = useToast();
  const admin = can('parametres', 'write');
  const [co, setCo] = useState<(Company & { slug: string }) | null>(null);
  const [f, setF] = useState<CompanyForm | null>(null);
  const [name, setName] = useState(me?.name ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');

  useEffect(() => { api<Company & { slug: string }>('/company').then((c) => { setCo(c); setF(toForm(c)); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => () => applyBrand(me?.tenant?.primaryColor), [me]);

  const refreshMe = async () => setMe(await api<Me>('/me'));
  const saveCompany = async () => {
    if (!f) return;
    setErr('');
    try { const c = await patch<Company & { slug: string }>('/company', fromForm(f)); setCo(c); await refreshMe(); notify('Fiche société enregistrée'); } catch (e) { setErr((e as Error).message); }
  };
  const sendLogo = async (file?: File) => {
    if (!file) return;
    try { await upload('/company/logo', file); setCo(await api('/company')); await refreshMe(); notify('Logo mis à jour'); } catch (e) { notify((e as Error).message); }
  };
  const sendAvatar = async (file?: File) => {
    if (!file) return;
    try { setMe(await upload<Me>('/profile/avatar', file)); notify('Photo mise à jour'); } catch (e) { notify((e as Error).message); }
  };
  const savePw = async () => {
    if (pw.next !== pw.confirm) return notify('Les deux mots de passe ne correspondent pas');
    try { await post('/auth/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', confirm: '' }); notify('Mot de passe modifié'); } catch (e) { notify((e as Error).message); }
  };

  if (!me) return null;
  return (
    <>
      <PageHead title="Paramètres" sub="Votre profil et la fiche de votre société (en-têtes des devis et factures)." />
      {err && <div className="err">{err}</div>}
      <div className="grid2b">
        <section className="card">
          <div className="card-h"><h2>Mon profil</h2></div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <Avatar name={me.name} url={me.avatarUrl} cls="xl" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label htmlFor="avatar" className="btn btn-ghost">Choisir une photo</label>
              <input id="avatar" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => sendAvatar(e.target.files?.[0])} />
              {me.avatarUrl && <button className="btn btn-red" onClick={async () => setMe(await del<Me>('/profile/avatar'))}>Retirer</button>}
            </div>
          </div>
          <div className="form">
            <label className="fld">Nom complet<input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="fld">Email de connexion<input className="inp" value={me.email} disabled /></label>
            <div className="fld">Rôle<b style={{ paddingTop: 10 }}>{me.roleLabel}</b></div>
          </div>
          <div className="modal-f"><button className="btn btn-green" onClick={async () => { try { setMe(await patch<Me>('/profile', { name })); notify('Profil enregistré'); } catch (e) { notify((e as Error).message); } }}>Enregistrer</button></div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Mot de passe</h2></div>
          <div className="form">
            <label className="fld full">Mot de passe actuel<input className="inp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
            <label className="fld">Nouveau (8 caractères min.)<input className="inp" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
            <label className="fld">Confirmation<input className="inp" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
          </div>
          <div className="modal-f"><button className="btn btn-green" onClick={savePw} disabled={!pw.current || pw.next.length < 8}>Changer le mot de passe</button></div>
        </section>
      </div>
      <section className="card">
        <div className="card-h"><h2><Icon name="building" color="#10B981" />Fiche société</h2>{!admin && <span className="muted" style={{ fontSize: 13 }}>Seul un administrateur peut la modifier.</span>}</div>
        {!f || !co ? <Spinner /> : (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
              <div className="logo-prev">{co.logoUrl ? <img src={co.logoUrl} alt="Logo" /> : 'Aucun logo'}</div>
              {admin && <div><label htmlFor="logo" className="btn btn-ghost"><Icon name="upload" size={18} />Changer le logo</label><input id="logo" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => sendLogo(e.target.files?.[0])} /><p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>PNG, JPG ou WebP, 3 Mo max. Fond transparent conseillé.</p></div>}
            </div>
            <CompanyFields f={f} set={(x) => { setF(x); applyBrand(x.primaryColor); }} disabled={!admin} />
            {admin && <div className="modal-f"><button className="btn btn-green" onClick={saveCompany}>Enregistrer la fiche société</button></div>}
          </>
        )}
      </section>
    </>
  );
}
