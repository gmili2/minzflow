import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { type Ctx, Perm, TenantCtx } from '../common/decorators';
import { bad, notFound } from '../common/http';
import { iso } from '../common/util';
import { PrismaService } from '../prisma.service';
import { ActivityService } from './activity.service';
import { payStatus } from './documents.service';

const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' ? (value.trim() || null) : value));

class PartyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1, { message: 'Le nom est obligatoire' }) @MaxLength(160) name: string;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(80) category?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(30) ice?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(120) contact?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(80) city?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(255) address?: string | null;
  @IsOptional() @emptyToNull() @ValidateIf((_, v) => v != null) @IsEmail({}, { message: 'Email invalide' }) email?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @emptyToNull() @IsString() @MaxLength(4000) notes?: string | null;
}

class SearchQuery { @IsOptional() @IsString() @MaxLength(100) q?: string; }

@Controller('clients')
export class ClientsController {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  @Perm('clients') @Get()
  async list(@TenantCtx() ctx: Ctx, @Query() { q }: SearchQuery) {
    const clients = await this.prisma.client.findMany({
      where: { tenantId: ctx.tenantId, ...(q && { OR: [{ name: { contains: q } }, { city: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] }) },
      orderBy: { name: 'asc' },
    });
    // Chiffre d'affaires et reste dû par client (factures non annulées).
    const agg = await this.prisma.document.groupBy({
      by: ['clientId'], where: { tenantId: ctx.tenantId, type: 'FACTURE', status: { not: 'ANNULEE' } }, _sum: { totalTTC: true, paidAmount: true }, _count: true,
    });
    const m = new Map(agg.map((a) => [a.clientId, a]));
    return {
      data: clients.map((c) => {
        const a = m.get(c.id);
        return { ...c, invoiced: a?._sum.totalTTC ?? 0, due: (a?._sum.totalTTC ?? 0) - (a?._sum.paidAmount ?? 0), invoices: a?._count ?? 0 };
      }),
    };
  }

  /** Fiche client : coordonnées, documents et relevé. */
  @Perm('clients') @Get(':id')
  async get(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw notFound('Client introuvable');
    const docs = await this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, clientId: id }, orderBy: [{ date: 'desc' }, { number: 'desc' }] });
    const invoices = docs.filter((d) => d.type === 'FACTURE' && d.status !== 'ANNULEE');
    return {
      data: {
        ...c,
        invoiced: invoices.reduce((s, d) => s + d.totalTTC, 0),
        paid: invoices.reduce((s, d) => s + d.paidAmount, 0),
        documents: docs.map((d) => ({ id: d.id, type: d.type, number: d.number, date: iso(d.date), dueDate: iso(d.dueDate), totalTTC: d.totalTTC, paidAmount: d.paidAmount, status: d.status, displayStatus: payStatus(d), subject: d.subject })),
      },
    };
  }

  @Perm('clients', 'write') @Post()
  async create(@TenantCtx() ctx: Ctx, @Body() dto: PartyDto) {
    const { category: _c, ...data } = dto;
    const c = await this.prisma.client.create({ data: { ...data, tenantId: ctx.tenantId } });
    await this.activity.log(ctx, 'client', 'Nouveau client ajouté', c.name);
    return { data: c };
  }

  @Perm('clients', 'write') @Patch(':id')
  async update(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: PartyDto) {
    const { category: _c, ...data } = dto;
    const { count } = await this.prisma.client.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
    if (!count) throw notFound('Client introuvable');
    return { data: await this.prisma.client.findUnique({ where: { id } }) };
  }

  @Perm('clients', 'write') @Delete(':id') @HttpCode(204)
  async remove(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    if (await this.prisma.document.count({ where: { tenantId: ctx.tenantId, clientId: id } })) throw bad('Ce client a des documents : il ne peut pas être supprimé');
    const { count } = await this.prisma.client.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (!count) throw notFound('Client introuvable');
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  @Perm('fournisseurs') @Get()
  async list(@TenantCtx() ctx: Ctx, @Query() { q }: SearchQuery) {
    const rows = await this.prisma.supplier.findMany({
      where: { tenantId: ctx.tenantId, ...(q && { OR: [{ name: { contains: q } }, { category: { contains: q } }, { email: { contains: q } }] }) },
      orderBy: { name: 'asc' },
    });
    const agg = await this.prisma.document.groupBy({ by: ['supplierId'], where: { tenantId: ctx.tenantId, type: 'BC', status: { not: 'ANNULE' } }, _sum: { totalTTC: true, paidAmount: true }, _count: true });
    const exp = await this.prisma.expense.groupBy({ by: ['supplierId'], where: { tenantId: ctx.tenantId }, _sum: { amount: true } });
    const m = new Map(agg.map((a) => [a.supplierId, a]));
    const e = new Map(exp.map((a) => [a.supplierId, a._sum.amount ?? 0]));
    return {
      data: rows.map((s) => {
        const a = m.get(s.id);
        return { ...s, purchased: (a?._sum.totalTTC ?? 0) + (e.get(s.id) ?? 0), due: (a?._sum.totalTTC ?? 0) - (a?._sum.paidAmount ?? 0), orders: a?._count ?? 0 };
      }),
    };
  }

  @Perm('fournisseurs') @Get(':id')
  async get(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    const s = await this.prisma.supplier.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!s) throw notFound('Fournisseur introuvable');
    const [docs, expenses] = await Promise.all([
      this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, supplierId: id }, orderBy: { date: 'desc' } }),
      this.prisma.expense.findMany({ where: { tenantId: ctx.tenantId, supplierId: id }, orderBy: { date: 'desc' } }),
    ]);
    return {
      data: {
        ...s,
        documents: docs.map((d) => ({ id: d.id, type: d.type, number: d.number, date: iso(d.date), totalTTC: d.totalTTC, paidAmount: d.paidAmount, status: d.status, displayStatus: payStatus(d), subject: d.subject })),
        expenses: expenses.map((x) => ({ ...x, date: iso(x.date) })),
      },
    };
  }

  @Perm('fournisseurs', 'write') @Post()
  async create(@TenantCtx() ctx: Ctx, @Body() dto: PartyDto) {
    const s = await this.prisma.supplier.create({ data: { ...dto, tenantId: ctx.tenantId } });
    await this.activity.log(ctx, 'client', 'Nouveau fournisseur ajouté', s.name);
    return { data: s };
  }

  @Perm('fournisseurs', 'write') @Patch(':id')
  async update(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: PartyDto) {
    const { count } = await this.prisma.supplier.updateMany({ where: { id, tenantId: ctx.tenantId }, data: dto });
    if (!count) throw notFound('Fournisseur introuvable');
    return { data: await this.prisma.supplier.findUnique({ where: { id } }) };
  }

  @Perm('fournisseurs', 'write') @Delete(':id') @HttpCode(204)
  async remove(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    if (await this.prisma.document.count({ where: { tenantId: ctx.tenantId, supplierId: id } })) throw bad('Ce fournisseur a des commandes : il ne peut pas être supprimé');
    const { count } = await this.prisma.supplier.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (!count) throw notFound('Fournisseur introuvable');
  }
}
