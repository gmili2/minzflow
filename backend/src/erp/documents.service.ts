import { Injectable } from '@nestjs/common';
import { DocType, PayMethod, Prisma } from '@prisma/client';
import type { Ctx } from '../common/decorators';
import { bad, notFound } from '../common/http';
import { addDays, day, fmtDH, iso, num, range, today } from '../common/util';
import { PrismaService } from '../prisma.service';

type Tx = Prisma.TransactionClient;

export type LineInput = { productId?: string | null; designation: string; qty: number; unitPrice: number; discount?: number; tvaRate: number };
export type DocInput = {
  clientId?: string | null; supplierId?: string | null; date?: string; dueDate?: string | null;
  subject?: string | null; notes?: string | null; lines: LineInput[];
};

const PREFIX: Record<DocType, string> = { DEVIS: 'DEV', BL: 'BL', FACTURE: 'FAC', AVOIR: 'AV', BC: 'BC' };
export const DOC_LABEL: Record<DocType, string> = { DEVIS: 'Devis', BL: 'Bon de livraison', FACTURE: 'Facture', AVOIR: 'Avoir', BC: 'Commande fournisseur' };
const INITIAL: Record<DocType, string> = { DEVIS: 'BROUILLON', BL: 'PREPARE', FACTURE: 'EMISE', AVOIR: 'EMIS', BC: 'COMMANDE' };

/** Transitions de statut autorisées à la main (les autres passent par les actions : conversion, annulation…). */
const TRANSITIONS: Partial<Record<DocType, Record<string, string[]>>> = {
  DEVIS: { BROUILLON: ['ENVOYE', 'ACCEPTE', 'REFUSE'], ENVOYE: ['ACCEPTE', 'REFUSE', 'BROUILLON'], ACCEPTE: ['ENVOYE', 'REFUSE'], REFUSE: ['BROUILLON', 'ENVOYE'] },
  BL: { PREPARE: ['LIVRE', 'ANNULE'], LIVRE: ['PREPARE', 'ANNULE'], ANNULE: ['PREPARE'] },
  BC: { BROUILLON: ['COMMANDE', 'ANNULE'], COMMANDE: ['RECU', 'BROUILLON', 'ANNULE'], RECU: ['COMMANDE'], ANNULE: ['BROUILLON'] },
};

/** Statut affiché d'une facture ou d'une commande, selon les paiements et l'échéance. */
export function payStatus(d: { type: DocType; status: string; totalTTC: number; paidAmount: number; dueDate: Date | null }) {
  if (d.type === 'FACTURE') {
    if (d.status === 'ANNULEE') return 'ANNULEE';
    if (d.totalTTC > 0 && d.paidAmount >= d.totalTTC) return 'PAYEE';
    if (d.paidAmount > 0) return 'PARTIELLE';
    if (d.dueDate && d.dueDate < today()) return 'EN_RETARD';
    return 'EN_ATTENTE';
  }
  if (d.type === 'BC' && d.status === 'RECU' && d.totalTTC > 0 && d.paidAmount >= d.totalTTC) return 'PAYE';
  return d.status;
}

/** Arrondi au centime d'un montant HT de ligne. */
function lineHT(l: LineInput) {
  return Math.round(l.qty * l.unitPrice * (1 - (l.discount ?? 0) / 100));
}

export function computeTotals(lines: LineInput[]) {
  let ht = 0, tva = 0;
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const h = lineHT(l);
    ht += h;
    byRate.set(l.tvaRate, (byRate.get(l.tvaRate) ?? 0) + h);
  }
  // TVA calculée par taux (et non ligne à ligne) : une seule règle d'arrondi, comme sur la facture imprimée.
  for (const [rate, base] of byRate) tva += Math.round((base * rate) / 100);
  return { totalHT: ht, totalTVA: tva, totalTTC: ht + tva };
}

const LIST_INCLUDE = { client: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } }, _count: { select: { lines: true } } } as const;

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  /* ───────────── Lecture ───────────── */

  async list(ctx: Ctx, type: DocType, q: { from?: string; to?: string; partyId?: string; search?: string; status?: string }) {
    const where: Prisma.DocumentWhereInput = {
      tenantId: ctx.tenantId, type,
      ...(range(q.from, q.to) && { date: range(q.from, q.to) }),
      ...(q.partyId && (type === 'BC' ? { supplierId: q.partyId } : { clientId: q.partyId })),
      ...(q.search && {
        OR: [
          { number: { contains: q.search } }, { subject: { contains: q.search } },
          { client: { name: { contains: q.search } } }, { supplier: { name: { contains: q.search } } },
        ],
      }),
    };
    const docs = await this.prisma.document.findMany({ where, include: LIST_INCLUDE, orderBy: [{ date: 'desc' }, { number: 'desc' }], take: 2000 });
    const rows = docs.map((d) => this.row(d));
    return q.status ? rows.filter((r) => r.displayStatus === q.status) : rows;
  }

  private row(d: Prisma.DocumentGetPayload<{ include: typeof LIST_INCLUDE }>) {
    return {
      id: d.id, type: d.type, number: d.number, status: d.status, displayStatus: payStatus(d),
      date: iso(d.date), dueDate: iso(d.dueDate), subject: d.subject,
      party: d.client ?? d.supplier, totalHT: d.totalHT, totalTVA: d.totalTVA, totalTTC: d.totalTTC, paidAmount: d.paidAmount,
      lines: d._count.lines, sourceId: d.sourceId,
    };
  }

  async get(ctx: Ctx, id: string) {
    const d = await this.prisma.document.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: {
        client: true, supplier: true,
        lines: { orderBy: { position: 'asc' }, include: { product: { select: { ref: true, unit: true } } } },
        payments: { orderBy: { date: 'asc' } },
      },
    });
    if (!d) throw notFound('Document introuvable');
    const [source, children] = await Promise.all([
      d.sourceId ? this.prisma.document.findFirst({ where: { id: d.sourceId, tenantId: ctx.tenantId }, select: { id: true, type: true, number: true } }) : null,
      this.prisma.document.findMany({ where: { sourceId: d.id, tenantId: ctx.tenantId }, select: { id: true, type: true, number: true, status: true } }),
    ]);
    return {
      ...d, date: iso(d.date), dueDate: iso(d.dueDate), displayStatus: payStatus(d), source, children,
      lines: d.lines.map((l) => ({ ...l, qty: num(l.qty), discount: num(l.discount), ref: l.product?.ref ?? null, unit: l.product?.unit ?? null })),
      payments: d.payments.map((p) => ({ ...p, date: iso(p.date) })),
    };
  }

  /* ───────────── Création / modification ───────────── */

  async create(ctx: Ctx, type: DocType, input: DocInput, sourceId?: string, tx?: Tx): Promise<{ id: string; number: string }> {
    const run = async (t: Tx) => {
      const tenant = await t.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      await this.checkParty(t, ctx, type, input);
      const lines = await this.checkLines(t, ctx, input.lines);
      const date = day(input.date, today());
      const dueDate = input.dueDate ? day(input.dueDate)
        : type === 'FACTURE' ? addDays(date, tenant.paymentDays)
        : type === 'DEVIS' ? addDays(date, tenant.quoteDays) : null;
      const number = await this.nextNumber(t, ctx.tenantId, type, date);
      const doc = await t.document.create({
        data: {
          tenantId: ctx.tenantId, type, number, status: INITIAL[type], date, dueDate,
          clientId: type === 'BC' ? null : input.clientId, supplierId: type === 'BC' ? input.supplierId : null,
          subject: input.subject?.trim() || null, notes: input.notes?.trim() || null, sourceId: sourceId ?? null, createdById: ctx.userId,
          ...computeTotals(lines),
          lines: { create: lines.map((l, i) => ({ ...this.lineData(l), position: i })) },
        },
      });
      // Facture directe (sans bon de livraison) : les articles sortent du stock à l'émission.
      if (type === 'FACTURE' && !(await this.fromDelivery(t, sourceId))) await this.applyStock(t, ctx, doc.id, -1, `Facture ${number}`);
      // Avoir : les articles reviennent en stock.
      if (type === 'AVOIR') await this.applyStock(t, ctx, doc.id, +1, `Avoir ${number}`);
      return { id: doc.id, number };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async update(ctx: Ctx, id: string, input: DocInput) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id);
      const editable =
        (d.type === 'DEVIS' && d.status !== 'CONVERTI') || (d.type === 'BL' && d.status === 'PREPARE') ||
        (d.type === 'BC' && (d.status === 'BROUILLON' || d.status === 'COMMANDE')) ||
        (d.type === 'FACTURE' && d.status === 'EMISE' && d.paidAmount === 0);
      if (!editable) throw bad(`${DOC_LABEL[d.type]} ${d.number} n'est plus modifiable (statut ou paiements)`);
      await this.checkParty(t, ctx, d.type, input);
      const lines = await this.checkLines(t, ctx, input.lines);
      const reapply = d.stockApplied;
      if (reapply) await this.applyStock(t, ctx, d.id, +1, `Modification ${d.number} (annulation des lignes précédentes)`);
      await t.documentLine.deleteMany({ where: { documentId: d.id } });
      await t.document.update({
        where: { id: d.id },
        data: {
          ...(d.type === 'BC' ? { supplierId: input.supplierId } : { clientId: input.clientId }),
          date: input.date ? day(input.date) : d.date,
          dueDate: input.dueDate === undefined ? d.dueDate : input.dueDate ? day(input.dueDate) : null,
          subject: input.subject?.trim() || null, notes: input.notes?.trim() || null,
          ...computeTotals(lines),
          lines: { create: lines.map((l, i) => ({ ...this.lineData(l), position: i })) },
        },
      });
      if (reapply) await this.applyStock(t, ctx, d.id, -1, `Modification ${d.number}`);
      return { id: d.id, number: d.number };
    });
  }

  async setStatus(ctx: Ctx, id: string, status: string) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id);
      const allowed = TRANSITIONS[d.type]?.[d.status] ?? [];
      if (!allowed.includes(status)) throw bad(`Passage de « ${d.status} » à « ${status} » impossible pour ${d.number}`);
      if (d.type === 'BL') {
        if (status === 'LIVRE') await this.applyStock(t, ctx, d.id, -1, `Livraison ${d.number}`);
        if (d.status === 'LIVRE') await this.applyStock(t, ctx, d.id, +1, `Retour ${d.number}`);
      }
      if (d.type === 'BC') {
        if (status === 'RECU') await this.applyStock(t, ctx, d.id, +1, `Réception ${d.number}`);
        if (d.status === 'RECU') {
          if (d.paidAmount > 0) throw bad('Commande déjà réglée : supprimez d\'abord les paiements');
          await this.applyStock(t, ctx, d.id, -1, `Annulation réception ${d.number}`);
        }
        if (status === 'ANNULE' && d.paidAmount > 0) throw bad('Commande déjà réglée : supprimez d\'abord les paiements');
      }
      await t.document.update({ where: { id: d.id }, data: { status } });
      return { id: d.id, number: d.number, status };
    });
  }

  /** Devis → BL ou facture ; BL → facture ; commande fournisseur dupliquée. */
  async convert(ctx: Ctx, id: string, target: DocType) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id, true);
      const ok = (d.type === 'DEVIS' && (target === 'BL' || target === 'FACTURE')) || (d.type === 'BL' && target === 'FACTURE');
      if (!ok) throw bad(`Conversion ${DOC_LABEL[d.type]} → ${DOC_LABEL[target]} impossible`);
      if (d.type === 'DEVIS' && (d.status === 'CONVERTI' || d.status === 'REFUSE')) throw bad(`Le devis ${d.number} est ${d.status === 'CONVERTI' ? 'déjà converti' : 'refusé'}`);
      if (d.type === 'BL' && (d.status === 'FACTURE' || d.status === 'ANNULE')) throw bad(`Le bon ${d.number} est ${d.status === 'FACTURE' ? 'déjà facturé' : 'annulé'}`);
      const created = await this.create(ctx, target, {
        clientId: d.clientId, subject: d.subject, notes: d.notes,
        lines: d.lines.map((l) => ({ productId: l.productId, designation: l.designation, qty: num(l.qty), unitPrice: l.unitPrice, discount: num(l.discount), tvaRate: l.tvaRate })),
      }, d.id, t);
      if (d.type === 'BL' && d.status === 'PREPARE') {
        // Facturer un bon encore « préparé » vaut livraison : la marchandise sort du stock à ce moment.
        await this.applyStock(t, ctx, d.id, -1, `Livraison ${d.number}`);
      }
      await t.document.update({ where: { id: d.id }, data: { status: d.type === 'DEVIS' ? 'CONVERTI' : 'FACTURE' } });
      return created;
    });
  }

  /** Annule une facture : crée l'avoir correspondant (numérotation continue, rien n'est supprimé). */
  async cancelInvoice(ctx: Ctx, id: string) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id, true);
      if (d.type !== 'FACTURE') throw bad('Seule une facture peut être annulée par avoir');
      if (d.status === 'ANNULEE') throw bad(`La facture ${d.number} est déjà annulée`);
      if (d.paidAmount > 0) throw bad('Facture déjà (partiellement) payée : supprimez d\'abord les paiements ou remboursez le client');
      const fromBL = await this.fromDelivery(t, d.sourceId);
      let avoir: { id: string; number: string };
      if (fromBL) {
        // Facture issue d'un BL : la marchandise a bien été livrée, le stock ne bouge pas ; le BL redevient « livré ».
        avoir = await this.createRaw(t, ctx, d, 'AVOIR');
        await t.document.update({ where: { id: d.sourceId! }, data: { status: 'LIVRE' } });
      } else {
        avoir = await this.create(ctx, 'AVOIR', {
          clientId: d.clientId, subject: `Annulation de la facture ${d.number}`,
          lines: d.lines.map((l) => ({ productId: l.productId, designation: l.designation, qty: num(l.qty), unitPrice: l.unitPrice, discount: num(l.discount), tvaRate: l.tvaRate })),
        }, d.id, t);
      }
      await t.document.update({ where: { id: d.id }, data: { status: 'ANNULEE' } });
      return avoir;
    });
  }

  /** Avoir sans mouvement de stock (annulation d'une facture issue d'un BL). */
  private async createRaw(t: Tx, ctx: Ctx, d: Prisma.DocumentGetPayload<{ include: { lines: true } }>, type: DocType) {
    const date = today();
    const number = await this.nextNumber(t, ctx.tenantId, type, date);
    const doc = await t.document.create({
      data: {
        tenantId: ctx.tenantId, type, number, status: INITIAL[type], date, clientId: d.clientId, subject: `Annulation de la facture ${d.number}`,
        sourceId: d.id, createdById: ctx.userId, totalHT: d.totalHT, totalTVA: d.totalTVA, totalTTC: d.totalTTC,
        lines: { create: d.lines.map((l, i) => ({ productId: l.productId, designation: l.designation, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount, tvaRate: l.tvaRate, totalHT: l.totalHT, position: i })) },
      },
    });
    return { id: doc.id, number };
  }

  async remove(ctx: Ctx, id: string) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id);
      if (d.type === 'FACTURE' || d.type === 'AVOIR') throw bad('Une facture ou un avoir ne se supprime pas : annulez la facture (un avoir est créé)');
      if (d.paidAmount > 0) throw bad('Document réglé : supprimez d\'abord les paiements');
      if (d.type === 'BL' && d.status === 'FACTURE') throw bad('Bon déjà facturé');
      if (d.type === 'DEVIS' && d.status === 'CONVERTI') throw bad('Devis déjà converti');
      if (d.stockApplied) await this.applyStock(t, ctx, d.id, d.type === 'BC' ? -1 : +1, `Suppression ${d.number}`);
      await t.document.delete({ where: { id: d.id } });
      return { number: d.number };
    });
  }

  /* ───────────── Paiements ───────────── */

  async addPayment(ctx: Ctx, id: string, p: { date?: string; amount: number; method: PayMethod; reference?: string | null; note?: string | null }) {
    return this.prisma.$transaction(async (t) => {
      const d = await this.load(t, ctx, id);
      if (d.type !== 'FACTURE' && d.type !== 'BC') throw bad('Paiement possible uniquement sur une facture ou une commande fournisseur');
      if (d.status === 'ANNULEE' || d.status === 'ANNULE') throw bad('Document annulé');
      if (!Number.isInteger(p.amount) || p.amount <= 0) throw bad('Montant invalide');
      const rest = d.totalTTC - d.paidAmount;
      if (p.amount > rest) throw bad(`Le montant dépasse le reste à payer (${fmtDH(rest)})`);
      await t.payment.create({
        data: { tenantId: ctx.tenantId, documentId: d.id, date: day(p.date, today()), amount: p.amount, method: p.method, reference: p.reference?.trim() || null, note: p.note?.trim() || null },
      });
      const updated = await t.document.update({ where: { id: d.id }, data: { paidAmount: { increment: p.amount } } });
      return { number: d.number, type: d.type, paid: updated.paidAmount, total: updated.totalTTC };
    });
  }

  async paymentDoc(ctx: Ctx, paymentId: string) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, tenantId: ctx.tenantId }, include: { document: { select: { type: true, number: true } } } });
    if (!p) throw notFound('Paiement introuvable');
    return { type: p.document.type, number: p.document.number, amount: p.amount };
  }

  async removePayment(ctx: Ctx, paymentId: string) {
    return this.prisma.$transaction(async (t) => {
      const p = await t.payment.findFirst({ where: { id: paymentId, tenantId: ctx.tenantId } });
      if (!p) throw notFound('Paiement introuvable');
      await t.payment.delete({ where: { id: p.id } });
      await t.document.update({ where: { id: p.documentId }, data: { paidAmount: { decrement: p.amount } } });
      return p;
    });
  }

  /* ───────────── Outils internes ───────────── */

  private async load(t: Tx, ctx: Ctx, id: string, withLines = false) {
    const d = await t.document.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: withLines } });
    if (!d) throw notFound('Document introuvable');
    return d as Prisma.DocumentGetPayload<{ include: { lines: true } }>;
  }

  private async fromDelivery(t: Tx, sourceId: string | null | undefined) {
    if (!sourceId) return false;
    const s = await t.document.findUnique({ where: { id: sourceId }, select: { type: true } });
    return s?.type === 'BL';
  }

  private async checkParty(t: Tx, ctx: Ctx, type: DocType, input: DocInput) {
    if (type === 'BC') {
      if (!input.supplierId || !(await t.supplier.findFirst({ where: { id: input.supplierId, tenantId: ctx.tenantId }, select: { id: true } }))) throw bad('Choisissez un fournisseur');
    } else if (!input.clientId || !(await t.client.findFirst({ where: { id: input.clientId, tenantId: ctx.tenantId }, select: { id: true } }))) {
      throw bad('Choisissez un client');
    }
  }

  private async checkLines(t: Tx, ctx: Ctx, lines: LineInput[]) {
    if (!lines?.length) throw bad('Ajoutez au moins une ligne');
    const ids = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))];
    if (ids.length) {
      const found = await t.product.count({ where: { id: { in: ids }, tenantId: ctx.tenantId } });
      if (found !== ids.length) throw bad('Article introuvable dans votre catalogue');
    }
    return lines.map((l, i) => {
      if (!l.designation?.trim()) throw bad(`Ligne ${i + 1} : désignation manquante`);
      if (!(l.qty > 0)) throw bad(`Ligne ${i + 1} : quantité invalide`);
      if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw bad(`Ligne ${i + 1} : prix invalide`);
      if (![0, 7, 10, 14, 20].includes(l.tvaRate)) throw bad(`Ligne ${i + 1} : taux de TVA invalide`);
      const discount = l.discount ?? 0;
      if (discount < 0 || discount > 100) throw bad(`Ligne ${i + 1} : remise invalide`);
      return { ...l, designation: l.designation.trim().slice(0, 255), qty: Math.round(l.qty * 1000) / 1000, discount, productId: l.productId || null };
    });
  }

  private lineData(l: LineInput) {
    return { productId: l.productId || null, designation: l.designation, qty: l.qty, unitPrice: l.unitPrice, discount: l.discount ?? 0, tvaRate: l.tvaRate, totalHT: lineHT(l) };
  }

  /** Numéro suivant par type et par année : FAC-2026-001… (compteur verrouillé dans la transaction). */
  private async nextNumber(t: Tx, tenantId: string, type: DocType, date: Date) {
    const year = date.getUTCFullYear();
    const key = `${type}-${year}`;
    await t.counter.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, value: 0 }, update: {} });
    const c = await t.counter.update({ where: { tenantId_key: { tenantId, key } }, data: { value: { increment: 1 } } });
    return `${PREFIX[type]}-${year}-${String(c.value).padStart(3, '0')}`;
  }

  /**
   * Mouvemente le stock des articles (hors prestations) d'un document : sign = -1 sortie, +1 entrée.
   * Le drapeau stockApplied indique si les quantités du document sont actuellement déduites/ajoutées.
   */
  private async applyStock(t: Tx, ctx: Ctx, documentId: string, sign: 1 | -1, reason: string) {
    const doc = await t.document.findUniqueOrThrow({ where: { id: documentId }, include: { lines: { include: { product: true } } } });
    // Sortie (vente) ou entrée (achat) « appliquée » ; l'opération inverse retire l'application.
    const applying = doc.type === 'BC' || doc.type === 'AVOIR' ? sign === 1 : sign === -1;
    if (applying === doc.stockApplied) return;
    for (const l of doc.lines) {
      if (!l.product || l.product.isService) continue;
      const qty = num(l.qty) * sign;
      await t.product.update({ where: { id: l.product.id }, data: { stock: { increment: qty } } });
      await t.stockMovement.create({
        data: { tenantId: ctx.tenantId, productId: l.product.id, kind: sign > 0 ? 'IN' : 'OUT', qty, reason, documentId: doc.id, userId: ctx.userId },
      });
    }
    await t.document.update({ where: { id: doc.id }, data: { stockApplied: applying } });
  }
}
