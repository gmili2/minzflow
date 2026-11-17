import { Prisma } from '@prisma/client';
import { bad } from './http';

/** 'AAAA-MM-JJ' → Date à minuit UTC (colonnes @db.Date). */
export function day(s: string | undefined | null, fallback?: Date): Date {
  if (!s) {
    if (fallback) return fallback;
    throw bad('Date manquante');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('Date invalide (format AAAA-MM-JJ)');
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw bad('Date invalide');
  return d;
}

/** Date du jour (fuseau du Maroc) à minuit UTC. */
export function today(): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
  return new Date(s + 'T00:00:00Z');
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
export const fmtDH = (c: number) => (Math.round(c) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' DH';

/** Filtre de période sur une colonne date (from/to inclus, au format AAAA-MM-JJ). */
export function range(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return { ...(from && { gte: day(from) }), ...(to && { lte: day(to) }) };
}

/** Chaîne optionnelle nettoyée : '' → null. */
export const opt = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};
