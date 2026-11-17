/** Configuration des types de documents côté interface. */
export type DocKind = 'devis' | 'bons' | 'factures' | 'achats';
export type DocRow = {
  id: string; type: string; number: string; status: string; displayStatus: string; date: string; dueDate: string | null;
  subject: string | null; party: { id: string; name: string } | null; totalHT: number; totalTVA: number; totalTTC: number; paidAmount: number; lines: number;
};

export const KIND: Record<DocKind, {
  seg: string; type: string; title: string; one: string; sub: string; newLabel: string; party: 'client' | 'fournisseur'; module: string;
  tabs: { id: string; label: string; match: (s: string) => boolean }[];
}> = {
  devis: {
    seg: 'devis', type: 'DEVIS', title: 'Devis', one: 'Devis', sub: 'Préparez vos offres et convertissez-les en bon de livraison ou en facture.', newLabel: 'Nouveau devis', party: 'client', module: 'devis',
    tabs: [
      { id: 'all', label: 'Tous', match: () => true }, { id: 'BROUILLON', label: 'Brouillons', match: (s) => s === 'BROUILLON' },
      { id: 'ENVOYE', label: 'Envoyés', match: (s) => s === 'ENVOYE' }, { id: 'ACCEPTE', label: 'Acceptés', match: (s) => s === 'ACCEPTE' },
      { id: 'REFUSE', label: 'Refusés', match: (s) => s === 'REFUSE' }, { id: 'CONVERTI', label: 'Convertis', match: (s) => s === 'CONVERTI' },
    ],
  },
  bons: {
    seg: 'bl', type: 'BL', title: 'Bons de livraison', one: 'Bon de livraison', sub: 'Livrez vos clients : la marchandise sort du stock à la livraison.', newLabel: 'Nouveau bon', party: 'client', module: 'bons',
    tabs: [
      { id: 'all', label: 'Tous', match: () => true }, { id: 'PREPARE', label: 'À livrer', match: (s) => s === 'PREPARE' },
      { id: 'LIVRE', label: 'Livrés', match: (s) => s === 'LIVRE' }, { id: 'FACTURE', label: 'Facturés', match: (s) => s === 'FACTURE' }, { id: 'ANNULE', label: 'Annulés', match: (s) => s === 'ANNULE' },
    ],
  },
  factures: {
    seg: 'factures', type: 'FACTURE', title: 'Factures', one: 'Facture', sub: 'Suivez vos encaissements, imprimez et relancez les impayés.', newLabel: 'Nouvelle facture', party: 'client', module: 'factures',
    tabs: [
      { id: 'all', label: 'Toutes', match: (s) => s !== 'ANNULEE' }, { id: 'PAYEE', label: 'Payées', match: (s) => s === 'PAYEE' },
      { id: 'IMPAYEES', label: 'Impayées', match: (s) => ['EN_ATTENTE', 'EN_RETARD', 'PARTIELLE'].includes(s) },
      { id: 'EN_RETARD', label: 'En retard', match: (s) => s === 'EN_RETARD' }, { id: 'ANNULEE', label: 'Annulées', match: (s) => s === 'ANNULEE' },
    ],
  },
  achats: {
    seg: 'achats', type: 'BC', title: 'Achats', one: 'Commande fournisseur', sub: 'Commandez, réceptionnez (entrée en stock) et réglez vos fournisseurs.', newLabel: 'Nouvelle commande', party: 'fournisseur', module: 'achats',
    tabs: [
      { id: 'all', label: 'Toutes', match: (s) => s !== 'ANNULE' }, { id: 'BROUILLON', label: 'Brouillons', match: (s) => s === 'BROUILLON' },
      { id: 'COMMANDE', label: 'Commandées', match: (s) => s === 'COMMANDE' }, { id: 'RECU', label: 'Reçues à régler', match: (s) => s === 'RECU' },
      { id: 'PAYE', label: 'Payées', match: (s) => s === 'PAYE' }, { id: 'ANNULE', label: 'Annulées', match: (s) => s === 'ANNULE' },
    ],
  },
};

/** Type d'API → segment d'URL de l'application. */
export const PAGE_OF_TYPE: Record<string, DocKind> = { DEVIS: 'devis', BL: 'bons', FACTURE: 'factures', AVOIR: 'factures', BC: 'achats' };
export const TYPE_LABEL: Record<string, string> = { DEVIS: 'Devis', BL: 'Bon de livraison', FACTURE: 'Facture', AVOIR: 'Avoir', BC: 'Bon de commande' };

/** Périodes rapides des filtres. */
export function presets() {
  const t = new Date();
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const first = new Date(Date.UTC(t.getFullYear(), t.getMonth(), 1));
  const prev = new Date(Date.UTC(t.getFullYear(), t.getMonth() - 1, 1));
  const prevEnd = new Date(Date.UTC(t.getFullYear(), t.getMonth(), 0));
  const three = new Date(Date.UTC(t.getFullYear(), t.getMonth() - 2, 1));
  const lastDay = new Date(Date.UTC(t.getFullYear(), t.getMonth() + 1, 0));
  return [
    { id: 'all', label: 'Tout', from: '', to: '' },
    { id: 'm', label: 'Ce mois', from: ym(first) + '-01', to: lastDay.toISOString().slice(0, 10) },
    { id: 'pm', label: 'Mois dernier', from: ym(prev) + '-01', to: prevEnd.toISOString().slice(0, 10) },
    { id: '3m', label: '3 derniers mois', from: ym(three) + '-01', to: lastDay.toISOString().slice(0, 10) },
    { id: 'y', label: 'Cette année', from: `${t.getFullYear()}-01-01`, to: `${t.getFullYear()}-12-31` },
  ];
}

/** Export CSV (séparateur « ; », lisible par Excel en français). */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = '﻿' + rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const csvMoney = (c: number) => (c / 100).toFixed(2).replace('.', ',');
