import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Icon } from '../lib/ui';

export default function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await signIn(email, password);
      nav(u.role === 'SUPERADMIN' ? '/super' : '/', { replace: true });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="logo-badge" style={{ background: '#2F6F64' }}>M</span>
          <span className="brand-name">MIZAN<span style={{ color: '#2DD4BF' }}>FLOW</span></span>
        </div>
        <div>
          <h2>Gérez toute votre entreprise au même endroit.</h2>
          <p>Devis, bons de livraison, factures, achats, stock, trésorerie et bilan — pensé pour les entreprises marocaines (ICE, TVA, DH).</p>
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 14, color: '#C9D6E6' }}>
          {['Factures conformes', 'Stock en temps réel', 'Multi-utilisateurs'].map((t) => <span key={t} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="check" size={16} color="#2DD4BF" />{t}</span>)}
        </div>
      </div>
      <div className="login-form">
        <form className="login-card card" style={{ padding: 32 }} onSubmit={submit}>
          <div>
            <h1>Connexion</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>Accédez à l'espace de votre entreprise.</p>
          </div>
          {err && <div className="err" role="alert">{err}</div>}
          <label className="fld">Email<input className="inp" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
          <label className="fld">Mot de passe
            <div style={{ position: 'relative' }}>
              <input className="inp" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 48 }} />
              <button type="button" className="icon-btn" style={{ position: 'absolute', right: 0, top: 0 }} onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}><Icon name="eye" size={18} /></button>
            </div>
          </label>
          <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Mot de passe oublié ? Contactez l'administrateur de votre entreprise.</p>
        </form>
      </div>
    </div>
  );
}
