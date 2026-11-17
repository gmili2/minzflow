import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PAGE_OF_TYPE, TYPE_LABEL } from '../lib/docs';
import { dh, fdate, PAY_METHODS } from '../lib/format';
import { Icon, Pill, Spinner, useData, useToast } from '../lib/ui';
import { PartyModal, type PartyRow } from './Parties';

type Detail = PartyRow & {
  invoiced?: number; paid?: number;
  documents: { id: string; type: string; number: string; date: string; dueDate?: string | null; totalTTC: number; paidAmount: number; displayStatus: string; subject: string | null }[];
  expenses?: { id: string; date: string; label: string; amount: number; method: string }[];
};

export default function PartyView({ kind }: { kind: 'clients' | 'fournisseurs' }) {
  const sup = kind === 'fournisseurs';
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useToast();
  const { can } = useAuth();
  const [edit, setEdit] = useState(false);
  const { data: p, error, loading, reload } = useData(() => api<Detail>(`/${sup ? 'suppliers' : 'clients'}/${id}`), [id]);
  if (loading && !p) return <Spinner />;
  if (error || !p) return <div className="err">{error || 'Introuvable'}</div>;
  const write = can(kind, 'write');
  const invoices = p.documents.filter((d) => d.type === (sup ? 'BC' : 'FACTURE') && !['ANNULEE', 'ANNULE'].includes(d.displayStatus));
  const total = invoices.reduce((s, d) => s + d.totalTTC, 0);
  const paid = invoices.reduce((s, d) => s + d.paidAmount, 0);
  const remove = async () => {
    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
    try { await del(`/${sup ? 'suppliers' : 'clients'}/${p.id}`); notify('Supprimé'); nav('/' + kind); } catch (e) { notify((e as Error).message); }
  };

  return (
    <>
      <div className="head">
        <div>
          <button className="link-btn" onClick={() => nav('/' + kind)}><Icon name="left" size={16} />{sup ? 'Fournisseurs' : 'Clients'}</button>
          <h1>{p.name}</h1>
          <p>{[p.category, p.city, p.ice && `ICE ${p.ice}`].filter(Boolean).join(' • ') || (sup ? 'Fournisseur' : 'Client')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {write && <button className="btn btn-red" onClick={remove}><Icon name="trash" size={18} />Supprimer</button>}
          {write && <button className="btn btn-ghost" onClick={() => setEdit(true)}><Icon name="edit" size={18} />Modifier</button>}
          {!sup && can('devis', 'write') && <button className="btn btn-ghost" onClick={() => nav('/devis/nouveau')}><Icon name="devis" size={18} />Devis</button>}
          {!sup && can('factures', 'write') && <button className="btn btn-green" onClick={() => nav('/factures/nouveau')}><Icon name="plus" size={18} />Facture</button>}
          {sup && can('achats', 'write') && <button className="btn btn-green" onClick={() => nav('/achats/nouveau')}><Icon name="plus" size={18} />Commande</button>}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><span className="muted">{sup ? 'Commandes reçues' : 'Facturé'} (TTC)</span><b>{dh(total)}</b></div>
        <div className="stat"><span className="muted">{sup ? 'Réglé' : 'Encaissé'}</span><b className="pos">{dh(paid)}</b></div>
        <div className="stat"><span className="muted">Reste dû</span><b className={total - paid > 0 ? 'warn' : ''}>{dh(total - paid)}</b></div>
      </div>
      <div className="grid2">
        <section className="card">
          <div className="card-h"><h2>Documents</h2></div>
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: '1.3fr 1.1fr 1fr 1fr 1fr' }}><span>Document</span><span>Date</span><span className="num">Montant</span><span className="num">Reste</span><span>Statut</span></div>
            {p.documents.map((d) => (
              <div key={d.id} className="tr clickable" style={{ gridTemplateColumns: '1.3fr 1.1fr 1fr 1fr 1fr' }} onClick={() => nav(`/${PAGE_OF_TYPE[d.type]}/${d.id}`)}>
                <span><b>{d.number}</b><br /><span className="muted" style={{ fontSize: 12 }}>{TYPE_LABEL[d.type]}</span></span>
                <span>{fdate(d.date)}</span><span className="num">{dh(d.totalTTC)}</span>
                <span className="num">{['FACTURE', 'BC'].includes(d.type) && !['ANNULEE', 'ANNULE'].includes(d.displayStatus) ? dh(d.totalTTC - d.paidAmount) : '—'}</span>
                <span><Pill status={d.displayStatus} /></span>
              </div>
            ))}
            {!p.documents.length && <div className="empty">Aucun document.</div>}
          </div>
        </section>
        <section className="card">
          <div className="card-h"><h2>Coordonnées</h2></div>
          <dl className="kv">
            <dt>Contact</dt><dd>{p.contact ?? '—'}</dd>
            <dt>Téléphone</dt><dd>{p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : '—'}</dd>
            <dt>Email</dt><dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : '—'}</dd>
            <dt>Adresse</dt><dd>{[p.address, p.city].filter(Boolean).join(', ') || '—'}</dd>
            <dt>ICE</dt><dd>{p.ice ?? '—'}</dd>
          </dl>
          {p.notes && <p style={{ whiteSpace: 'pre-line', fontSize: 14 }} className="muted">{p.notes}</p>}
          {sup && !!p.expenses?.length && (
            <>
              <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>Dépenses liées</h3>
              {p.expenses.slice(0, 10).map((x) => <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: '1px solid var(--line)' }}><span>{fdate(x.date)} — {x.label} <span className="muted">({PAY_METHODS[x.method]})</span></span><b>{dh(x.amount)}</b></div>)}
            </>
          )}
        </section>
      </div>
      {edit && <PartyModal kind={kind} initial={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); notify('Fiche mise à jour'); reload(); }} />}
    </>
  );
}
