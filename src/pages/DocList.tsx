import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { csvMoney, downloadCsv, KIND, presets, type DocKind, type DocRow } from '../lib/docs';
import { dh, fdate, norm, statusOf } from '../lib/format';
import { Icon, PageHead, Pill, Spinner, useData, usePager } from '../lib/ui';

export default function DocList({ kind }: { kind: string }) {
  const cfg = KIND[kind as DocKind];
  const { can } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('f') ?? 'all');
  const [avoirs, setAvoirs] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [party, setParty] = useState('');
  const [q, setQ] = useState('');
  const seg = avoirs ? 'avoirs' : cfg.seg;
  const { data, error, loading } = useData(() => api<DocRow[]>(`/documents/${seg}?` + new URLSearchParams({ ...(from && { from }), ...(to && { to }) })), [seg, from, to]);

  const rows = data ?? [];
  const parties = useMemo(() => [...new Map(rows.filter((r) => r.party).map((r) => [r.party!.id, r.party!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const base = rows.filter((r) => (!party || r.party?.id === party) && (!q || norm(`${r.number} ${r.subject ?? ''} ${r.party?.name ?? ''}`).includes(norm(q))));
  const tabRows = avoirs ? base : base.filter((r) => cfg.tabs.find((t) => t.id === tab)?.match(r.displayStatus) ?? true);
  const { slice, bar } = usePager(tabRows, 12);
  const write = can(cfg.module, 'write');
  const money = kind === 'factures' || kind === 'achats';
  const total = tabRows.reduce((s, r) => s + r.totalTTC, 0);
  const paid = tabRows.reduce((s, r) => s + (r.displayStatus === 'ANNULEE' ? 0 : r.paidAmount), 0);
  const pr = presets();
  const curPreset = pr.find((p) => p.from === from && p.to === to)?.id;

  const exportCsv = () => downloadCsv(`${avoirs ? 'avoirs' : kind}.csv`, [
    ['Numéro', 'Date', cfg.party === 'client' ? 'Client' : 'Fournisseur', 'Objet', 'Total HT', 'TVA', 'Total TTC', 'Payé', 'Statut'],
    ...tabRows.map((r) => [r.number, fdate(r.date), r.party?.name ?? '', r.subject ?? '', csvMoney(r.totalHT), csvMoney(r.totalTVA), csvMoney(r.totalTTC), csvMoney(r.paidAmount), statusOf(r.displayStatus)[0]]),
  ]);

  return (
    <>
      <PageHead title={avoirs ? 'Avoirs' : cfg.title} sub={avoirs ? 'Les avoirs annulent une facture (la numérotation reste continue).' : cfg.sub}>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={!tabRows.length}><Icon name="download" size={18} />Exporter</button>
        {write && !avoirs && <button className="btn btn-green" onClick={() => nav(`/${kind}/nouveau`)}><Icon name="plus" size={18} />{cfg.newLabel}</button>}
      </PageHead>

      <div className="stats">
        <div className="stat"><span className="muted">Total {money ? 'TTC' : ''} ({tabRows.length} document{tabRows.length > 1 ? 's' : ''})</span><b>{dh(total)}</b></div>
        {money && !avoirs && <div className="stat"><span className="muted">{kind === 'achats' ? 'Réglé' : 'Encaissé'}</span><b className="pos">{dh(paid)}</b></div>}
        {money && !avoirs && <div className="stat"><span className="muted">Reste {kind === 'achats' ? 'à régler' : 'à encaisser'}</span><b className="warn">{dh(tabRows.filter((r) => !['ANNULEE', 'ANNULE', 'BROUILLON', 'COMMANDE'].includes(r.displayStatus)).reduce((s, r) => s + r.totalTTC - r.paidAmount, 0))}</b></div>}
      </div>

      <section className="card">
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <div className="tabs" role="tablist">
            {!avoirs && cfg.tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
                {t.label} ({base.filter((r) => t.match(r.displayStatus)).length})
              </button>
            ))}
            {kind === 'factures' && <button className={'tab' + (avoirs ? ' on' : '')} onClick={() => setAvoirs(!avoirs)}>{avoirs ? '← Retour aux factures' : 'Avoirs'}</button>}
          </div>
        </div>
        <div className="filters">
          <div className="fld">Période
            <div className="chips">{pr.map((p) => <button key={p.id} className={'chip' + (curPreset === p.id ? ' on' : '')} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>)}</div>
          </div>
          <label className="fld">Du<input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="fld">Au<input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="fld">{cfg.party === 'client' ? 'Client' : 'Fournisseur'}
            <select className="inp" value={party} onChange={(e) => setParty(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">Tous</option>{parties.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <label className="fld">Recherche<input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N°, objet…" /></label>
        </div>
        {error && <div className="err">{error}</div>}
        {loading && !data ? <Spinner /> : (
          <div className="tbl">
            <div className="tr th" style={{ gridTemplateColumns: '1.1fr 1.6fr 1.6fr 1fr 1fr 1fr 110px' }}>
              <span>#</span><span>{cfg.party === 'client' ? 'Client' : 'Fournisseur'}</span><span>Objet</span><span className="num">Montant TTC</span><span>Statut</span><span>Date</span><span style={{ textAlign: 'right' }}>Actions</span>
            </div>
            {slice.map((r) => (
              <div key={r.id} className="tr clickable" style={{ gridTemplateColumns: '1.1fr 1.6fr 1.6fr 1fr 1fr 1fr 110px' }} onClick={() => nav(`/${kind}/${r.id}`)}>
                <span style={{ fontWeight: 600 }}>{r.number}</span>
                <b>{r.party?.name ?? '—'}</b>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject ?? `${r.lines} ligne${r.lines > 1 ? 's' : ''}`}</span>
                <span className="num">{dh(r.totalTTC)}{r.displayStatus === 'PARTIELLE' && <><br /><span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>reste {dh(r.totalTTC - r.paidAmount)}</span></>}</span>
                <span><Pill status={r.displayStatus} /></span>
                <span>{fdate(r.date)}</span>
                <span className="row-act" onClick={(e) => e.stopPropagation()}>
                  <button className="mini" title="Imprimer / PDF" aria-label={`Imprimer ${r.number}`} onClick={() => window.open('/imprimer/' + r.id, '_blank')}><Icon name="print" size={16} /></button>
                  <button className="mini" title="Ouvrir" aria-label={`Ouvrir ${r.number}`} onClick={() => nav(`/${kind}/${r.id}`)}><Icon name="right" size={16} /></button>
                </span>
              </div>
            ))}
            {!tabRows.length && <div className="empty">Aucun document{rows.length ? ' pour ces filtres' : ''}.{write && !rows.length && !avoirs && <> <button className="link-btn" onClick={() => nav(`/${kind}/nouveau`)}>{cfg.newLabel}</button></>}</div>}
          </div>
        )}
        {bar}
      </section>
    </>
  );
}
