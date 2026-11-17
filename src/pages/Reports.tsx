import { useState } from 'react';
import { Bars } from '../components/Charts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { csvMoney, downloadCsv } from '../lib/docs';
import { dh, dh0, qtyFmt, todayISO } from '../lib/format';
import { Icon, Modal, PageHead, Spinner, useData } from '../lib/ui';

type Row = { month: string; label: string; short: string; caHT: number; caTTC: number; achHT: number; depHT: number; depTTC: number; tvaColl: number; tvaDed: number; result: number; margin: number };
type R = {
  from: string; to: string; periode: string; rows: Row[];
  totals: { caHT: number; caTTC: number; achHT: number; depHT: number; tvaColl: number; tvaDed: number; tvaDue: number; result: number; margin: number };
  topClients: { name: string; ht: number }[]; topProducts: { label: string; qty: number; ht: number }[];
  receivable: number; overdue: number; payable: number;
};

const ym = (d: Date) => d.toISOString().slice(0, 7);
function shift(m: string, n: number) { const [y, mo] = m.split('-').map(Number); return ym(new Date(Date.UTC(y, mo - 1 + n, 1))); }

export default function Reports() {
  const { me } = useAuth();
  const cur = todayISO().slice(0, 7);
  const [from, setFrom] = useState(shift(cur, -5));
  const [to, setTo] = useState(cur);
  const [print, setPrint] = useState(false);
  const { data: r, error, loading } = useData(() => api<R>(`/reports?from=${from}&to=${to}`), [from, to]);
  const quick = [
    ['Ce mois', cur, cur], ['3 mois', shift(cur, -2), cur], ['6 mois', shift(cur, -5), cur], ['12 mois', shift(cur, -11), cur],
    ['Cette année', cur.slice(0, 4) + '-01', cur.slice(0, 4) + '-12'], ['Année dernière', `${Number(cur.slice(0, 4)) - 1}-01`, `${Number(cur.slice(0, 4)) - 1}-12`],
  ] as const;

  const exportCsv = () => r && downloadCsv(`bilan-${r.from}-${r.to}.csv`, [
    ['Mois', 'CA HT', 'CA TTC', 'Achats HT', 'Dépenses HT', 'Résultat', 'Marge %', 'TVA collectée', 'TVA déductible'],
    ...r.rows.map((x) => [x.label, csvMoney(x.caHT), csvMoney(x.caTTC), csvMoney(x.achHT), csvMoney(x.depHT), csvMoney(x.result), x.margin, csvMoney(x.tvaColl), csvMoney(x.tvaDed)]),
    ['Total', csvMoney(r.totals.caHT), csvMoney(r.totals.caTTC), csvMoney(r.totals.achHT), csvMoney(r.totals.depHT), csvMoney(r.totals.result), r.totals.margin, csvMoney(r.totals.tvaColl), csvMoney(r.totals.tvaDed)],
  ]);
  const topMax = r?.topClients[0]?.ht || 1;
  const cols = '1.4fr 1fr 1fr 1fr 1fr .7fr';

  return (
    <>
      <PageHead title="Bilan" sub="Résultat, marge, TVA et performance commerciale sur la période choisie.">
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!r}><Icon name="download" size={18} />Exporter</button>
        <button className="btn btn-green" onClick={() => setPrint(true)} disabled={!r}><Icon name="print" size={18} />Rapport PDF</button>
      </PageHead>
      <section className="card">
        <div className="filters" style={{ borderBottom: 0, marginBottom: 0, paddingBottom: 0 }}>
          <div className="fld">Période<div className="chips">{quick.map(([l, a, b]) => <button key={l} className={'chip' + (from === a && to === b ? ' on' : '')} onClick={() => { setFrom(a); setTo(b); }}>{l}</button>)}</div></div>
          <label className="fld">De<input className="inp" type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label className="fld">À<input className="inp" type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
      </section>
      {error && <div className="err">{error}</div>}
      {loading && !r ? <Spinner /> : r && (
        <>
          <div className="stats">
            <div className="stat"><span className="muted">Chiffre d'affaires HT</span><b>{dh0(r.totals.caHT)}</b><span className="muted" style={{ fontSize: 12.5 }}>{dh0(r.totals.caTTC)} TTC</span></div>
            <div className="stat"><span className="muted">Achats + dépenses HT</span><b>{dh0(r.totals.achHT + r.totals.depHT)}</b><span className="muted" style={{ fontSize: 12.5 }}>achats {dh0(r.totals.achHT)} • dépenses {dh0(r.totals.depHT)}</span></div>
            <div className="stat"><span className="muted">Résultat</span><b className={r.totals.result >= 0 ? 'pos' : 'neg'}>{dh0(r.totals.result)}</b></div>
            <div className="stat"><span className="muted">Marge</span><b>{r.totals.margin} %</b></div>
          </div>
          <div className="grid2">
            <section className="card">
              <div className="card-h"><h2><Icon name="chart" color="var(--brand)" />CA et charges HT par mois</h2><div className="legend"><span><span className="dot" style={{ background: 'var(--brand)' }} />CA HT</span><span><span className="dot" style={{ background: '#2F80ED' }} />Achats + dépenses HT</span></div></div>
              <Bars labels={r.rows.map((x) => x.short)} a={r.rows.map((x) => x.caHT)} b={r.rows.map((x) => x.achHT + x.depHT)} aLabel="CA HT" bLabel="Charges HT" />
            </section>
            <section className="card">
              <div className="card-h"><h2><Icon name="calc" color="var(--brand)" />TVA de la période</h2></div>
              <div className="totals">
                <div><span>TVA collectée (factures)</span><b>{dh(r.totals.tvaColl)}</b></div>
                <div><span>TVA déductible (achats, dépenses)</span><b>{dh(r.totals.tvaDed)}</b></div>
                <div className="grand"><span>{r.totals.tvaDue >= 0 ? 'TVA à payer' : 'Crédit de TVA'}</span><span>{dh(Math.abs(r.totals.tvaDue))}</span></div>
              </div>
              <h3 style={{ fontSize: 15, margin: '20px 0 8px' }}>À ce jour</h3>
              <div className="totals">
                <div><span>Créances clients</span><b className="warn">{dh(r.receivable)}</b></div>
                <div><span>dont en retard</span><b className="neg">{dh(r.overdue)}</b></div>
                <div><span>Dettes fournisseurs</span><b>{dh(r.payable)}</b></div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>Estimation de gestion, à valider avec votre comptable.</p>
            </section>
          </div>
          <section className="card">
            <div className="card-h"><h2>Détail mensuel</h2></div>
            <div className="tbl">
              <div className="tr th" style={{ gridTemplateColumns: cols }}><span>Mois</span><span className="num">CA HT</span><span className="num">Achats HT</span><span className="num">Dépenses HT</span><span className="num">Résultat</span><span className="num">Marge</span></div>
              {[...r.rows].reverse().map((x) => (
                <div key={x.month} className="tr" style={{ gridTemplateColumns: cols }}>
                  <span>{x.label}</span><span className="num">{dh(x.caHT)}</span><span className="num" style={{ fontWeight: 500 }}>{dh(x.achHT)}</span><span className="num" style={{ fontWeight: 500 }}>{dh(x.depHT)}</span>
                  <span className={'num ' + (x.result >= 0 ? 'pos' : 'neg')}>{dh(x.result)}</span><span className="num">{x.margin} %</span>
                </div>
              ))}
            </div>
          </section>
          <div className="grid2b">
            <section className="card">
              <div className="card-h"><h2>Meilleurs clients (HT)</h2></div>
              {r.topClients.length ? r.topClients.map((t) => (
                <div key={t.name} className="bar-row"><span style={{ minWidth: 150 }}>{t.name}</span><span className="bar-track"><span className="bar-fill" style={{ width: Math.round((t.ht / topMax) * 100) + '%' }} /></span><b style={{ minWidth: 110, textAlign: 'right' }}>{dh0(t.ht)}</b></div>
              )) : <div className="empty">Aucune vente sur la période.</div>}
            </section>
            <section className="card">
              <div className="card-h"><h2>Articles les plus vendus</h2></div>
              {r.topProducts.length ? r.topProducts.map((p) => (
                <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}><span>{p.label} <span className="muted">× {qtyFmt(p.qty)}</span></span><b>{dh0(p.ht)}</b></div>
              )) : <div className="empty">Aucune vente sur la période.</div>}
            </section>
          </div>
        </>
      )}
      {print && r && (
        <Modal title="Rapport financier" wide onClose={() => setPrint(false)} footer={<><button className="btn btn-ghost no-print" onClick={() => setPrint(false)}>Fermer</button><button className="btn btn-green no-print" onClick={() => window.print()}><Icon name="print" size={18} />Imprimer / PDF</button></>}>
          <div className="sheet">
            <div className="sheet-band" style={{ background: me?.tenant?.primaryColor }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{me?.tenant?.logoUrl && <img className="sheet-logo" src={me.tenant.logoUrl} alt="" />}<div><b style={{ fontSize: 18 }}>{me?.tenant?.name}</b><div style={{ opacity: 0.85, marginTop: 4 }}>Rapport financier</div></div></div>
              <div style={{ textAlign: 'right' }}><b style={{ fontSize: 16 }}>{r.periode}</b><div style={{ marginTop: 4, opacity: 0.85 }}>Édité le {new Date().toLocaleDateString('fr-FR')}</div></div>
            </div>
            <div className="sheet-body">
              <div className="sheet-kpis">
                <div className="sheet-kpi"><span className="sheet-lbl">CA HT</span><b>{dh0(r.totals.caHT)}</b></div>
                <div className="sheet-kpi"><span className="sheet-lbl">Charges HT</span><b>{dh0(r.totals.achHT + r.totals.depHT)}</b></div>
                <div className="sheet-kpi"><span className="sheet-lbl">Résultat</span><b style={{ color: '#047857' }}>{dh0(r.totals.result)}</b></div>
                <div className="sheet-kpi"><span className="sheet-lbl">Marge</span><b>{r.totals.margin} %</b></div>
              </div>
              <div>
                <div className="sheet-lbl">Détail mensuel</div>
                <div className="sheet-tr4 h"><span>Mois</span><span className="r">CA HT</span><span className="r">Charges HT</span><span className="r">Résultat</span><span className="r">Marge</span></div>
                {[...r.rows].reverse().map((x) => <div key={x.month} className="sheet-tr4"><span>{x.label}</span><span className="r">{dh0(x.caHT)}</span><span className="r">{dh0(x.achHT + x.depHT)}</span><span className="r">{dh0(x.result)}</span><span className="r">{x.margin} %</span></div>)}
              </div>
              <div className="sheet-2">
                <div><div className="sheet-lbl">TVA</div><div>Collectée : {dh(r.totals.tvaColl)}</div><div>Déductible : {dh(r.totals.tvaDed)}</div><b>{r.totals.tvaDue >= 0 ? 'À payer' : 'Crédit'} : {dh(Math.abs(r.totals.tvaDue))}</b></div>
                <div><div className="sheet-lbl">Top clients</div>{r.topClients.slice(0, 5).map((t) => <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t.name}</span><b>{dh0(t.ht)}</b></div>)}</div>
              </div>
              <p style={{ fontSize: 11, color: '#8494A9', margin: 0, textAlign: 'right' }}>Généré avec MizanFlow</p>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
