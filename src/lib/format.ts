/** Montants en centimes → « 12 400,00 DH ». */
export function dh(c: number | null | undefined, decimals = true) {
  const v = (c ?? 0) / 100;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).replace(/[  ]/g, ' ') + ' DH';
}
/** Version courte (tableaux de bord) : sans décimales. */
export const dh0 = (c: number | null | undefined) => dh(c, false);
export const kfmt = (c: number) => { const v = c / 100; return v === 0 ? '0' : Math.abs(v) >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v)); };

/** Saisie « 1 250,50 » → 125050 centimes (NaN si invalide). */
export function toCents(s: string | number) {
  if (typeof s === 'number') return Math.round(s * 100);
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
export const fromCents = (c: number | null | undefined) => (c == null ? '' : String((c / 100).toFixed(2)).replace(/\.00$/, ''));

/** 'AAAA-MM-JJ' → 'JJ/MM/AAAA'. */
export const fdate = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
}
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}
export const qtyFmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[  ]/g, ' ');
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Assombrit une couleur #RRGGBB (survol des boutons). */
export function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const PAY_METHODS: Record<string, string> = { ESPECES: 'Espèces', CHEQUE: 'Chèque', VIREMENT: 'Virement', CARTE: 'Carte', EFFET: 'Effet' };
export const ROLES: Record<string, string> = { ADMIN: 'Administrateur', COMPTABLE: 'Comptable', COMMERCIAL: 'Commercial', LECTURE: 'Lecture seule' };
export const ROLE_CLS: Record<string, string> = { ADMIN: 'p-purple', COMPTABLE: 'p-blue', COMMERCIAL: 'p-orange', LECTURE: 'p-gray' };

/** Libellé et couleur de statut, pour tous les types de document. */
export const STATUS: Record<string, [string, string]> = {
  BROUILLON: ['Brouillon', 'p-gray'], ENVOYE: ['Envoyé', 'p-blue'], ACCEPTE: ['Accepté', 'p-green'], REFUSE: ['Refusé', 'p-red'], CONVERTI: ['Converti', 'p-purple'],
  PREPARE: ['Préparé', 'p-orange'], LIVRE: ['Livré', 'p-blue'], FACTURE: ['Facturé', 'p-green'], ANNULE: ['Annulé', 'p-gray'],
  EN_ATTENTE: ['En attente', 'p-orange'], EN_RETARD: ['En retard', 'p-red'], PARTIELLE: ['Partielle', 'p-blue'], PAYEE: ['Payée', 'p-green'], ANNULEE: ['Annulée', 'p-gray'],
  EMIS: ['Émis', 'p-purple'], COMMANDE: ['Commandé', 'p-blue'], RECU: ['Reçu', 'p-orange'], PAYE: ['Payé', 'p-green'],
};
export const statusOf = (s: string) => STATUS[s] ?? [s, 'p-gray'];
