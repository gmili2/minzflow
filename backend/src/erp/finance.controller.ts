import { Body, Controller, Injectable, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CashType, PayMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { type Ctx, Perm, TenantCtx } from '../common/decorators';
import { bad, notFound } from '../common/http';
import { day, fmtDH, iso, range, today } from '../common/util';
import { PrismaService } from '../prisma.service';
import { ActivityService } from './activity.service';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

class ExpenseDto {
  @IsOptional() @IsString() date?: string;
  @trim() @IsString() @MinLength(1, { message: 'Le libellé est obligatoire' }) @MaxLength(200) label: string;
  @trim() @IsString() @MinLength(1) @MaxLength(60) category: string;
  @IsInt() @Min(1, { message: 'Montant invalide' }) amount: number;
  @IsOptional() @IsInt() @Min(0) tvaAmount?: number;
  @IsOptional() @IsString() supplierId?: string | null;
  @IsOptional() @IsEnum(PayMethod) method?: PayMethod;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
}

class CashDto {
  @IsOptional() @IsString() date?: string;
  @trim() @IsString() @MinLength(1, { message: 'Le libellé est obligatoire' }) @MaxLength(200) label: string;
  @IsEnum(CashType) type: CashType;
  @IsInt() @Min(1, { message: 'Montant invalide' }) amount: number;
  @IsOptional() @IsEnum(PayMethod) method?: PayMethod;
}

class PeriodQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() account?: 'caisse' | 'banque' | 'tout';
}

export type Entry = { date: string; label: string; ref: string; type: 'IN' | 'OUT'; amount: number; method: PayMethod; source: 'paiement' | 'reglement' | 'depense' | 'manuel'; id: string; docId?: string };

/** Écritures de trésorerie (partagées par le journal et l'assistant). */
@Injectable()
export class TreasuryService {
  constructor(private prisma: PrismaService) {}

  /** Toutes les écritures de trésorerie, triées par date croissante. */
  async entries(tenantId: string): Promise<Entry[]> {
    const [payments, expenses, ops] = await Promise.all([
      this.prisma.payment.findMany({ where: { tenantId }, include: { document: { select: { id: true, type: true, number: true, client: { select: { name: true } }, supplier: { select: { name: true } } } } } }),
      this.prisma.expense.findMany({ where: { tenantId }, include: { supplier: { select: { name: true } } } }),
      this.prisma.cashOp.findMany({ where: { tenantId } }),
    ]);
    const out: Entry[] = [
      ...payments.map((p): Entry => {
        const client = p.document.type !== 'BC';
        return {
          id: p.id, docId: p.document.id, date: iso(p.date)!, method: p.method, amount: p.amount, type: client ? 'IN' : 'OUT', source: client ? 'paiement' : 'reglement',
          label: `${client ? 'Encaissement' : 'Règlement'} — ${(p.document.client ?? p.document.supplier)?.name ?? ''}`, ref: p.document.number,
        };
      }),
      ...expenses.map((x): Entry => ({ id: x.id, date: iso(x.date)!, method: x.method, amount: x.amount, type: 'OUT', source: 'depense', label: x.label + (x.supplier ? ` — ${x.supplier.name}` : ''), ref: x.category })),
      ...ops.map((o): Entry => ({ id: o.id, date: iso(o.date)!, method: o.method, amount: o.amount, type: o.type, source: 'manuel', label: o.label, ref: 'Manuel' })),
    ];
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'IN' ? -1 : 1));
  }
}

@Controller()
export class FinanceController {
  constructor(private prisma: PrismaService, private activity: ActivityService, private treasurySvc: TreasuryService) {}

  /* ───────────── Dépenses ───────────── */

  @Perm('depenses') @Get('expenses')
  async expenses(@TenantCtx() ctx: Ctx, @Query() q: PeriodQuery) {
    const rows = await this.prisma.expense.findMany({
      where: {
        tenantId: ctx.tenantId, ...(range(q.from, q.to) && { date: range(q.from, q.to) }), ...(q.category && { category: q.category }),
        ...(q.search && { OR: [{ label: { contains: q.search } }, { supplier: { name: { contains: q.search } } }] }),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: { supplier: { select: { id: true, name: true } } }, take: 3000,
    });
    return { data: rows.map((r) => ({ ...r, date: iso(r.date) })) };
  }

  @Perm('depenses', 'write') @Post('expenses')
  async addExpense(@TenantCtx() ctx: Ctx, @Body() dto: ExpenseDto) {
    await this.checkSupplier(ctx, dto.supplierId);
    if ((dto.tvaAmount ?? 0) >= dto.amount) throw bad('La TVA doit être inférieure au montant TTC');
    const e = await this.prisma.expense.create({ data: { ...dto, supplierId: dto.supplierId || null, date: day(dto.date, today()), tenantId: ctx.tenantId } });
    await this.activity.log(ctx, 'depense', 'Dépense enregistrée', `${e.label} • ${fmtDH(e.amount)}`);
    return { data: e };
  }

  @Perm('depenses', 'write') @Patch('expenses/:id')
  async editExpense(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: ExpenseDto) {
    await this.checkSupplier(ctx, dto.supplierId);
    const { count } = await this.prisma.expense.updateMany({
      where: { id, tenantId: ctx.tenantId }, data: { ...dto, supplierId: dto.supplierId || null, ...(dto.date && { date: day(dto.date) }) },
    });
    if (!count) throw notFound('Dépense introuvable');
    return { data: await this.prisma.expense.findUnique({ where: { id } }) };
  }

  @Perm('depenses', 'write') @Delete('expenses/:id') @HttpCode(204)
  async removeExpense(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    const { count } = await this.prisma.expense.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (!count) throw notFound('Dépense introuvable');
  }

  private async checkSupplier(ctx: Ctx, id?: string | null) {
    if (id && !(await this.prisma.supplier.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } }))) throw bad('Fournisseur introuvable');
  }

  /* ───────────── Trésorerie (journal de caisse et banque) ───────────── */

  @Perm('caisse', 'write') @Post('cash')
  async addCash(@TenantCtx() ctx: Ctx, @Body() dto: CashDto) {
    const op = await this.prisma.cashOp.create({ data: { ...dto, date: day(dto.date, today()), tenantId: ctx.tenantId } });
    await this.activity.log(ctx, 'paiement', dto.type === 'IN' ? 'Entrée de trésorerie' : 'Sortie de trésorerie', `${op.label} • ${fmtDH(op.amount)}`);
    return { data: op };
  }

  @Perm('caisse', 'write') @Delete('cash/:id') @HttpCode(204)
  async removeCash(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    const { count } = await this.prisma.cashOp.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (!count) throw notFound('Opération introuvable');
  }

  /**
   * Journal : encaissements clients, règlements fournisseurs, dépenses et opérations manuelles, avec solde courant.
   * « caisse » = espèces, « banque » = chèque, virement, carte, effet. Le solde d'ouverture (Paramètres) s'applique à la caisse.
   */
  @Perm('caisse') @Get('treasury')
  async treasury(@TenantCtx() ctx: Ctx, @Query() q: PeriodQuery) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { openingCash: true } });
    const all = await this.treasurySvc.entries(ctx.tenantId);
    const account = q.account ?? 'tout';
    const inAccount = (e: Entry) => account === 'tout' || (account === 'caisse' ? e.method === 'ESPECES' : e.method !== 'ESPECES');
    const opening = account === 'banque' ? 0 : tenant.openingCash;
    let bal = opening;
    const rows: (Entry & { balance: number })[] = [];
    let before = opening;
    for (const e of all.filter(inAccount)) {
      bal += e.type === 'IN' ? e.amount : -e.amount;
      if (q.from && e.date < q.from) { before = bal; continue; }
      if (q.to && e.date > q.to) continue;
      rows.push({ ...e, balance: bal });
    }
    const t = iso(today())!;
    const month = t.slice(0, 7);
    const monthRows = all.filter((e) => inAccount(e) && e.date.startsWith(month));
    const sumOf = (list: Entry[], type: 'IN' | 'OUT') => list.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
    const balances = { caisse: tenant.openingCash, banque: 0 };
    for (const e of all) balances[e.method === 'ESPECES' ? 'caisse' : 'banque'] += e.type === 'IN' ? e.amount : -e.amount;
    return {
      data: {
        rows: rows.reverse(), opening: q.from ? before : opening, balance: bal, balances,
        monthIn: sumOf(monthRows, 'IN'), monthOut: sumOf(monthRows, 'OUT'),
        periodIn: sumOf(rows, 'IN'), periodOut: sumOf(rows, 'OUT'),
      },
    };
  }
}
