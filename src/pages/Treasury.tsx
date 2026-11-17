import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, del, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { csvMoney, downloadCsv, presets } from '../lib/docs';
import { dh, fdate, PAY_METHODS, toCents, todayISO } from '../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useData, usePager, useToast } from '../lib/ui';

type Row = { id: string; docId?: string; date: string; label: string; ref: string; type: 'IN' | 'OUT'; amount: number; method: string; source: string; balance: number };
type T = { rows: Row[]; opening: number; balance: number; balances: { caisse: number; banque: number }; monthIn: number; monthOut: number; periodIn: number; periodOut: number };

export default function Treasury() {
  const { can } = useAuth();
  const nav = useNavigate();
  const notify = useToast();
  const [account, setAccount] = useState<'tout' | 'caisse' | 'banque'>('tout');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [modal, setModal] = useState<{ label: string; type: 'IN' | 'OUT'; amount: string; date: string; method: string } | null>(null);
  const [err, setErr] = useState('');
  const { data, error, loading, reload } = useData(() => api<T>('/treasury?' + new URLSearchParams({ account, ...(from && { from }), ...(to && { to }) })), [account, from, to]);
  const { slice, bar } = usePager(data?.rows ?? [], 15);
  const write = can('caisse', 'write');
  const pr = presets();
  const cur = pr.find((p) => p.from === from && p.to === to)?.id;
  const cols = '.9fr 2.2fr 1.1fr .9fr 1fr 1fr 1.1fr 44px';

  const save = async () => {
    if (!modal) return;
    const amount = toCents(modal.amount);
    if (!(amount > 0)) return setErr('Montant invalide');
    try { await post('/cash', { ...modal, amount }); setModal(null); notify('Opération enregistrée'); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const open = (r: Row) => {
    if (r.source === 'paiement' && r.docId) nav('/factures/' + r.docId);
    else if (r.source === 'reglement' && r.docId) nav('/achats/' + r.docId);
    else if (r.source === 'depense') nav('/depenses');
  };

  return (
    <>
      <PageHead title="Trésorerie" sub="Journal de caisse et de banque : encaissements, règlements, dépenses et opérations manuelles.">
        <button className="btn btn-ghost" disabled={!data?.rows.length} onClick={() => downloadCsv('tresorerie.csv', [
          ['Date', 'Libellé', 'Référence', 'Mode', 'Entrée', 'Sortie', 'Solde'],
          ...(data?.rows ?? []).map((r) => [fdate(r.date), r.label, r.ref, PAY_METHODS[r.method], r.type === 'IN' ? csvMoney(r.amount) : '', r.type === 'OUT' ? csvMoney(r.amount) : '', csvMoney(r.balance)]),
        ])}><Icon name="download" size={18} />Exporter</button>
        {write && <button className="btn btn-green" onClick={() => { setErr(''); setModal({ label: '', type: 'IN', amount: '', date: todayISO(), method: 'ESPECES' }); }}><Icon name="plus" size={18} />Nouvelle opération</button>}
      </PageHead>
      {data && (
        <div className="stats">
          <div className="stat"><span className="muted">Solde total</span><b>{dh(data.balances.caisse + data.balances.banque)}</b></div>
          <div className="stat"><span className="muted">Caisse (espèces)</span><b>{dh(data.balances.caisse)}</b></div>
          <div className="stat"><span className="muted">Banque</span><b>{dh(data.balances.banque)}</b></div>
          <div className="stat"><span className="muted">Ce mois : entrées / sorties</span><b><span className="pos">{dh(data.monthIn)}</span> <span className="muted" style={{ fontWeight: 400 }}>/</span> <span className="neg">{dh(data.monthOut)}</span></b></div>
        </div>
      )}
      <section className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <div className="tabs">{([['tout', 'Tout'], ['caisse', 'Caisse'], ['banque', 'Banque']] as const).map(([k, l]) => <button key={k} className={'tab' + (account === k ? ' on' : '')} onClick={() => setAccount(k)}>{l}</button>)}</div>
        </div>
        <div className="filters">
          <div className="fld">Période<div className="chips">{pr.map((p) => <button key={p.id} className={'chip' + (cur === p.id ? ' on' : '')} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>)}</div></div>
          <label className="fld">Du<input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fld">Au<input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {error && <div className="err">{error}</div>}
        {loading && !data ? <Spinner /> : data && (
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Date</span><span>Libellé</span><span>Référence</span><span>Mode</span><span className="num">Entrée</span><span className="num">Sortie</span><span className="num">Solde</span><span /></div>
            {slice.map((r) => (
              <div key={r.source + r.id} className={'tr' + (r.source !== 'manuel' ? ' clickable' : '')} style={{ gridTemplateColumns: cols }} onClick={() => open(r)}>
                <span>{fdate(r.date)}</span><span>{r.label}</span><span className="muted">{r.ref}</span><span><Pill label={PAY_METHODS[r.method]} cls={r.method === 'ESPECES' ? 'p-orange' : 'p-blue'} /></span>
                <span className="num pos">{r.type === 'IN' ? dh(r.amount) : ''}</span><span className="num neg">{r.type === 'OUT' ? dh(r.amount) : ''}</span><span className="num">{dh(r.balance)}</span>
                <span className="row-act" onClick={(e) => e.stopPropagation()}>{write && r.source === 'manuel' && <button className="mini del" aria-label="Supprimer l'opération" onClick={async () => { if (confirm('Supprimer cette opération ?')) { await del('/cash/' + r.id).catch((e: Error) => notify(e.message)); reload(); } }}><Icon name="trash" size={15} /></button>}</span>
              </div>
            ))}
            {!data.rows.length && <div className="empty">Aucune écriture sur la période.</div>}
            <div className="pager"><span className="muted">Solde d'ouverture de la période : <b>{dh(data.opening)}</b></span><span>Entrées <b className="pos">{dh(data.periodIn)}</b> • Sorties <b className="neg">{dh(data.periodOut)}</b></span></div>
          </div>
        )}
        {bar}
      </section>
      {modal && (
        <Modal title="Opération de trésorerie" onClose={() => setModal(null)} footer={<><button className="btn btn-ghost" onClick={() => setModal(null)}>Annuler</button><button className="btn btn-green" onClick={save} disabled={!modal.label.trim()}>Enregistrer</button></>}>
          {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form">
            <div className="fld full">Type<div className="chips"><button type="button" className={'chip' + (modal.type === 'IN' ? ' on' : '')} onClick={() => setModal({ ...modal, type: 'IN' })}>Entrée</button><button type="button" className={'chip' + (modal.type === 'OUT' ? ' on' : '')} onClick={() => setModal({ ...modal, type: 'OUT' })}>Sortie</button></div></div>
            <label className="fld full">Libellé *<input className="inp" autoFocus value={modal.label} onChange={(e) => setModal({ ...modal, label: e.target.value })} placeholder="Ex. Apport en caisse, retrait banque…" /></label>
            <label className="fld">Montant (DH) *<input className="inp" inputMode="decimal" value={modal.amount} onChange={(e) => setModal({ ...modal, amount: e.target.value })} /></label>
            <label className="fld">Date<input className="inp" type="date" value={modal.date} onChange={(e) => setModal({ ...modal, date: e.target.value })} /></label>
            <label className="fld full">Mode<select className="inp" value={modal.method} onChange={(e) => setModal({ ...modal, method: e.target.value })}>{Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>Les paiements de factures, règlements fournisseurs et dépenses apparaissent automatiquement : ne les ressaisissez pas ici.</p>
        </Modal>
      )}
    </>
  );
}
