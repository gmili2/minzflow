import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Donut, LineChart, Spark } from '../components/Charts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, dh0, fdate } from '../lib/format';
import { Icon, Pill, Spinner, useData } from '../lib/ui';

type Kpi = { value: number; trend: number | null; series: number[] };
type Dash = {
  months: { key: string; label: string; long: string }[];
  series: { ca: number[]; dep: number[] };
  kpis: Record<'ca' | 'dep' | 'paid' | 'pend', Kpi>;
  breakdown: { label: string; value: number }[];
  recent: { id: string; number: string; client: string; totalTTC: number; date: string; displayStatus: string }[];
  activity: { id: string; kind: string; title: string; sub: string | null; createdAt: string }[];
};

const ACT: Record<string, [string, string, string]> = {
  facture: ['facture', '#DBEAFE', '#1E40AF'], paiement: ['check', '#DCFCE7', '#166534'], client: ['users', '#EDE9FE', '#5B21B6'],
  devis: ['devis', '#FFEDD5', '#9A3412'], depense: ['wallet', '#FEE2E2', '#991B1B'], stock: ['box', '#E0F2FE', '#075985'],
  achat: ['bag', '#FEF3C7', '#92400E'], user: ['shield', '#EDE9FE', '#5B21B6'], settings: ['settings', '#EEF2F6', '#334155'],
};

export default function Dashboard() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const [period, setPeriod] = useState<'mois' | '6mois' | '12mois'>('mois');
  const [allAct, setAllAct] = useState(false);
  const { data, error, loading } = useData(() => api<Dash>('/dashboard?period=' + period), [period]);

  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';
  const kdefs = [
    { k: 'ca' as const, label: 'Chiffre d’affaires', money: true, icon: 'chart', color: 'var(--brand)', soft: 'var(--brand-soft)', dark: 'var(--brand-dark)', to: '/factures', mod: 'factures' },
    { k: 'dep' as const, label: 'Dépenses et achats', money: true, icon: 'wallet', color: '#2F80ED', soft: '#DBEAFE', dark: '#1E40AF', to: '/depenses', mod: 'depenses' },
    { k: 'paid' as const, label: 'Factures payées', money: false, icon: 'facture', color: '#8B5CF6', soft: '#EDE9FE', dark: '#5B21B6', to: '/factures?f=PAYEE', mod: 'factures' },
    { k: 'pend' as const, label: 'En attente', money: false, icon: 'hourglass', color: '#F59E0B', soft: '#FFEDD5', dark: '#9A3412', to: '/factures?f=IMPAYEES', mod: 'factures' },
  ];

  return (
    <>
      <div className="head">
        <div><h1>{hello} {me?.name.split(' ')[0]}</h1><p>Voici un aperçu de l'activité de {me?.tenant?.name}{period === 'mois' ? ' ce mois-ci' : ''}.</p></div>
        <label className="fld">Période
          <select className="inp" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} style={{ minWidth: 190 }}>
            <option value="mois">Ce mois-ci</option><option value="6mois">6 derniers mois</option><option value="12mois">12 derniers mois</option>
          </select>
        </label>
      </div>
      {error && <div className="err">{error}</div>}
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="kpis">
            {kdefs.map((d) => {
              const k = data.kpis[d.k];
              const up = (k.trend ?? 0) > 0, down = (k.trend ?? 0) < 0;
              return (
                <button key={d.k} className="card kpi" onClick={() => can(d.mod) && nav(d.to)} style={{ cursor: can(d.mod) ? 'pointer' : 'default' }}>
                  <span className="kpi-ic" style={{ background: d.color }}><Icon name={d.icon} size={26} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="kpi-label">{d.label}</span>
                    <span className="kpi-val">{d.money ? dh0(k.value) : k.value}</span>
                    {k.trend === null ? <span className="trend" style={{ background: 'var(--soft)', color: 'var(--muted)' }}>{k.series[k.series.length - 1] ? 'nouveau' : '—'}</span> : (
                      <span className="trend" style={{ background: d.soft, color: d.dark }}><Icon name={up ? 'up' : down ? 'down' : 'flat'} size={13} stroke={2.6} />{k.trend > 0 ? '+' : ''}{k.trend}%</span>
                    )}
                  </span>
                  <Spark series={k.series} color={d.color} />
                </button>
              );
            })}
          </div>

          <div className="grid2">
            <section className="card">
              <div className="card-h">
                <h2><Icon name="chart" color="var(--brand)" />Évolution de votre activité</h2>
                <div className="legend"><span><span className="dot" style={{ background: 'var(--brand)' }} />Chiffre d'affaires</span><span><span className="dot" style={{ background: '#2F80ED' }} />Dépenses et achats</span></div>
              </div>
              <LineChart labels={data.months.map((m) => m.label)} longLabels={data.months.map((m) => m.long)} a={data.series.ca} b={data.series.dep} aLabel="CA" bLabel="Dépenses" />
            </section>
            <section className="card">
              <div className="card-h"><h2><Icon name="pie" color="var(--brand)" />Répartition des charges</h2></div>
              <Donut items={data.breakdown} total={data.breakdown.reduce((s, b) => s + b.value, 0)} />
            </section>
          </div>

          <div className="grid2">
            <section className="card">
              <div className="card-h">
                <h2><Icon name="facture" color="var(--brand)" />Factures récentes</h2>
                {can('factures') && <button className="link-btn" onClick={() => nav('/factures')}>Voir toutes les factures <Icon name="right" size={16} /></button>}
              </div>
              <div className="tbl">
                <div className="tr th cols-dash"><span>#</span><span>Client</span><span className="num">Montant</span><span>Statut</span><span>Date</span><span /></div>
                {data.recent.length ? data.recent.map((f) => (
                  <div key={f.id} className="tr cols-dash clickable" onClick={() => can('factures') && nav('/factures/' + f.id)}>
                    <span>{f.number}</span><span>{f.client}</span><span className="num">{dh0(f.totalTTC)}</span><span><Pill status={f.displayStatus} /></span><span>{fdate(f.date)}</span>
                    <span className="row-act"><Icon name="right" size={16} /></span>
                  </div>
                )) : <div className="empty">Aucune facture pour l'instant.{can('factures', 'write') && <> <button className="link-btn" onClick={() => nav('/factures/nouveau')}>Créer la première</button></>}</div>}
              </div>
            </section>
            <section className="card">
              <div className="card-h">
                <h2><Icon name="zap" color="var(--brand)" />Activité récente</h2>
                {data.activity.length > 6 && <button className="link-btn" onClick={() => setAllAct(!allAct)}>{allAct ? 'Réduire' : 'Voir tout'} <Icon name={allAct ? 'up' : 'right'} size={16} /></button>}
              </div>
              {data.activity.length ? data.activity.slice(0, allAct ? 30 : 6).map((a) => {
                const [ic, bg, fg] = ACT[a.kind] ?? ACT.settings;
                return (
                  <div key={a.id} className="act">
                    <span className="act-ic" style={{ background: bg, color: fg }}><Icon name={ic} /></span>
                    <span><b style={{ fontSize: 14.5 }}>{a.title}</b><br /><span className="muted" style={{ fontSize: 13 }}>{[a.sub, ago(a.createdAt)].filter(Boolean).join(' • ')}</span></span>
                  </div>
                );
              }) : <div className="empty">Aucune activité.</div>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
