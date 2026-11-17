import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { can } from '../common/access';
import { type Ctx, Perm, TenantCtx, TenantUser } from '../common/decorators';
import { addDays, fmtDH, iso, num, today } from '../common/util';
import { PrismaService } from '../prisma.service';
import { payStatus } from './documents.service';
import { TreasuryService } from './finance.controller';

const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const MOIS_LONG = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

class DashQuery { @IsOptional() @IsIn(['mois', '6mois', '12mois']) period?: 'mois' | '6mois' | '12mois'; }
class ReportQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) to?: string;
}
class SearchQuery { @IsOptional() @IsString() @MaxLength(100) q?: string; }
class AskDto { @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(500) question: string; }

/** Liste des mois 'AAAA-MM' de from à to inclus. */
function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function shiftMonth(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const monthLabel = (ym: string, long = false) => {
  const [y, m] = ym.split('-').map(Number);
  return long ? `${MOIS_LONG[m - 1]} ${y}` : MOIS[m - 1];
};
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

@Controller()
export class InsightsController {
  constructor(private prisma: PrismaService, private treasury: TreasuryService) {}

  /** Données mensuelles de base : ventes, achats, dépenses (pour le tableau de bord, le bilan et l'assistant). */
  private async monthly(tenantId: string, months: string[]) {
    const start = new Date(months[0] + '-01T00:00:00Z');
    const endExcl = new Date(shiftMonth(months[months.length - 1], 1) + '-01T00:00:00Z');
    const date = { gte: start, lt: endExcl };
    const [invoices, orders, expenses] = await Promise.all([
      this.prisma.document.findMany({ where: { tenantId, type: 'FACTURE', status: { not: 'ANNULEE' }, date }, select: { date: true, totalHT: true, totalTVA: true, totalTTC: true, paidAmount: true, dueDate: true, type: true, status: true, clientId: true } }),
      this.prisma.document.findMany({ where: { tenantId, type: 'BC', status: 'RECU', date }, select: { date: true, totalHT: true, totalTVA: true, totalTTC: true } }),
      this.prisma.expense.findMany({ where: { tenantId, date }, select: { date: true, amount: true, tvaAmount: true, category: true } }),
    ]);
    const blank = () => ({ caHT: 0, caTTC: 0, tvaColl: 0, achHT: 0, achTTC: 0, tvaDed: 0, depTTC: 0, depHT: 0, paid: 0, pending: 0 });
    const rows = new Map(months.map((m) => [m, blank()]));
    for (const f of invoices) {
      const r = rows.get(iso(f.date)!.slice(0, 7)); if (!r) continue;
      r.caHT += f.totalHT; r.caTTC += f.totalTTC; r.tvaColl += f.totalTVA;
      if (payStatus(f) === 'PAYEE') r.paid++; else r.pending++;
    }
    for (const o of orders) {
      const r = rows.get(iso(o.date)!.slice(0, 7)); if (!r) continue;
      r.achHT += o.totalHT; r.achTTC += o.totalTTC; r.tvaDed += o.totalTVA;
    }
    for (const e of expenses) {
      const r = rows.get(iso(e.date)!.slice(0, 7)); if (!r) continue;
      r.depTTC += e.amount; r.depHT += e.amount - e.tvaAmount; r.tvaDed += e.tvaAmount;
    }
    return { rows: months.map((m) => ({ month: m, ...rows.get(m)! })), invoices, orders, expenses };
  }

  @Perm('dashboard') @Get('dashboard')
  async dashboard(@TenantCtx() ctx: Ctx, @Query() { period = 'mois' }: DashQuery) {
    const cur = iso(today())!.slice(0, 7);
    const span = period === '12mois' ? 12 : 6;
    const months = monthsBetween(shiftMonth(cur, -(span - 1)), cur);
    const { rows, expenses, orders } = await this.monthly(ctx.tenantId, months);
    const series = {
      ca: rows.map((r) => r.caTTC), dep: rows.map((r) => r.depTTC + r.achTTC),
      paid: rows.map((r) => r.paid), pend: rows.map((r) => r.pending),
    };
    const total = (a: number[]) => a.reduce((s, x) => s + x, 0);
    const last = (a: number[]) => a[a.length - 1];
    const prev = (a: number[]) => a[a.length - 2];
    const kpi = (key: keyof typeof series) => ({
      value: period === 'mois' ? last(series[key]) : total(series[key]), trend: pct(last(series[key]), prev(series[key])), series: series[key].slice(-6),
    });

    // Répartition des charges (mois en cours ou période) : catégories de dépenses + achats fournisseurs.
    const inPeriod = (d: Date) => (period === 'mois' ? iso(d)!.startsWith(cur) : true);
    const cats = new Map<string, number>();
    for (const e of expenses) if (inPeriod(e.date)) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
    const ach = orders.filter((o) => inPeriod(o.date)).reduce((s, o) => s + o.totalTTC, 0);
    if (ach) cats.set('Achats fournisseurs', (cats.get('Achats fournisseurs') ?? 0) + ach);
    const breakdown = [...cats.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    const [recent, activity] = await Promise.all([
      this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, type: 'FACTURE' }, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 6, include: { client: { select: { name: true } } } }),
      this.prisma.activity.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    return {
      data: {
        months: months.map((m) => ({ key: m, label: monthLabel(m), long: monthLabel(m, true) })),
        series, kpis: { ca: kpi('ca'), dep: kpi('dep'), paid: kpi('paid'), pend: kpi('pend') }, breakdown,
        recent: recent.map((d) => ({ id: d.id, number: d.number, client: d.client?.name, totalTTC: d.totalTTC, date: iso(d.date), displayStatus: payStatus(d) })),
        activity,
      },
    };
  }

  @Perm('rapports') @Get('reports')
  async reports(@TenantCtx() ctx: Ctx, @Query() q: ReportQuery) {
    const cur = iso(today())!.slice(0, 7);
    let from = q.from ?? shiftMonth(cur, -11), to = q.to ?? cur;
    if (from > to) [from, to] = [to, from];
    const months = monthsBetween(from, to);
    const { rows } = await this.monthly(ctx.tenantId, months);
    const start = new Date(months[0] + '-01T00:00:00Z');
    const endExcl = new Date(shiftMonth(months[months.length - 1], 1) + '-01T00:00:00Z');
    const lines = await this.prisma.documentLine.findMany({
      where: { document: { tenantId: ctx.tenantId, type: 'FACTURE', status: { not: 'ANNULEE' }, date: { gte: start, lt: endExcl } } },
      select: { designation: true, productId: true, qty: true, totalHT: true, document: { select: { client: { select: { name: true } } } } },
    });
    const byClient = new Map<string, number>(), byProduct = new Map<string, { label: string; qty: number; ht: number }>();
    for (const l of lines) {
      const c = l.document.client?.name ?? '—';
      byClient.set(c, (byClient.get(c) ?? 0) + l.totalHT);
      const k = l.productId ?? l.designation;
      const p = byProduct.get(k) ?? { label: l.designation, qty: 0, ht: 0 };
      p.qty += num(l.qty); p.ht += l.totalHT; byProduct.set(k, p);
    }
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
    const totals = {
      caHT: sum('caHT'), caTTC: sum('caTTC'), achHT: sum('achHT'), depHT: sum('depHT'), depTTC: sum('depTTC'),
      tvaColl: sum('tvaColl'), tvaDed: sum('tvaDed'),
    };
    const result = totals.caHT - totals.achHT - totals.depHT;
    const open = await this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, type: 'FACTURE', status: { not: 'ANNULEE' } }, select: { totalTTC: true, paidAmount: true, dueDate: true, type: true, status: true } });
    const receivable = open.reduce((s, d) => s + d.totalTTC - d.paidAmount, 0);
    const overdue = open.filter((d) => payStatus(d) === 'EN_RETARD').reduce((s, d) => s + d.totalTTC - d.paidAmount, 0);
    const supplierOpen = await this.prisma.document.aggregate({ where: { tenantId: ctx.tenantId, type: 'BC', status: 'RECU' }, _sum: { totalTTC: true, paidAmount: true } });
    return {
      data: {
        from, to, periode: from === to ? monthLabel(from, true) : `${monthLabel(from, true)} – ${monthLabel(to, true)}`,
        rows: rows.map((r) => {
          const res = r.caHT - r.achHT - r.depHT;
          return { ...r, label: monthLabel(r.month, true), short: monthLabel(r.month), result: res, margin: r.caHT ? Math.round((res / r.caHT) * 100) : 0 };
        }),
        totals: { ...totals, result, margin: totals.caHT ? Math.round((result / totals.caHT) * 100) : 0, tvaDue: totals.tvaColl - totals.tvaDed },
        topClients: [...byClient.entries()].map(([name, ht]) => ({ name, ht })).sort((a, b) => b.ht - a.ht).slice(0, 8),
        topProducts: [...byProduct.values()].sort((a, b) => b.ht - a.ht).slice(0, 8),
        receivable, overdue, payable: (supplierOpen._sum.totalTTC ?? 0) - (supplierOpen._sum.paidAmount ?? 0),
      },
    };
  }

  /** Alertes de la cloche : factures en retard, ruptures, BL à livrer, devis qui expirent. Filtrées selon le rôle. */
  @TenantUser() @Get('notifications')
  async notifications(@TenantCtx() ctx: Ctx) {
    const t = today();
    const out: { kind: string; title: string; sub: string; page: string; id?: string }[] = [];
    const [invoices, products, bls, quotes] = await Promise.all([
      can(ctx.role, 'factures', 'read') ? this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, type: 'FACTURE', status: 'EMISE', dueDate: { lt: t } }, include: { client: { select: { name: true } } }, orderBy: { dueDate: 'asc' } }) : [],
      can(ctx.role, 'stocks', 'read') ? this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, isService: false, active: true } }) : [],
      can(ctx.role, 'bons', 'read') ? this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, type: 'BL', status: 'PREPARE' }, include: { client: { select: { name: true } } } }) : [],
      can(ctx.role, 'devis', 'read') ? this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, type: 'DEVIS', status: 'ENVOYE', dueDate: { lte: addDays(t, 7) } }, include: { client: { select: { name: true } } } }) : [],
    ]);
    for (const d of invoices) if (d.paidAmount < d.totalTTC) out.push({ kind: 'retard', title: `Facture ${d.number} en retard`, sub: `${d.client?.name ?? ''} • ${fmtDH(d.totalTTC - d.paidAmount)} • échue le ${iso(d.dueDate)!.split('-').reverse().join('/')}`, page: 'factures', id: d.id });
    for (const p of products) {
      const s = num(p.stock), a = num(p.alertThreshold);
      if (s <= a) out.push({ kind: 'stock', title: s <= 0 ? `Rupture : ${p.name}` : `Stock bas : ${p.name}`, sub: `Stock ${s} ${p.unit} • seuil ${a}`, page: 'stocks', id: p.id });
    }
    for (const d of bls) out.push({ kind: 'bl', title: `Bon ${d.number} à livrer`, sub: d.client?.name ?? '', page: 'bons', id: d.id });
    for (const d of quotes) out.push({ kind: 'devis', title: `Devis ${d.number} ${d.dueDate! < t ? 'expiré' : 'expire bientôt'}`, sub: `${d.client?.name ?? ''} • ${fmtDH(d.totalTTC)}`, page: 'devis', id: d.id });
    return { data: out };
  }

  @TenantUser() @Get('search')
  async search(@TenantCtx() ctx: Ctx, @Query() { q }: SearchQuery) {
    const s = q?.trim();
    if (!s || s.length < 2) return { data: [] };
    const tid = ctx.tenantId;
    const [clients, suppliers, products, docs] = await Promise.all([
      can(ctx.role, 'clients', 'read') ? this.prisma.client.findMany({ where: { tenantId: tid, OR: [{ name: { contains: s } }, { email: { contains: s } }, { phone: { contains: s } }] }, take: 5 }) : [],
      can(ctx.role, 'fournisseurs', 'read') ? this.prisma.supplier.findMany({ where: { tenantId: tid, name: { contains: s } }, take: 4 }) : [],
      can(ctx.role, 'stocks', 'read') ? this.prisma.product.findMany({ where: { tenantId: tid, OR: [{ name: { contains: s } }, { ref: { contains: s } }] }, take: 4 }) : [],
      this.prisma.document.findMany({
        where: { tenantId: tid, OR: [{ number: { contains: s } }, { subject: { contains: s } }, { client: { name: { contains: s } } }] },
        include: { client: { select: { name: true } }, supplier: { select: { name: true } } }, orderBy: { date: 'desc' }, take: 8,
      }),
    ]);
    const MOD = { DEVIS: 'devis', BL: 'bons', FACTURE: 'factures', AVOIR: 'factures', BC: 'achats' } as const;
    return {
      data: [
        ...clients.map((c) => ({ kind: 'client', id: c.id, title: c.name, sub: [c.city, c.phone].filter(Boolean).join(' • '), page: 'clients' })),
        ...suppliers.map((c) => ({ kind: 'fournisseur', id: c.id, title: c.name, sub: c.category ?? 'Fournisseur', page: 'fournisseurs' })),
        ...products.map((p) => ({ kind: 'produit', id: p.id, title: p.name, sub: `${p.ref} • stock ${num(p.stock)}`, page: 'stocks' })),
        ...docs.filter((d) => can(ctx.role, MOD[d.type], 'read')).map((d) => ({ kind: d.type, id: d.id, title: d.number, sub: `${(d.client ?? d.supplier)?.name ?? ''} • ${fmtDH(d.totalTTC)}`, page: MOD[d.type] })),
      ],
    };
  }

  @TenantUser() @Get('activity')
  async activity(@TenantCtx() ctx: Ctx) {
    return { data: await this.prisma.activity.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  }

  /** Assistant : réponses calculées sur les données réelles de l'entreprise (aucun service externe). */
  @Perm('assistant') @Post('assistant')
  async ask(@TenantCtx() ctx: Ctx, @Body() { question }: AskDto) {
    return { data: { answer: await this.answer(ctx, question) } };
  }

  private async answer(ctx: Ctx, question: string): Promise<string> {
    const q = norm(question);
    const has = (...w: string[]) => w.some((x) => q.includes(x));
    const tid = ctx.tenantId;
    const cur = iso(today())!.slice(0, 7);
    const months = monthsBetween(shiftMonth(cur, -5), cur);
    const deny = 'Cette information n\'est pas accessible avec votre rôle.';

    if (has('impay', 'retard', 'attente', 'relanc', 'doit', 'creance')) {
      if (!can(ctx.role, 'factures', 'read')) return deny;
      const docs = await this.prisma.document.findMany({ where: { tenantId: tid, type: 'FACTURE', status: 'EMISE' }, include: { client: { select: { name: true } } }, orderBy: { dueDate: 'asc' } });
      const unpaid = docs.filter((d) => d.paidAmount < d.totalTTC);
      if (!unpaid.length) return 'Bonne nouvelle : aucune facture impayée.';
      const tot = unpaid.reduce((s, d) => s + d.totalTTC - d.paidAmount, 0);
      return `${unpaid.length} facture(s) impayée(s) pour un reste à encaisser de ${fmtDH(tot)} :\n` +
        unpaid.slice(0, 12).map((d) => `• ${d.number} — ${d.client?.name} — ${fmtDH(d.totalTTC - d.paidAmount)}${payStatus(d) === 'EN_RETARD' ? ' (en retard)' : ''}`).join('\n') +
        '\nConseil : relancez les factures en retard depuis la page Factures.';
    }
    if (has('meilleur', 'top client', 'clients', 'client')) {
      if (!can(ctx.role, 'factures', 'read')) return deny;
      const agg = await this.prisma.document.groupBy({ by: ['clientId'], where: { tenantId: tid, type: 'FACTURE', status: { not: 'ANNULEE' } }, _sum: { totalTTC: true }, orderBy: { _sum: { totalTTC: 'desc' } }, take: 5 });
      if (!agg.length) return 'Aucune facture pour le moment : créez votre première facture pour voir vos meilleurs clients.';
      const names = new Map((await this.prisma.client.findMany({ where: { id: { in: agg.map((a) => a.clientId!).filter(Boolean) } } })).map((c) => [c.id, c.name]));
      return 'Vos meilleurs clients (CA TTC facturé) :\n' + agg.map((a, i) => `${i + 1}. ${names.get(a.clientId!) ?? '—'} — ${fmtDH(a._sum.totalTTC ?? 0)}`).join('\n');
    }
    if (has('stock', 'rupture', 'produit', 'reappro', 'article')) {
      if (!can(ctx.role, 'stocks', 'read')) return deny;
      const ps = await this.prisma.product.findMany({ where: { tenantId: tid, isService: false, active: true } });
      const al = ps.filter((p) => num(p.stock) <= num(p.alertThreshold));
      const value = ps.reduce((s, p) => s + Math.max(0, num(p.stock)) * p.purchasePrice, 0);
      if (!al.length) return `Tous les articles sont au-dessus de leur seuil d'alerte. Valeur du stock (prix d'achat) : ${fmtDH(value)}.`;
      return `${al.length} article(s) à réapprovisionner :\n` + al.map((p) => `• ${p.name} — stock ${num(p.stock)} ${p.unit} (seuil ${num(p.alertThreshold)})${num(p.stock) <= 0 ? ' — RUPTURE' : ''}`).join('\n') + `\nValeur du stock : ${fmtDH(value)}.`;
    }
    if (has('tresor', 'caisse', 'solde', 'cash', 'banque')) {
      if (!can(ctx.role, 'caisse', 'read')) return deny;
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tid }, select: { openingCash: true } });
      const entries = await this.treasury.entries(tid);
      const b = { caisse: tenant.openingCash, banque: 0 };
      let mIn = 0, mOut = 0;
      for (const e of entries) {
        b[e.method === 'ESPECES' ? 'caisse' : 'banque'] += e.type === 'IN' ? e.amount : -e.amount;
        if (e.date.startsWith(cur)) { if (e.type === 'IN') mIn += e.amount; else mOut += e.amount; }
      }
      return `Trésorerie totale : ${fmtDH(b.caisse + b.banque)} (caisse ${fmtDH(b.caisse)}, banque ${fmtDH(b.banque)}).\nCe mois-ci : ${fmtDH(mIn)} d'entrées et ${fmtDH(mOut)} de sorties.`;
    }
    if (has('devis')) {
      if (!can(ctx.role, 'devis', 'read')) return deny;
      const open = await this.prisma.document.findMany({ where: { tenantId: tid, type: 'DEVIS', status: { in: ['BROUILLON', 'ENVOYE', 'ACCEPTE'] } }, include: { client: { select: { name: true } } } });
      if (!open.length) return 'Aucun devis en cours.';
      const label: Record<string, string> = { BROUILLON: 'brouillon', ENVOYE: 'envoyé', ACCEPTE: 'accepté' };
      return `${open.length} devis en cours pour ${fmtDH(open.reduce((s, d) => s + d.totalTTC, 0))} :\n` + open.slice(0, 12).map((d) => `• ${d.number} — ${d.client?.name} — ${fmtDH(d.totalTTC)} (${label[d.status]})`).join('\n');
    }
    if (has('tva', 'taxe')) {
      if (!can(ctx.role, 'rapports', 'read')) return deny;
      const { rows } = await this.monthly(tid, [cur]);
      const r = rows[0];
      return `TVA de ${monthLabel(cur, true)} : collectée ${fmtDH(r.tvaColl)}, déductible ${fmtDH(r.tvaDed)}, soit ${r.tvaColl - r.tvaDed >= 0 ? 'à payer' : 'crédit de TVA'} : ${fmtDH(Math.abs(r.tvaColl - r.tvaDed))}.`;
    }
    const finance = can(ctx.role, 'rapports', 'read');
    if (has('depens', 'charge', 'cout', 'achat')) {
      if (!finance) return deny;
      const { rows } = await this.monthly(tid, months);
      const c = rows[rows.length - 1], p = rows[rows.length - 2];
      const t = c.depTTC + c.achTTC, pt = p.depTTC + p.achTTC;
      const ev = pct(t, pt);
      return `Charges de ${monthLabel(cur, true)} : ${fmtDH(t)}${ev === null ? '' : ` (${ev >= 0 ? '+' : ''}${ev}% vs mois précédent)`}.\nDépenses : ${fmtDH(c.depTTC)} • Achats fournisseurs reçus : ${fmtDH(c.achTTC)}.`;
    }
    if (has('benef', 'marge', 'resultat', 'profit', 'gagn')) {
      if (!finance) return deny;
      const { rows } = await this.monthly(tid, [cur]);
      const r = rows[0], res = r.caHT - r.achHT - r.depHT;
      return `Résultat estimé de ${monthLabel(cur, true)} : ${fmtDH(res)} (marge ${r.caHT ? Math.round((res / r.caHT) * 100) : 0}%).\nCA HT ${fmtDH(r.caHT)} − achats HT ${fmtDH(r.achHT)} − dépenses HT ${fmtDH(r.depHT)}.`;
    }
    if (has('chiffre', ' ca', 'ca ', 'vente', 'revenu', 'factur')) {
      if (!can(ctx.role, 'factures', 'read')) return deny;
      const { rows } = await this.monthly(tid, months);
      const c = rows[rows.length - 1], p = rows[rows.length - 2];
      const ev = pct(c.caTTC, p.caTTC);
      return `Chiffre d'affaires de ${monthLabel(cur, true)} : ${fmtDH(c.caTTC)} TTC (${fmtDH(c.caHT)} HT)${ev === null ? '' : `, soit ${ev >= 0 ? '+' : ''}${ev}% par rapport au mois précédent (${fmtDH(p.caTTC)})`}.\nSur 6 mois : ${fmtDH(rows.reduce((s, r) => s + r.caTTC, 0))}.`;
    }
    return 'Je peux répondre sur : chiffre d\'affaires, factures impayées, meilleurs clients, stock, trésorerie, dépenses, TVA, devis et bénéfice. Essayez une des suggestions ci-dessous.';
  }
}
