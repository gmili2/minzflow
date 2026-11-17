import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DocSheet, { type Company, type FullDoc } from '../components/DocSheet';
import { api, del, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { KIND, PAGE_OF_TYPE, TYPE_LABEL } from '../lib/docs';
import { dh, fdate, fromCents, PAY_METHODS, toCents, todayISO } from '../lib/format';
import { Icon, Modal, Pill, Spinner, useData, useToast } from '../lib/ui';

type Action = { label: string; icon: string; run: () => void; primary?: boolean; danger?: boolean };

export default function DocView() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useToast();
  const { can } = useAuth();
  const { data, error, loading, reload } = useData(() => Promise.all([api<FullDoc>('/document/' + id), api<Company>('/company')]), [id]);
  const [pay, setPay] = useState<{ amount: string; method: string; date: string; reference: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (loading && !data) return <Spinner />;
  if (error || !data) return <div className="err">{error || 'Document introuvable'}</div>;
  const [doc, co] = data;
  const kind = PAGE_OF_TYPE[doc.type];
  const write = can(KIND[kind].module, 'write');
  const party = doc.client ?? doc.supplier;
  const rest = doc.totalTTC - doc.paidAmount;

  const run = async (fn: () => Promise<unknown>, msg: string, go?: (r: unknown) => string | undefined) => {
    setBusy(true); setErr('');
    try {
      const r = await fn();
      notify(msg);
      const to = go?.(r);
      if (to) nav(to); else reload();
      return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const status = (s: string, msg: string) => run(() => post('/document/' + doc.id + '/status', { status: s }), msg);
  const convert = (target: 'BL' | 'FACTURE') => run(
    () => post<{ id: string; number: string }>('/document/' + doc.id + '/convert', { target }), target === 'BL' ? 'Bon de livraison créé' : 'Facture créée',
    (r) => `/${target === 'BL' ? 'bons' : 'factures'}/${(r as { id: string }).id}`,
  );
  const remove = () => { if (confirm(`Supprimer définitivement ${doc.number} ?`)) run(() => del('/document/' + doc.id), `${doc.number} supprimé`, () => `/${kind}`); };
  const cancel = () => {
    if (confirm(`Annuler la facture ${doc.number} ? Un avoir sera créé${doc.source?.type === 'BL' ? '' : ' et les articles reviendront en stock'}.`)) {
      run(() => post<{ id: string }>('/document/' + doc.id + '/cancel'), 'Facture annulée — avoir créé', (r) => `/factures/${(r as { id: string }).id}`);
    }
  };
  const savePay = () => {
    if (!pay) return;
    const amount = toCents(pay.amount);
    if (!(amount > 0)) return setErr('Montant invalide');
    run(() => post('/document/' + doc.id + '/payments', { amount, method: pay.method, date: pay.date, reference: pay.reference || null }), 'Paiement enregistré').then((ok) => ok && setPay(null));
  };
  const removePay = (pid: string) => { if (confirm('Supprimer ce paiement ?')) run(() => del('/payments/' + pid), 'Paiement supprimé'); };

  const subjectLine = `${TYPE_LABEL[doc.type]} ${doc.number} — ${co.name}`;
  const bodyText = doc.type === 'FACTURE' && rest > 0
    ? `Bonjour,\n\nSauf erreur de notre part, la facture ${doc.number} du ${fdate(doc.date)} d'un montant de ${dh(doc.totalTTC)} reste due (reste à payer : ${dh(rest)}, échéance ${fdate(doc.dueDate)}).\nMerci de procéder à son règlement.\n\nCordialement,\n${co.name}`
    : `Bonjour,\n\nVeuillez trouver ci-joint notre ${TYPE_LABEL[doc.type].toLowerCase()} ${doc.number} d'un montant de ${dh(doc.totalTTC)}.\n\nCordialement,\n${co.name}`;
  const phone = party?.phone?.replace(/\D/g, '').replace(/^0/, '212');

  const actions: Action[] = [];
  if (write) {
    if (doc.type === 'DEVIS') {
      if (doc.status !== 'CONVERTI' && doc.status !== 'REFUSE') {
        actions.push({ label: 'Convertir en facture', icon: 'facture', run: () => convert('FACTURE'), primary: true });
        if (can('bons', 'write')) actions.push({ label: 'Convertir en bon de livraison', icon: 'cart', run: () => convert('BL') });
      }
      if (doc.status === 'BROUILLON') actions.push({ label: 'Marquer comme envoyé', icon: 'send', run: () => status('ENVOYE', 'Devis marqué comme envoyé') });
      if (doc.status === 'BROUILLON' || doc.status === 'ENVOYE') {
        actions.push({ label: 'Marquer comme accepté', icon: 'check', run: () => status('ACCEPTE', 'Devis accepté') });
        actions.push({ label: 'Marquer comme refusé', icon: 'x', run: () => status('REFUSE', 'Devis refusé') });
      }
      if (doc.status === 'REFUSE') actions.push({ label: 'Rouvrir le devis', icon: 'undo', run: () => status('BROUILLON', 'Devis rouvert') });
      if (doc.status !== 'CONVERTI') actions.push({ label: 'Modifier', icon: 'edit', run: () => nav(`/devis/${doc.id}/modifier`) });
      if (doc.status !== 'CONVERTI') actions.push({ label: 'Supprimer', icon: 'trash', run: remove, danger: true });
    }
    if (doc.type === 'BL') {
      if (doc.status === 'PREPARE') actions.push({ label: 'Marquer comme livré', icon: 'truck', run: () => status('LIVRE', 'Bon livré — stock mis à jour'), primary: true });
      if ((doc.status === 'PREPARE' || doc.status === 'LIVRE') && can('factures', 'write')) actions.push({ label: 'Facturer ce bon', icon: 'facture', run: () => convert('FACTURE'), primary: doc.status === 'LIVRE' });
      if (doc.status === 'LIVRE') actions.push({ label: 'Annuler la livraison (retour en stock)', icon: 'undo', run: () => status('PREPARE', 'Livraison annulée — stock rétabli') });
      if (doc.status === 'PREPARE') actions.push({ label: 'Modifier', icon: 'edit', run: () => nav(`/bons/${doc.id}/modifier`) });
      if (doc.status === 'PREPARE' || doc.status === 'LIVRE') actions.push({ label: 'Annuler le bon', icon: 'x', run: () => status('ANNULE', 'Bon annulé'), danger: true });
      if (doc.status === 'ANNULE') actions.push({ label: 'Réactiver', icon: 'undo', run: () => status('PREPARE', 'Bon réactivé') });
      if (doc.status !== 'FACTURE') actions.push({ label: 'Supprimer', icon: 'trash', run: remove, danger: true });
    }
    if (doc.type === 'FACTURE' && doc.status !== 'ANNULEE') {
      if (rest > 0) actions.push({ label: 'Enregistrer un paiement', icon: 'cash', run: () => setPay({ amount: fromCents(rest), method: 'VIREMENT', date: todayISO(), reference: '' }), primary: true });
      if (doc.paidAmount === 0) actions.push({ label: 'Modifier', icon: 'edit', run: () => nav(`/factures/${doc.id}/modifier`) });
      if (doc.paidAmount === 0) actions.push({ label: 'Annuler par avoir', icon: 'undo', run: cancel, danger: true });
    }
    if (doc.type === 'BC') {
      if (doc.status === 'BROUILLON') actions.push({ label: 'Valider la commande', icon: 'send', run: () => status('COMMANDE', 'Commande validée'), primary: true });
      if (doc.status === 'COMMANDE') actions.push({ label: 'Réceptionner (entrée en stock)', icon: 'box', run: () => status('RECU', 'Commande réceptionnée — stock mis à jour'), primary: true });
      if (doc.status === 'RECU' && rest > 0) actions.push({ label: 'Enregistrer un règlement', icon: 'cash', run: () => setPay({ amount: fromCents(rest), method: 'VIREMENT', date: todayISO(), reference: '' }), primary: true });
      if (doc.status === 'RECU' && doc.paidAmount === 0) actions.push({ label: 'Annuler la réception', icon: 'undo', run: () => status('COMMANDE', 'Réception annulée — stock rétabli') });
      if (doc.status === 'BROUILLON' || doc.status === 'COMMANDE') actions.push({ label: 'Modifier', icon: 'edit', run: () => nav(`/achats/${doc.id}/modifier`) });
      if (doc.status === 'BROUILLON' || doc.status === 'COMMANDE') actions.push({ label: 'Annuler la commande', icon: 'x', run: () => status('ANNULE', 'Commande annulée'), danger: true });
      if (doc.status === 'ANNULE') actions.push({ label: 'Réactiver', icon: 'undo', run: () => status('BROUILLON', 'Commande réactivée') });
      if (doc.status !== 'RECU') actions.push({ label: 'Supprimer', icon: 'trash', run: remove, danger: true });
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <button className="link-btn" onClick={() => nav(`/${kind}`)} style={{ marginBottom: 4 }}><Icon name="left" size={16} />{doc.type === 'AVOIR' ? 'Factures' : KIND[kind].title}</button>
          <h1 style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>{TYPE_LABEL[doc.type]} {doc.number} <Pill status={doc.displayStatus} /></h1>
          <p>{party?.name} • {dh(doc.totalTTC)} TTC • {fdate(doc.date)}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => window.open('/imprimer/' + doc.id, '_blank')}><Icon name="print" size={18} />Imprimer / PDF</button>
        </div>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="doc-grid">
        <div className="sheet-wrap"><DocSheet doc={doc} co={co} /></div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {actions.length > 0 && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>Actions</h2>
              {actions.map((a) => (
                <button key={a.label} className={'btn btn-block ' + (a.primary ? 'btn-green' : a.danger ? 'btn-red' : 'btn-ghost')} style={{ justifyContent: 'flex-start' }} onClick={a.run} disabled={busy}>
                  <Icon name={a.icon} size={18} />{a.label}
                </button>
              ))}
            </section>
          )}
          {(doc.type === 'FACTURE' || doc.type === 'BC') && (
            <section className="card">
              <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>{doc.type === 'BC' ? 'Règlements' : 'Paiements'}</h2>
              <div className="totals">
                <div><span>Total TTC</span><b>{dh(doc.totalTTC)}</b></div>
                <div><span>Réglé</span><b className="pos">{dh(doc.paidAmount)}</b></div>
                <div><span>Reste</span><b className={rest > 0 ? 'warn' : ''}>{dh(rest)}</b></div>
              </div>
              {doc.payments.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid var(--line)', marginTop: 8, fontSize: 14 }}>
                  <span><b>{dh(p.amount)}</b><br /><span className="muted" style={{ fontSize: 12.5 }}>{fdate(p.date)} • {PAY_METHODS[p.method]}{p.reference ? ` n° ${p.reference}` : ''}</span></span>
                  {write && <button className="mini del" onClick={() => removePay(p.id)} aria-label="Supprimer le paiement"><Icon name="trash" size={15} /></button>}
                </div>
              ))}
            </section>
          )}
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>Envoyer</h2>
            {party?.email ? <a className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} href={`mailto:${party.email}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(bodyText)}`}><Icon name="mail" size={18} />{doc.type === 'FACTURE' && rest > 0 ? 'Relancer par email' : 'Envoyer par email'}</a> : <span className="muted" style={{ fontSize: 13 }}>Ajoutez l'email du {doc.type === 'BC' ? 'fournisseur' : 'client'} pour l'envoi par email.</span>}
            {phone && <a className="btn btn-ghost btn-block" style={{ justifyContent: 'flex-start' }} target="_blank" rel="noreferrer" href={`https://wa.me/${phone}?text=${encodeURIComponent(bodyText)}`}><Icon name="phone" size={18} />WhatsApp</a>}
            <span className="muted" style={{ fontSize: 12.5 }}>Joignez le PDF (Imprimer → Enregistrer en PDF).</span>
          </section>
          {(doc.source || doc.children.length > 0) && (
            <section className="card">
              <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>Documents liés</h2>
              {doc.source && <button className="link-btn" onClick={() => nav(`/${PAGE_OF_TYPE[doc.source!.type]}/${doc.source!.id}`)}>Origine : {TYPE_LABEL[doc.source.type]} {doc.source.number}</button>}
              {doc.children.map((c) => <div key={c.id}><button className="link-btn" onClick={() => nav(`/${PAGE_OF_TYPE[c.type]}/${c.id}`)}>{TYPE_LABEL[c.type]} {c.number} <Icon name="right" size={14} /></button></div>)}
            </section>
          )}
        </aside>
      </div>

      {pay && (
        <Modal title={doc.type === 'BC' ? 'Règlement fournisseur' : 'Enregistrer un paiement'} onClose={() => setPay(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setPay(null)}>Annuler</button><button className="btn btn-green" onClick={savePay} disabled={busy}>Enregistrer</button></>}>
          <div className="form">
            <label className="fld">Montant (DH) *<input className="inp" inputMode="decimal" autoFocus value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /><span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>Reste : {dh(rest)}</span></label>
            <label className="fld">Date<input className="inp" type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></label>
            <div className="fld full">Mode de paiement<div className="chips">{Object.entries(PAY_METHODS).map(([k, l]) => <button key={k} type="button" className={'chip' + (pay.method === k ? ' on' : '')} onClick={() => setPay({ ...pay, method: k })}>{l}</button>)}</div></div>
            <label className="fld full">Référence (n° de chèque, virement…)<input className="inp" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </>
  );
}
