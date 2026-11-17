import { fromCents } from '../lib/format';
import { Icon } from '../lib/ui';

export type CompanyForm = {
  name: string; primaryColor: string; legalForm: string; capital: string; ice: string; rc: string; ifiscal: string; patente: string; cnss: string;
  address: string; city: string; phone: string; email: string; website: string; bankName: string; rib: string;
  tvaDefault: number; paymentDays: string; quoteDays: string; footer: string; openingCash: string;
};
export const COLORS = ['#047857', '#0E7490', '#1D4ED8', '#4338CA', '#7C3AED', '#BE185D', '#B91C1C', '#C2410C', '#A16207', '#0F172A'];

export function toForm(c: Partial<Record<keyof CompanyForm, unknown>> & { openingCash?: number }): CompanyForm {
  const s = (k: keyof CompanyForm) => (c[k] == null ? '' : String(c[k]));
  return {
    name: s('name'), primaryColor: (c.primaryColor as string) || '#047857', legalForm: s('legalForm'), capital: s('capital'), ice: s('ice'), rc: s('rc'), ifiscal: s('ifiscal'),
    patente: s('patente'), cnss: s('cnss'), address: s('address'), city: s('city'), phone: s('phone'), email: s('email'), website: s('website'), bankName: s('bankName'), rib: s('rib'),
    tvaDefault: (c.tvaDefault as number) ?? 20, paymentDays: String(c.paymentDays ?? 30), quoteDays: String(c.quoteDays ?? 30), footer: s('footer'), openingCash: fromCents(c.openingCash ?? 0) || '0',
  };
}
/** Corps envoyé à l'API (nombres convertis). */
export function fromForm(f: CompanyForm) {
  return {
    ...f, tvaDefault: Number(f.tvaDefault), paymentDays: parseInt(f.paymentDays, 10) || 0, quoteDays: parseInt(f.quoteDays, 10) || 30,
    openingCash: Math.round(Number(f.openingCash.replace(/\s/g, '').replace(',', '.')) * 100) || 0,
  };
}

export default function CompanyFields({ f, set, disabled }: { f: CompanyForm; set: (f: CompanyForm) => void; disabled?: boolean }) {
  const inp = (k: keyof CompanyForm, label: string, opts: { full?: boolean; ph?: string; type?: string; max?: number } = {}) => (
    <label className={'fld' + (opts.full ? ' full' : '')}>{label}
      <input className="inp" type={opts.type ?? 'text'} disabled={disabled} value={f[k] as string} placeholder={opts.ph} maxLength={opts.max} onChange={(e) => set({ ...f, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="form">
      <div className="section-t">Identité</div>
      {inp('name', 'Nom de l’entreprise *', { full: true })}
      <label className="fld">Forme juridique<select className="inp" disabled={disabled} value={f.legalForm} onChange={(e) => set({ ...f, legalForm: e.target.value })}>{['', 'SARL', 'SARL AU', 'SA', 'SAS', 'SNC', 'Auto-entrepreneur', 'Personne physique', 'Association'].map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select></label>
      {inp('capital', 'Capital', { ph: 'Ex. 100 000 DH' })}
      <div className="fld full">Couleur principale
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {COLORS.map((c) => <button key={c} type="button" disabled={disabled} onClick={() => set({ ...f, primaryColor: c })} aria-label={`Couleur ${c}`} style={{ width: 34, height: 34, borderRadius: 10, border: f.primaryColor.toLowerCase() === c.toLowerCase() ? '3px solid var(--text)' : '1px solid var(--inb)', background: c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{f.primaryColor.toLowerCase() === c.toLowerCase() && <Icon name="check" size={16} />}</button>)}
          <input className="color-in" type="color" disabled={disabled} value={f.primaryColor} onChange={(e) => set({ ...f, primaryColor: e.target.value })} aria-label="Couleur personnalisée" />
          <code style={{ fontSize: 13 }}>{f.primaryColor}</code>
        </div>
      </div>
      <div className="section-t">Identifiants légaux</div>
      {inp('ice', 'ICE', { max: 30 })}{inp('rc', 'RC', { max: 30 })}{inp('ifiscal', 'Identifiant fiscal (IF)', { max: 30 })}{inp('patente', 'Patente', { max: 30 })}{inp('cnss', 'CNSS', { max: 30 })}
      <div className="section-t">Coordonnées</div>
      {inp('address', 'Adresse', { full: true })}{inp('city', 'Ville')}{inp('phone', 'Téléphone')}{inp('email', 'Email', { type: 'email' })}{inp('website', 'Site web')}
      <div className="section-t">Banque</div>
      {inp('bankName', 'Banque')}{inp('rib', 'RIB (24 chiffres)', { max: 40 })}
      <div className="section-t">Facturation</div>
      <label className="fld">TVA par défaut<select className="inp" disabled={disabled} value={f.tvaDefault} onChange={(e) => set({ ...f, tvaDefault: Number(e.target.value) })}>{[20, 14, 10, 7, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</select></label>
      {inp('paymentDays', 'Délai de paiement (jours)', { type: 'number' })}
      {inp('quoteDays', 'Validité des devis (jours)', { type: 'number' })}
      {inp('openingCash', 'Solde de caisse d’ouverture (DH)')}
      <label className="fld full">Mentions en bas des documents<textarea className="inp" disabled={disabled} value={f.footer} maxLength={2000} onChange={(e) => set({ ...f, footer: e.target.value })} placeholder="Ex. Paiement à 30 jours. Pénalités de retard…" /></label>
    </div>
  );
}
