import { useState } from 'react';
import { api, del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { csvMoney, downloadCsv, presets } from '../lib/docs';
import { dh, fdate, fromCents, norm, PAY_METHODS, toCents, todayISO } from '../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useData, usePager, useToast } from '../lib/ui';

type E = { id: string; date: string; label: string; category: string; amount: number; tvaAmount: number; supplierId: string | null; supplier: { id: string; name: string } | null; method: string; reference: string | null };
const CATS = ['Achats', 'Loyer', 'Salaires', 'Services', 'Transport', 'Énergie', 'Télécom', 'Impôts et taxes', 'Banque', 'Marketing', 'Autres'];
const CLS = ['p-blue', 'p-green', 'p-purple', 'p-orange', 'p-red', 'p-gray'];
const catCls = (c: string) => CLS[Math.abs([...c].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % CLS.length];

export default function Expenses() {
  const { can } = useAuth();
  const notify = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ id?: string; label: string; category: string; amount: string; tva: string; supplierId: string; method: string; date: string; reference: string } | null>(null);
  const [err, setErr] = useState('');
  const { data, error, loading, reload } = useData(() => api<E[]>('/expenses?' + new URLSearchParams({ ...(from && { from }), ...(to && { to }) })), [from, to]);
  const sup = useData(() => (can('fournisseurs') ? api<{ id: string; name: string }[]>('/suppliers') : Promise.resolve([])));
  const rows = (data ?? []).filter((e) => (!cat || e.category === cat) && (!q || norm(`${e.label} ${e.supplier?.name ?? ''} ${e.reference ?? ''}`).includes(norm(q))));
  const { slice, bar } = usePager(rows, 15);
  const write = can('depenses', 'write');
  const pr = presets();
  const curP = pr.find((p) => p.from === from && p.to === to)?.id;
  const byCat = new Map<string, number>();
  rows.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
  const cols = '.9fr 2fr 1fr 1.4fr .9fr 1fr 80px';

  const save = async () => {
    if (!form) return;
    setErr('');
    const amount = toCents(form.amount), tvaAmount = toCents(form.tva || '0');
    if (!(amount > 0)) return setErr('Montant invalide');
    const body = { label: form.label, category: form.category, amount, tvaAmount: tvaAmount || 0, supplierId: form.supplierId || null, method: form.method, date: form.date, reference: form.reference || null };
    try {
      if (form.id) await patch('/expenses/' + form.id, body); else await post('/expenses', body);
      setForm(null); notify('Dépense enregistrée'); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const tvaFrom = (ttc: string, rate: number) => { const c = toCents(ttc); return Number.isFinite(c) ? fromCents(Math.round(c - c / (1 + rate / 100))) : ''; };

  return (
    <>
      <PageHead title="Dépenses" sub="Loyer, salaires, services, frais divers : tout ce qui sort hors commandes fournisseurs.">
        <button className="btn btn-ghost" disabled={!rows.length} onClick={() => downloadCsv('depenses.csv', [
          ['Date', 'Libellé', 'Catégorie', 'Fournisseur', 'Mode', 'Référence', 'Montant TTC', 'dont TVA'],
          ...rows.map((e) => [fdate(e.date), e.label, e.category, e.supplier?.name ?? '', PAY_METHODS[e.method], e.reference ?? '', csvMoney(e.amount), csvMoney(e.tvaAmount)]),
        ])}><Icon name="download" size={18} />Exporter</button>
        {write && <button className="btn btn-green" onClick={() => { setErr(''); setForm({ label: '', category: 'Services', amount: '', tva: '', supplierId: '', method: 'ESPECES', date: todayISO(), reference: '' }); }}><Icon name="plus" size={18} />Nouvelle dépense</button>}
      </PageHead>
      <div className="stats">
        <div className="stat"><span className="muted">Total ({rows.length})</span><b>{dh(rows.reduce((s, e) => s + e.amount, 0))}</b></div>
        <div className="stat"><span className="muted">dont TVA récupérable</span><b>{dh(rows.reduce((s, e) => s + e.tvaAmount, 0))}</b></div>
        {[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, v]) => <div key={c} className="stat"><span className="muted">{c}</span><b>{dh(v)}</b></div>)}
      </div>
      <section className="card">
        <div className="filters">
          <div className="fld">Période<div className="chips">{pr.map((p) => <button key={p.id} className={'chip' + (curP === p.id ? ' on' : '')} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>)}</div></div>
          <label className="fld">Du<input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fld">Au<input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="fld">Catégorie<select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes</option>{[...new Set([...CATS, ...(data ?? []).map((e) => e.category)])].map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="fld">Recherche<input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Libellé, fournisseur…" /></label>
        </div>
        {error && <div className="err">{error}</div>}
        {loading && !data ? <Spinner /> : (
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Date</span><span>Libellé</span><span>Catégorie</span><span>Fournisseur</span><span>Mode</span><span className="num">Montant</span><span /></div>
            {slice.map((e) => (
              <div key={e.id} className="tr" style={{ gridTemplateColumns: cols }}>
                <span>{fdate(e.date)}</span><b>{e.label}</b><span><Pill label={e.category} cls={catCls(e.category)} /></span><span>{e.supplier?.name ?? '—'}</span><span className="muted">{PAY_METHODS[e.method]}</span>
                <span className="num">{dh(e.amount)}</span>
                <span className="row-act">{write && <>
                  <button className="mini" aria-label="Modifier" onClick={() => { setErr(''); setForm({ id: e.id, label: e.label, category: e.category, amount: fromCents(e.amount), tva: fromCents(e.tvaAmount), supplierId: e.supplierId ?? '', method: e.method, date: e.date, reference: e.reference ?? '' }); }}><Icon name="edit" size={15} /></button>
                  <button className="mini del" aria-label="Supprimer" onClick={async () => { if (confirm(`Supprimer « ${e.label} » ?`)) { await del('/expenses/' + e.id).catch((x: Error) => notify(x.message)); reload(); } }}><Icon name="trash" size={15} /></button>
                </>}</span>
              </div>
            ))}
            {!rows.length && <div className="empty">Aucune dépense sur la période.</div>}
          </div>
        )}
        {bar}
      </section>
      {form && (
        <Modal title={form.id ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={() => setForm(null)} footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Annuler</button><button className="btn btn-green" onClick={save} disabled={!form.label.trim()}>Enregistrer</button></>}>
          {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="form">
            <label className="fld full">Libellé *<input className="inp" autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
            <label className="fld">Catégorie<input className="inp" list="exp-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /><datalist id="exp-cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist></label>
            <label className="fld">Date<input className="inp" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="fld">Montant TTC (DH) *<input className="inp" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label className="fld">dont TVA (DH)<div style={{ display: 'flex', gap: 6 }}><input className="inp" inputMode="decimal" value={form.tva} onChange={(e) => setForm({ ...form, tva: e.target.value })} /><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, tva: tvaFrom(form.amount, 20) })} title="Calculer la TVA à 20 %">20 %</button></div></label>
            <label className="fld">Mode de paiement<select className="inp" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="fld">Fournisseur<select className="inp" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}><option value="">—</option>{(sup.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="fld full">Référence (n° de facture, de chèque…)<input className="inp" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </>
  );
}
