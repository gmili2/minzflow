import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { type Ctx, Perm, TenantCtx } from '../common/decorators';
import { bad, notFound } from '../common/http';
import { num } from '../common/util';
import { PrismaService } from '../prisma.service';
import { ActivityService } from './activity.service';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

class ProductDto {
  @IsOptional() @trim() @IsString() @MaxLength(40) ref?: string;
  @trim() @IsString() @MinLength(1, { message: 'La désignation est obligatoire' }) @MaxLength(200) name: string;
  @IsOptional() @trim() @IsString() @MaxLength(80) category?: string | null;
  @IsOptional() @trim() @IsString() @MaxLength(12) unit?: string;
  @IsOptional() @IsBoolean() isService?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) stock?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) alertThreshold?: number;
  @IsOptional() @IsInt() @Min(0) purchasePrice?: number;
  @IsOptional() @IsInt() @Min(0) salePrice?: number;
  @IsOptional() @IsIn([0, 7, 10, 14, 20]) tvaRate?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class AdjustDto {
  @IsIn(['IN', 'OUT', 'SET']) mode: 'IN' | 'OUT' | 'SET';
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(10_000_000) qty: number;
  @trim() @IsString() @MinLength(2, { message: 'Indiquez le motif' }) @MaxLength(200) reason: string;
}

class ListQuery { @IsOptional() @IsString() @MaxLength(100) q?: string; @IsOptional() @IsString() productId?: string; }

const out = <T extends { stock: unknown; alertThreshold: unknown }>(p: T) => ({ ...p, stock: num(p.stock as never), alertThreshold: num(p.alertThreshold as never) });

@Controller()
export class ProductsController {
  constructor(private prisma: PrismaService, private activity: ActivityService) {}

  /** Catalogue : lisible par tout module qui saisit des lignes (devis, factures, achats…). */
  @Perm('dashboard') @Get('products')
  async list(@TenantCtx() ctx: Ctx, @Query() { q }: ListQuery) {
    const rows = await this.prisma.product.findMany({
      where: { tenantId: ctx.tenantId, ...(q && { OR: [{ name: { contains: q } }, { ref: { contains: q } }, { category: { contains: q } }] }) },
      orderBy: { ref: 'asc' },
    });
    return { data: rows.map(out) };
  }

  @Perm('stocks', 'write') @Post('products')
  async create(@TenantCtx() ctx: Ctx, @Body() dto: ProductDto) {
    const { stock = 0, ...data } = dto;
    const ref = data.ref || (await this.nextRef(ctx.tenantId));
    const p = await this.prisma.$transaction(async (t) => {
      const p = await t.product.create({ data: { ...data, ref, unit: data.unit || 'u', tenantId: ctx.tenantId, stock: data.isService ? 0 : stock } });
      if (stock > 0 && !data.isService) await t.stockMovement.create({ data: { tenantId: ctx.tenantId, productId: p.id, kind: 'IN', qty: stock, reason: 'Stock initial', userId: ctx.userId } });
      return p;
    });
    await this.activity.log(ctx, 'stock', 'Article ajouté au catalogue', `${p.ref} • ${p.name}`);
    return { data: out(p) };
  }

  /** Le stock ne se modifie pas ici : passer par un ajustement (tracé) ou par les documents. */
  @Perm('stocks', 'write') @Patch('products/:id')
  async update(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: ProductDto) {
    const { stock: _s, ...data } = dto;
    if (data.ref === '') throw bad('Référence obligatoire');
    const { count } = await this.prisma.product.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
    if (!count) throw notFound('Article introuvable');
    return { data: out(await this.prisma.product.findUniqueOrThrow({ where: { id } })) };
  }

  @Perm('stocks', 'write') @Delete('products/:id') @HttpCode(204)
  async remove(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    if (await this.prisma.documentLine.count({ where: { productId: id, document: { tenantId: ctx.tenantId } } })) {
      throw bad('Article utilisé dans des documents : désactivez-le plutôt que de le supprimer');
    }
    const { count } = await this.prisma.product.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (!count) throw notFound('Article introuvable');
  }

  /** Entrée, sortie ou inventaire (stock constaté) avec motif : crée un mouvement tracé. */
  @Perm('stocks', 'write') @Post('products/:id/adjust')
  async adjust(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: AdjustDto) {
    const p = await this.prisma.$transaction(async (t) => {
      const p = await t.product.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!p) throw notFound('Article introuvable');
      if (p.isService) throw bad('Une prestation n\'a pas de stock');
      const delta = dto.mode === 'SET' ? dto.qty - num(p.stock) : dto.mode === 'IN' ? dto.qty : -dto.qty;
      if (delta === 0) return p;
      await t.stockMovement.create({ data: { tenantId: ctx.tenantId, productId: p.id, kind: dto.mode === 'SET' ? 'ADJUST' : dto.mode, qty: delta, reason: dto.reason, userId: ctx.userId } });
      return t.product.update({ where: { id: p.id }, data: { stock: { increment: delta } } });
    });
    await this.activity.log(ctx, 'stock', 'Stock ajusté', `${p.ref} • ${dto.reason}`);
    return { data: out(p) };
  }

  @Perm('stocks') @Get('stock/movements')
  async movements(@TenantCtx() ctx: Ctx, @Query() { productId }: ListQuery) {
    const rows = await this.prisma.stockMovement.findMany({
      where: { tenantId: ctx.tenantId, ...(productId && { productId }) },
      orderBy: { date: 'desc' }, take: 300, include: { product: { select: { ref: true, name: true, unit: true } } },
    });
    return { data: rows.map((m) => ({ ...m, qty: num(m.qty) })) };
  }

  private async nextRef(tenantId: string) {
    const refs = await this.prisma.product.findMany({ where: { tenantId, ref: { startsWith: 'P-' } }, select: { ref: true } });
    const max = refs.reduce((m, r) => Math.max(m, parseInt(r.ref.slice(2), 10) || 0), 0);
    return `P-${String(max + 1).padStart(3, '0')}`;
  }
}
