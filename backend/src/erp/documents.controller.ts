import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { DocType, PayMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { can, type Module } from '../common/access';
import { type Ctx, TenantCtx, TenantUser } from '../common/decorators';
import { notFound } from '../common/http';
import { fmtDH } from '../common/util';
import { ActivityService } from './activity.service';
import { DOC_LABEL, DocumentsService } from './documents.service';

/** Segment d'URL → type de document. */
const TYPES: Record<string, DocType> = { devis: 'DEVIS', bl: 'BL', factures: 'FACTURE', avoirs: 'AVOIR', achats: 'BC' };
const MODULE_OF: Record<DocType, Module> = { DEVIS: 'devis', BL: 'bons', FACTURE: 'factures', AVOIR: 'factures', BC: 'achats' };

class LineDto {
  @IsOptional() @IsString() productId?: string | null;
  @IsString() @MaxLength(255) designation: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1_000_000) qty: number;
  @IsInt() @Min(0) @Max(100_000_000_00) unitPrice: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discount?: number;
  @IsIn([0, 7, 10, 14, 20]) tvaRate: number;
}

class DocDto {
  @IsOptional() @IsString() clientId?: string | null;
  @IsOptional() @IsString() supplierId?: string | null;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsArray() @ArrayMinSize(1, { message: 'Ajoutez au moins une ligne' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[];
}

class StatusDto { @IsString() @MaxLength(20) status: string; }
class ConvertDto { @IsIn(['BL', 'FACTURE']) target: 'BL' | 'FACTURE'; }
class PaymentDto {
  @IsOptional() @IsString() date?: string;
  @IsInt() @Min(1) amount: number;
  @IsEnum(PayMethod) method: PayMethod;
  @IsOptional() @IsString() @MaxLength(80) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class ListQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() partyId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() status?: string;
}

const STATUS_LABEL: Record<string, string> = {
  ENVOYE: 'envoyé', ACCEPTE: 'accepté', REFUSE: 'refusé', BROUILLON: 'repassé en brouillon', LIVRE: 'livré', PREPARE: 'repassé en préparation',
  ANNULE: 'annulé', COMMANDE: 'commandé', RECU: 'réceptionné',
};

@TenantUser()
@Controller()
export class DocumentsController {
  constructor(private docs: DocumentsService, private activity: ActivityService) {}

  private type(seg: string) {
    const t = TYPES[seg];
    if (!t) throw notFound('Type de document inconnu');
    return t;
  }

  private check(ctx: Ctx, type: DocType, mode: 'read' | 'write') {
    if (!can(ctx.role, MODULE_OF[type], mode)) throw new ForbiddenException(mode === 'write' ? 'Action non autorisée pour votre rôle' : 'Module non accessible avec votre rôle');
  }

  /** Vérifie le droit sur le type réel du document désigné par son identifiant. */
  private async checkDoc(ctx: Ctx, id: string, mode: 'read' | 'write') {
    const d = await this.docs.get(ctx, id);
    this.check(ctx, d.type, mode);
    return d;
  }

  @Get('documents/:seg')
  async list(@TenantCtx() ctx: Ctx, @Param('seg') seg: string, @Query() q: ListQuery) {
    const type = this.type(seg);
    this.check(ctx, type, 'read');
    return { data: await this.docs.list(ctx, type, q) };
  }

  @Post('documents/:seg')
  async create(@TenantCtx() ctx: Ctx, @Param('seg') seg: string, @Body() dto: DocDto) {
    const type = this.type(seg);
    if (type === 'AVOIR') throw notFound('Un avoir se crée en annulant une facture');
    this.check(ctx, type, 'write');
    const r = await this.docs.create(ctx, type, dto);
    const d = await this.docs.get(ctx, r.id);
    await this.activity.log(ctx, type === 'BC' ? 'achat' : type === 'DEVIS' ? 'devis' : 'facture', `${DOC_LABEL[type]} créé${type === 'FACTURE' ? 'e' : ''}`, `${r.number} • ${(d.client ?? d.supplier)?.name ?? ''} • ${fmtDH(d.totalTTC)}`);
    return { data: d };
  }

  @Get('document/:id')
  async get(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    return { data: await this.checkDoc(ctx, id, 'read') };
  }

  @Patch('document/:id')
  async update(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: DocDto) {
    await this.checkDoc(ctx, id, 'write');
    const r = await this.docs.update(ctx, id, dto);
    await this.activity.log(ctx, 'facture', 'Document modifié', r.number);
    return { data: await this.docs.get(ctx, id) };
  }

  @Post('document/:id/status')
  async status(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: StatusDto) {
    const d = await this.checkDoc(ctx, id, 'write');
    const r = await this.docs.setStatus(ctx, id, dto.status);
    await this.activity.log(ctx, d.type === 'BC' ? 'achat' : d.type === 'DEVIS' ? 'devis' : 'facture', `${DOC_LABEL[d.type]} ${STATUS_LABEL[r.status] ?? r.status.toLowerCase()}`, r.number);
    return { data: await this.docs.get(ctx, id) };
  }

  @Post('document/:id/convert')
  async convert(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: ConvertDto) {
    const d = await this.checkDoc(ctx, id, 'read');
    this.check(ctx, d.type, 'write');
    this.check(ctx, dto.target, 'write');
    const r = await this.docs.convert(ctx, id, dto.target);
    await this.activity.log(ctx, 'facture', `${DOC_LABEL[d.type]} converti en ${DOC_LABEL[dto.target].toLowerCase()}`, `${d.number} → ${r.number}`);
    return { data: await this.docs.get(ctx, r.id) };
  }

  @Post('document/:id/cancel')
  async cancel(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    await this.checkDoc(ctx, id, 'write');
    const r = await this.docs.cancelInvoice(ctx, id);
    await this.activity.log(ctx, 'facture', 'Facture annulée par avoir', r.number);
    return { data: await this.docs.get(ctx, r.id) };
  }

  @Delete('document/:id') @HttpCode(204)
  async remove(@TenantCtx() ctx: Ctx, @Param('id') id: string) {
    await this.checkDoc(ctx, id, 'write');
    const r = await this.docs.remove(ctx, id);
    await this.activity.log(ctx, 'facture', 'Document supprimé', r.number);
  }

  @Post('document/:id/payments')
  async pay(@TenantCtx() ctx: Ctx, @Param('id') id: string, @Body() dto: PaymentDto) {
    await this.checkDoc(ctx, id, 'write');
    const r = await this.docs.addPayment(ctx, id, dto);
    await this.activity.log(ctx, 'paiement', r.type === 'BC' ? 'Paiement fournisseur enregistré' : 'Paiement reçu', `${fmtDH(dto.amount)} • ${r.number}`);
    return { data: await this.docs.get(ctx, id) };
  }

  @Delete('payments/:pid') @HttpCode(204)
  async removePayment(@TenantCtx() ctx: Ctx, @Param('pid') pid: string) {
    // Le droit d'écriture est vérifié sur le document du paiement avant suppression.
    const p = await this.docs.paymentDoc(ctx, pid);
    this.check(ctx, p.type, 'write');
    await this.docs.removePayment(ctx, pid);
    await this.activity.log(ctx, 'paiement', 'Paiement supprimé', `${fmtDH(p.amount)} • ${p.number}`);
  }
}
