import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { downloadCsv, csvMoney } from '../lib/docs';
import { dh, norm } from '../lib/format';
import { Icon, Modal, PageHead, Spinner, useData, usePager, useToast } from '../lib/ui';

export type PartyRow = {
  id: string; name: string; category?: string | null; ice: string | null; contact: string | null; city: string | null; address: string | null;
  email: string | null; phone: string | null; notes: string | null; invoiced?: number; purchased?: number; due: number;
};
const EMPTY = { name: '', category: '', ice: '', contact: '', city: '', address: '', email: '', phone: '', notes: '' };
export const SUPPLIER_CATS = ['Fournitures', 'Marchandises', 'Services IT', 'Logistique', 'Comptabilité', 'Énergie', 'Télécom', 'Autres'];

/** Formulaire client / fournisseur (création et modification). */
export function PartyModal({ kind, initial, onClose, onSaved }: { kind: 'clients' | 'fournisseurs'; initial?: PartyRow; onClose: () => void; onSaved: (p: PartyRow) => void }) {
  const sup = kind === 'fournisseurs';
  const [f, setF] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ''])) } as typeof EMPTY));
  const [err, setErr] = useState('');
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr('');
    const body = { name: f.name, ice: f.ice, contact: f.contact, city: f.city, address: f.address, email: f.email, phone: f.phone, notes: f.notes, ...(sup && { category: f.category }) };
    try {
      const p = initial ? await patch<PartyRow>(`/${sup ? 'suppliers' : 'clients'}/${initial.id}`, body) : await post<PartyRow>(`/${sup ? 'suppliers' : 'clients'}`, body);
      onSaved(p);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={(initial ? 'Modifier ' : 'Nouveau ') + (sup ? 'fournisseur' : 'client')} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-green" onClick={save} disabled={!f.name.trim()}>{initial ? 'Enregistrer' : 'Ajouter'}</button></>}>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form">
        <label className="fld full">Nom / raison sociale *<input className="inp" autoFocus value={f.name} onChange={set('name')} /></label>
        {sup && <label className="fld">Catégorie<input className="inp" list="sup-cats" value={f.category} onChange={set('category')} /><datalist id="sup-cats">{SUPPLIER_CATS.map((c) => <option key={c} value={c} />)}</datalist></label>}
        <label className="fld">ICE<input className="inp" value={f.ice} onChange={set('ice')} maxLength={30} /></label>
        <label className="fld">Personne de contact<input className="inp" value={f.contact} onChange={set('contact')} /></label>
        <label className="fld">Téléphone<input className="inp" value={f.phone} onChange={set('phone')} /></label>
        <label className="fld">Email<input className="inp" type="email" value={f.email} onChange={set('email')} /></label>
        <label className="fld">Ville<input className="inp" value={f.city} onChange={set('city')} /></label>
        <label className="fld full">Adresse<input className="inp" value={f.address} onChange={set('address')} /></label>
        <label className="fld full">Notes internes<textarea className="inp" value={f.notes} onChange={set('notes')} /></label>
      </div>
    </Modal>
  );
}

export default function Parties({ kind }: { kind: 'clients' | 'fournisseurs' }) {
  const sup = kind === 'fournisseurs';
  const { can } = useAuth();
  const nav = useNavigate();
  const notify = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const { data, error, loading, reload } = useData(() => api<PartyRow[]>(sup ? '/suppliers' : '/clients'), [kind]);
  const rows = (data ?? []).filter((r) => !q || norm(`${r.name} ${r.city ?? ''} ${r.email ?? ''} ${r.phone ?? ''} ${r.category ?? ''}`).includes(norm(q)));
  const { slice, bar } = usePager(rows, 15);
  const write = can(kind, 'write');
  const cols = '1.8fr 1fr 1.5fr 1.1fr 1fr 1fr 50px';

  return (
    <>
      <PageHead title={sup ? 'Fournisseurs' : 'Clients'} sub={sup ? 'Vos fournisseurs, leurs commandes et ce que vous leur devez.' : 'Votre portefeuille clients, leur chiffre d’affaires et leurs impayés.'}>
        <button className="btn btn-ghost" disabled={!rows.length} onClick={() => downloadCsv(`${kind}.csv`, [
          ['Nom', 'ICE', 'Ville', 'Email', 'Téléphone', sup ? 'Achats TTC' : 'CA TTC', 'Reste dû'],
          ...rows.map((r) => [r.name, r.ice ?? '', r.city ?? '', r.email ?? '', r.phone ?? '', csvMoney((sup ? r.purchased : r.invoiced) ?? 0), csvMoney(r.due)]),
        ])}><Icon name="download" size={18} />Exporter</button>
        {write && <button className="btn btn-green" onClick={() => setModal(true)}><Icon name="plus" size={18} />{sup ? 'Nouveau fournisseur' : 'Nouveau client'}</button>}
      </PageHead>
      <div className="stats">
        <div className="stat"><span className="muted">{sup ? 'Fournisseurs' : 'Clients'}</span><b>{data?.length ?? 0}</b></div>
        <div className="stat"><span className="muted">{sup ? 'Total des achats' : 'Chiffre d’affaires total'}</span><b>{dh((data ?? []).reduce((s, r) => s + ((sup ? r.purchased : r.invoiced) ?? 0), 0))}</b></div>
        <div className="stat"><span className="muted">{sup ? 'Reste à régler' : 'Reste à encaisser'}</span><b className="warn">{dh((data ?? []).reduce((s, r) => s + r.due, 0))}</b></div>
      </div>
      <section className="card">
        <div className="filters"><label className="fld" style={{ flex: '1 1 260px', maxWidth: 420 }}>Recherche<input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville, email, téléphone…" /></label></div>
        {error && <div className="err">{error}</div>}
        {loading && !data ? <Spinner /> : (
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Nom</span><span>{sup ? 'Catégorie' : 'Ville'}</span><span>Email</span><span>Téléphone</span><span className="num">{sup ? 'Achats' : 'CA'}</span><span className="num">Reste dû</span><span /></div>
            {slice.map((r) => (
              <div key={r.id} className="tr clickable" style={{ gridTemplateColumns: cols }} onClick={() => nav(`/${kind}/${r.id}`)}>
                <b>{r.name}</b><span>{(sup ? r.category : r.city) ?? '—'}</span><span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email ?? '—'}</span><span>{r.phone ?? '—'}</span>
                <span className="num">{dh((sup ? r.purchased : r.invoiced) ?? 0)}</span><span className={'num' + (r.due > 0 ? ' warn' : '')}>{dh(r.due)}</span>
                <span className="row-act"><Icon name="right" size={16} /></span>
              </div>
            ))}
            {!rows.length && <div className="empty">{data?.length ? 'Aucun résultat.' : `Aucun ${sup ? 'fournisseur' : 'client'} pour l'instant.`}</div>}
          </div>
        )}
        {bar}
      </section>
      {modal && <PartyModal kind={kind} onClose={() => setModal(false)} onSaved={(p) => { setModal(false); notify(`« ${p.name} » ajouté`); reload(); }} />}
    </>
  );
}
