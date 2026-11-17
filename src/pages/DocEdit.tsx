import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, patch, post } from '../lib/api';
import { KIND, type DocKind } from '../lib/docs';
import { dh, fromCents, norm, qtyFmt, toCents, todayISO } from '../lib/format';
import { totalsOf } from '../lib/totals';
import { Icon, Modal, PageHead, Spinner, useToast } from '../lib/ui';

export type Product = { id: string; ref: string; name: string; unit: string; isService: boolean; stock: number; salePrice: number; purchasePrice: number; tvaRate: number; active: boolean };
type Party = { id: string; name: string; city?: string | null };
type Line = { key: number; productId: string | null; designation: string; qty: string; price: string; discount: string; tvaRate: number };
type Company = { tvaDefault: number };

let seq = 1;
const blank = (tva: number): Line => ({ key: seq++, productId: null, designation: '', qty: '1', price: '', discount: '0', tvaRate: tva });
const numIn = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

/** Champ désignation avec recherche dans le catalogue. */
function ProductPick({ value, onText, onPick, products, purchase }: { value: string; onText: (s: string) => void; onPick: (p: Product) => void; products: Product[]; purchase: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c);
  }, []);
  const q = norm(value);
  const list = products.filter((p) => p.active && (!q || norm(p.name + ' ' + p.ref).includes(q))).slice(0, 30);
  return (
    <div className="pick" ref={ref}>
      <input className="inp" value={value} placeholder="Article ou désignation libre…" onFocus={() => setOpen(true)} onChange={(e) => { onText(e.target.value); setOpen(true); }} aria-label="Désignation" />
      {open && list.length > 0 && (
        <div className="pick-list">
          {list.map((p) => (
            <button type="button" key={p.id} className="pick-item" onMouseDown={(e) => { e.preventDefault(); onPick(p); setOpen(false); }}>
              <span><b>{p.name}</b><br /><span className="muted" style={{ fontSize: 12 }}>{p.ref}{!p.isService && ` • stock ${qtyFmt(p.stock)} ${p.unit}`}</span></span>
              <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{dh(purchase ? p.purchasePrice : p.salePrice)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocEdit({ kind }: { kind: string }) {
  const cfg = KIND[kind as DocKind];
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useToast();
  const purchase = cfg.party === 'fournisseur';
  const [products, setProducts] = useState<Product[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [tvaDefault, setTvaDefault] = useState(20);
  const [loading, setLoading] = useState(true);
  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<{ name: string; city: string; phone: string; email: string; ice: string } | null>(null);
  const [number, setNumber] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [ps, pt, co] = await Promise.all([api<Product[]>('/products'), api<Party[]>(purchase ? '/suppliers' : '/clients'), api<Company>('/company')]);
        setProducts(ps); setParties(pt); setTvaDefault(co.tvaDefault);
        if (id) {
          const d = await api<{ number: string; clientId: string | null; supplierId: string | null; date: string; dueDate: string | null; subject: string | null; notes: string | null; lines: { productId: string | null; designation: string; qty: number; unitPrice: number; discount: number; tvaRate: number }[] }>('/document/' + id);
          setNumber(d.number);
          setPartyId((purchase ? d.supplierId : d.clientId) ?? ''); setDate(d.date); setDueDate(d.dueDate ?? ''); setSubject(d.subject ?? ''); setNotes(d.notes ?? '');
          setLines(d.lines.map((l) => ({ key: seq++, productId: l.productId, designation: l.designation, qty: String(l.qty), price: fromCents(l.unitPrice), discount: String(l.discount), tvaRate: l.tvaRate })));
        } else {
          setLines([blank(co.tvaDefault)]);
          if (pt.length === 1) setPartyId(pt[0].id);
        }
      } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
    })();
  }, [id, purchase]);

  const parsed = lines.map((l) => ({ qty: numIn(l.qty), unitPrice: toCents(l.price || '0'), discount: numIn(l.discount || '0'), tvaRate: l.tvaRate }));
  const tot = useMemo(() => totalsOf(parsed.map((p) => ({ qty: p.qty || 0, unitPrice: p.unitPrice || 0, discount: p.discount || 0, tvaRate: p.tvaRate }))), [JSON.stringify(parsed)]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLine = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const save = async () => {
    setErr('');
    if (!partyId) return setErr(`Choisissez un ${cfg.party}`);
    const body = {
      [purchase ? 'supplierId' : 'clientId']: partyId, date, dueDate: dueDate || null, subject: subject || null, notes: notes || null,
      lines: lines.filter((l) => l.designation.trim()).map((l, i) => {
        const p = parsed[lines.indexOf(l)];
        if (!(p.qty > 0)) throw new Error(`Ligne ${i + 1} : quantité invalide`);
        if (!Number.isFinite(p.unitPrice) || p.unitPrice < 0) throw new Error(`Ligne ${i + 1} : prix invalide`);
        return { productId: l.productId, designation: l.designation.trim(), qty: p.qty, unitPrice: p.unitPrice, discount: p.discount || 0, tvaRate: l.tvaRate };
      }),
    };
    if (!body.lines.length) return setErr('Ajoutez au moins une ligne avec une désignation');
    setBusy(true);
    try {
      const d = id ? await patch<{ id: string; number: string }>('/document/' + id, body) : await post<{ id: string; number: string }>(`/documents/${cfg.seg}`, body);
      notify(`${cfg.one} ${d.number} ${id ? 'mis à jour' : 'enregistré'}`);
      nav(`/${kind}/${d.id}`, { replace: true });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const trySave = () => save().catch((e: Error) => setErr(e.message));

  const addParty = async () => {
    if (!quick?.name.trim()) return;
    try {
      const p = await post<Party>(purchase ? '/suppliers' : '/clients', { name: quick.name, city: quick.city, phone: quick.phone, email: quick.email, ice: quick.ice });
      setParties((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name))); setPartyId(p.id); setQuick(null);
      notify(`${purchase ? 'Fournisseur' : 'Client'} « ${p.name} » ajouté`);
    } catch (e) { notify((e as Error).message); }
  };

  if (loading) return <Spinner />;
  return (
    <>
      <PageHead title={id ? `Modifier ${number}` : cfg.newLabel} sub={id ? undefined : cfg.sub}>
        <button className="btn btn-ghost" onClick={() => nav(-1)}>Annuler</button>
        <button className="btn btn-green" onClick={trySave} disabled={busy}><Icon name="check" size={18} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </PageHead>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="doc-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <section className="card">
            <div className="form">
              <label className="fld full">{purchase ? 'Fournisseur' : 'Client'} *
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="inp" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {parties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` (${p.city})` : ''}</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost" onClick={() => setQuick({ name: '', city: '', phone: '', email: '', ice: '' })}><Icon name="plus" size={16} />Nouveau</button>
                </div>
              </label>
              <label className="fld">Date<input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              {(kind === 'factures' || kind === 'devis') && <label className="fld">{kind === 'devis' ? 'Valable jusqu’au' : 'Échéance'}<input className="inp" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder="Automatique" /><span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>Vide = selon les paramètres</span></label>}
              <label className="fld full">Objet<input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. Équipement informatique du bureau" maxLength={200} /></label>
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Lignes</h2><span className="muted" style={{ fontSize: 13 }}>Prix unitaires hors taxes</span></div>
            <div className="tbl">
              <div className="lines">
                <div className="line-row h"><span>Désignation</span><span>Qté</span><span>PU HT (DH)</span><span>Remise %</span><span>TVA</span><span style={{ textAlign: 'right' }}>Total HT</span><span /></div>
                {lines.map((l, i) => {
                  const p = parsed[i];
                  const prod = products.find((x) => x.id === l.productId);
                  const low = !purchase && prod && !prod.isService && p.qty > prod.stock;
                  return (
                    <div key={l.key}>
                      <div className="line-row">
                        <ProductPick value={l.designation} products={products} purchase={purchase}
                          onText={(s) => setLine(l.key, { designation: s, productId: null })}
                          onPick={(x) => setLine(l.key, { productId: x.id, designation: x.name, price: fromCents(purchase ? x.purchasePrice : x.salePrice), tvaRate: x.tvaRate })} />
                        <input className="inp" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Quantité" />
                        <input className="inp" inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} aria-label="Prix unitaire HT" placeholder="0,00" />
                        <input className="inp" inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} aria-label="Remise en %" />
                        <select className="inp" value={l.tvaRate} onChange={(e) => setLine(l.key, { tvaRate: Number(e.target.value) })} aria-label="Taux de TVA">{[20, 14, 10, 7, 0].map((r) => <option key={r} value={r}>{r} %</option>)}</select>
                        <span className="num">{dh(Math.round((p.qty || 0) * (p.unitPrice || 0) * (1 - (p.discount || 0) / 100)))}</span>
                        <button type="button" className="mini del" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank(tvaDefault)]))} aria-label="Supprimer la ligne"><Icon name="trash" size={16} /></button>
                      </div>
                      {low && <div className="warn" style={{ fontSize: 12.5, fontWeight: 600, padding: '2px 4px' }}>Stock disponible : {qtyFmt(prod!.stock)} {prod!.unit}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
            <button type="button" className="link-btn" onClick={() => setLines([...lines, blank(tvaDefault)])}><Icon name="plus" size={16} />Ajouter une ligne</button>
          </section>
          <section className="card">
            <label className="fld">Notes (imprimées sur le document)<textarea className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Conditions particulières, délai de livraison…" /></label>
          </section>
        </div>
        <aside className="card" style={{ position: 'sticky', top: 20 }}>
          <div className="totals">
            <div><span>Total HT</span><b>{dh(tot.ht)}</b></div>
            {tot.rates.map((r) => <div key={r.rate}><span className="muted">TVA {r.rate} % (sur {dh(r.base)})</span><span>{dh(r.tva)}</span></div>)}
            <div className="grand"><span>Total TTC</span><span>{dh(tot.ttc)}</span></div>
          </div>
          <button className="btn btn-green btn-block" style={{ marginTop: 18 }} onClick={trySave} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          {kind === 'factures' && !id && <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Les articles en stock sortent à l'émission de la facture. Pour livrer d'abord, créez un bon de livraison.</p>}
          {kind === 'achats' && <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Le stock augmente quand vous marquez la commande comme « reçue ».</p>}
        </aside>
      </div>

      {quick && (
        <Modal title={purchase ? 'Nouveau fournisseur' : 'Nouveau client'} onClose={() => setQuick(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setQuick(null)}>Annuler</button><button className="btn btn-green" onClick={addParty} disabled={!quick.name.trim()}>Ajouter</button></>}>
          <div className="form">
            <label className="fld full">Nom / raison sociale *<input className="inp" autoFocus value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} /></label>
            <label className="fld">ICE<input className="inp" value={quick.ice} onChange={(e) => setQuick({ ...quick, ice: e.target.value })} /></label>
            <label className="fld">Ville<input className="inp" value={quick.city} onChange={(e) => setQuick({ ...quick, city: e.target.value })} /></label>
            <label className="fld">Téléphone<input className="inp" value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} /></label>
            <label className="fld">Email<input className="inp" type="email" value={quick.email} onChange={(e) => setQuick({ ...quick, email: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </>
  );
}
