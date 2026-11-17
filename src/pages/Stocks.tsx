import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, del, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { csvMoney, downloadCsv } from '../lib/docs';
import { dh, fromCents, norm, qtyFmt, toCents } from '../lib/format';
import { Icon, Modal, PageHead, Pill, Spinner, useData, usePager, useToast } from '../lib/ui';
import type { Product } from './DocEdit';

type P = Product & { category: string | null; alertThreshold: number };
type Move = { id: string; date: string; kind: string; qty: number; reason: string; product: { ref: string; name: string; unit: string } };
const CATS = ['Informatique', 'Réseau', 'Logiciel', 'Fournitures', 'Électricité', 'Marchandises', 'Matières premières', 'Prestation'];
const UNITS = ['u', 'kg', 'g', 'L', 'm', 'm²', 'm³', 'boîte', 'carton', 'paquet', 'jour', 'heure', 'forfait'];

function ProductModal({ initial, onClose, onSaved, onDeleted }: { initial?: P; onClose: () => void; onSaved: () => void; onDeleted: (msg: string) => void }) {
  const [f, setF] = useState({
    ref: initial?.ref ?? '', name: initial?.name ?? '', category: initial?.category ?? '', unit: initial?.unit ?? 'u', isService: initial?.isService ?? false,
    stock: '0', alertThreshold: String(initial?.alertThreshold ?? 0), purchasePrice: fromCents(initial?.purchasePrice ?? 0), salePrice: fromCents(initial?.salePrice ?? 0),
    tvaRate: initial?.tvaRate ?? 20, active: initial?.active ?? true,
  });
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    const pp = toCents(f.purchasePrice || '0'), sp = toCents(f.salePrice || '0');
    if (!Number.isFinite(pp) || !Number.isFinite(sp) || pp < 0 || sp < 0) return setErr('Prix invalide');
    const body = {
      ...(f.ref.trim() && { ref: f.ref.trim() }), name: f.name, category: f.category || null, unit: f.unit, isService: f.isService,
      alertThreshold: Number(f.alertThreshold.replace(',', '.')) || 0, purchasePrice: pp, salePrice: sp, tvaRate: f.tvaRate, active: f.active,
      ...(!initial && !f.isService && { stock: Number(f.stock.replace(',', '.')) || 0 }),
    };
    try { if (initial) await patch('/products/' + initial.id, body); else await post('/products', body); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  const margin = toCents(f.salePrice || '0') - toCents(f.purchasePrice || '0');
  return (
    <Modal title={initial ? `Modifier ${initial.ref}` : 'Nouvel article'} onClose={onClose}
      footer={<>
        {initial && <button className="btn btn-red" style={{ marginRight: 'auto' }} onClick={async () => {
          if (!confirm(`Supprimer ${initial.name} ?`)) return;
          try { await del('/products/' + initial.id); onDeleted('Article supprimé'); } catch (e) { setErr((e as Error).message); }
        }}><Icon name="trash" size={18} />Supprimer</button>}
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-green" onClick={save} disabled={!f.name.trim()}>Enregistrer</button></>}>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form">
        <label className="fld full">Désignation *<input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="fld">Référence<input className="inp" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="Automatique" /></label>
        <label className="fld">Catégorie<input className="inp" list="cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="cats">{CATS.map((c) => <option key={c} value={c} />)}</datalist></label>
        <div className="fld full">Type<div className="chips">
          <button type="button" className={'chip' + (!f.isService ? ' on' : '')} onClick={() => setF({ ...f, isService: false })}>Article stocké</button>
          <button type="button" className={'chip' + (f.isService ? ' on' : '')} onClick={() => setF({ ...f, isService: true, unit: f.unit === 'u' ? 'forfait' : f.unit })}>Prestation (sans stock)</button>
        </div></div>
        <label className="fld">Unité<select className="inp" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="fld">TVA<select className="inp" value={f.tvaRate} onChange={(e) => setF({ ...f, tvaRate: Number(e.target.value) })}>{[20, 14, 10, 7, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</select></label>
        <label className="fld">Prix d'achat HT (DH)<input className="inp" inputMode="decimal" value={f.purchasePrice} onChange={(e) => setF({ ...f, purchasePrice: e.target.value })} /></label>
        <label className="fld">Prix de vente HT (DH)<input className="inp" inputMode="decimal" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} /><span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>Marge : {dh(margin)}</span></label>
        {!f.isService && !initial && <label className="fld">Stock initial<input className="inp" inputMode="decimal" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></label>}
        {!f.isService && <label className="fld">Seuil d'alerte<input className="inp" inputMode="decimal" value={f.alertThreshold} onChange={(e) => setF({ ...f, alertThreshold: e.target.value })} /></label>}
        {initial && <label className="toggle full"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Article actif (proposé dans les documents)</label>}
      </div>
    </Modal>
  );
}

function AdjustModal({ p, onClose, onSaved }: { p: P; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'IN' | 'OUT' | 'SET'>('IN');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const q = Number(qty.replace(',', '.'));
  const after = mode === 'SET' ? q : mode === 'IN' ? p.stock + q : p.stock - q;
  const save = async () => {
    if (!(q >= 0) || qty === '') return setErr('Quantité invalide');
    try { await post(`/products/${p.id}/adjust`, { mode, qty: q, reason }); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={`Ajuster le stock — ${p.name}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-green" onClick={save} disabled={reason.trim().length < 2}>Valider</button></>}>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="form">
        <div className="fld full">Opération<div className="chips">
          {([['IN', 'Entrée'], ['OUT', 'Sortie'], ['SET', 'Inventaire (stock constaté)']] as const).map(([k, l]) => <button key={k} type="button" className={'chip' + (mode === k ? ' on' : '')} onClick={() => setMode(k)}>{l}</button>)}
        </div></div>
        <label className="fld">{mode === 'SET' ? 'Stock constaté' : 'Quantité'} ({p.unit})<input className="inp" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <div className="fld">Stock après<b style={{ fontSize: 20, paddingTop: 8 }} className={after < 0 ? 'neg' : ''}>{Number.isFinite(after) ? qtyFmt(after) : '—'} {p.unit}</b><span className="muted" style={{ fontWeight: 500 }}>Actuel : {qtyFmt(p.stock)}</span></div>
        <label className="fld full">Motif *<input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. Casse, inventaire annuel, retour fournisseur…" /></label>
      </div>
    </Modal>
  );
}

export default function Stocks() {
  const { can } = useAuth();
  const notify = useToast();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'articles' | 'moves'>('articles');
  const [filter, setFilter] = useState('Tous');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<P | 'new' | null>(null);
  const [adjust, setAdjust] = useState<P | null>(null);
  const { data, error, loading, reload } = useData(() => api<P[]>('/products'));
  const moves = useData(() => (view === 'moves' ? api<Move[]>('/stock/movements') : Promise.resolve([] as Move[])), [view, data]);
  const write = can('stocks', 'write');

  useEffect(() => {
    const id = sp.get('p');
    if (id && data) { const p = data.find((x) => x.id === id); if (p) { setQ(p.ref); setSp({}, { replace: true }); } }
  }, [sp, data, setSp]);

  const all = data ?? [];
  const goods = all.filter((p) => !p.isService);
  const alert = (p: P) => !p.isService && p.stock <= p.alertThreshold;
  const cats = [...new Set(all.map((p) => p.category).filter(Boolean))] as string[];
  const rows = all.filter((p) =>
    (filter === 'Tous' || (filter === 'Alertes' && alert(p) && p.stock > 0) || (filter === 'Ruptures' && !p.isService && p.stock <= 0) || (filter === 'Prestations' && p.isService) || (filter === 'Inactifs' && !p.active)) &&
    (!cat || p.category === cat) && (!q || norm(`${p.ref} ${p.name} ${p.category ?? ''}`).includes(norm(q))));
  const { slice, bar } = usePager(rows, 15);
  const cols = '.8fr 2.2fr 1fr 1.1fr 1fr 1fr 1fr 96px';

  return (
    <>
      <PageHead title="Stocks" sub="Catalogue d'articles et de prestations, niveaux de stock et mouvements.">
        <button className="btn btn-ghost" disabled={!rows.length} onClick={() => downloadCsv('stock.csv', [
          ['Réf.', 'Désignation', 'Catégorie', 'Unité', 'Stock', 'Seuil', 'Prix achat HT', 'Prix vente HT', 'TVA', 'Valeur stock'],
          ...rows.map((p) => [p.ref, p.name, p.category ?? '', p.unit, p.isService ? '' : String(p.stock).replace('.', ','), p.isService ? '' : p.alertThreshold, csvMoney(p.purchasePrice), csvMoney(p.salePrice), p.tvaRate + ' %', csvMoney(Math.max(0, p.stock) * p.purchasePrice)]),
        ])}><Icon name="download" size={18} />Exporter</button>
        {write && <button className="btn btn-green" onClick={() => setEdit('new')}><Icon name="plus" size={18} />Nouvel article</button>}
      </PageHead>
      <div className="stats">
        <div className="stat"><span className="muted">Articles et prestations</span><b>{all.length}</b></div>
        <div className="stat"><span className="muted">Valeur du stock (prix d'achat)</span><b>{dh(goods.reduce((s, p) => s + Math.max(0, p.stock) * p.purchasePrice, 0))}</b></div>
        <div className="stat"><span className="muted">Stock bas</span><b className="warn">{goods.filter((p) => alert(p) && p.stock > 0).length}</b></div>
        <div className="stat"><span className="muted">Ruptures</span><b className="neg">{goods.filter((p) => p.stock <= 0).length}</b></div>
      </div>
      <section className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <div className="tabs">
            <button className={'tab' + (view === 'articles' ? ' on' : '')} onClick={() => setView('articles')}>Articles</button>
            <button className={'tab' + (view === 'moves' ? ' on' : '')} onClick={() => setView('moves')}>Mouvements</button>
          </div>
        </div>
        {view === 'articles' ? (
          <>
            <div className="filters">
              <div className="fld">Filtre<div className="chips">{['Tous', 'Alertes', 'Ruptures', 'Prestations', 'Inactifs'].map((f) => <button key={f} className={'chip' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
              <label className="fld">Catégorie<select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="fld">Recherche<input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Réf., désignation…" /></label>
            </div>
            {error && <div className="err">{error}</div>}
            {loading && !data ? <Spinner /> : (
              <div className="tbl">
                <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Réf.</span><span>Désignation</span><span>Catégorie</span><span className="num">Stock</span><span className="num">Achat HT</span><span className="num">Vente HT</span><span>État</span><span /></div>
                {slice.map((p) => (
                  <div key={p.id} className="tr" style={{ gridTemplateColumns: cols, opacity: p.active ? 1 : 0.55 }}>
                    <span className="muted">{p.ref}</span><b>{p.name}</b><span>{p.category ?? '—'}</span>
                    <span className="num">{p.isService ? '—' : `${qtyFmt(p.stock)} ${p.unit}`}</span>
                    <span className="num" style={{ fontWeight: 500 }}>{dh(p.purchasePrice)}</span><span className="num">{dh(p.salePrice)}</span>
                    <span>{p.isService ? <Pill label="Prestation" cls="p-purple" /> : p.stock <= 0 ? <Pill label="Rupture" cls="p-red" /> : alert(p) ? <Pill label="Stock bas" cls="p-orange" /> : <Pill label="OK" cls="p-green" />}</span>
                    <span className="row-act">
                      {write && !p.isService && <button className="mini" title="Ajuster le stock" aria-label={`Ajuster le stock de ${p.name}`} onClick={() => setAdjust(p)}><Icon name="box" size={16} /></button>}
                      {write && <button className="mini" title="Modifier" aria-label={`Modifier ${p.name}`} onClick={() => setEdit(p)}><Icon name="edit" size={16} /></button>}
                    </span>
                  </div>
                ))}
                {!rows.length && <div className="empty">{all.length ? 'Aucun article pour ces filtres.' : 'Votre catalogue est vide : ajoutez vos articles et prestations.'}</div>}
              </div>
            )}
            {bar}
          </>
        ) : moves.loading ? <Spinner /> : (
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: '1.1fr 2fr .8fr 1fr 2fr' }}><span>Date</span><span>Article</span><span>Type</span><span className="num">Quantité</span><span>Motif</span></div>
            {(moves.data ?? []).map((m) => (
              <div key={m.id} className="tr" style={{ gridTemplateColumns: '1.1fr 2fr .8fr 1fr 2fr' }}>
                <span>{new Date(m.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span><b>{m.product.name}</b> <span className="muted">{m.product.ref}</span></span>
                <span><Pill label={m.kind === 'IN' ? 'Entrée' : m.kind === 'OUT' ? 'Sortie' : 'Inventaire'} cls={m.kind === 'IN' ? 'p-green' : m.kind === 'OUT' ? 'p-orange' : 'p-blue'} /></span>
                <span className={'num ' + (m.qty < 0 ? 'neg' : 'pos')}>{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)} {m.product.unit}</span>
                <span className="muted">{m.reason}</span>
              </div>
            ))}
            {!moves.data?.length && <div className="empty">Aucun mouvement.</div>}
          </div>
        )}
      </section>
      {edit && (
        <ProductModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); notify('Article enregistré'); reload(); }} onDeleted={(m) => { setEdit(null); notify(m); reload(); }} />
      )}
      {adjust && <AdjustModal p={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); notify('Stock ajusté'); reload(); }} />}
    </>
  );
}
