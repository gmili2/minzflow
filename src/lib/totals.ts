/** Calcul identique au serveur : HT par ligne arrondi au centime, TVA par taux. */
export function totalsOf(lines: { qty: number; unitPrice: number; discount: number; tvaRate: number }[]) {
  let ht = 0;
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const h = Math.round(l.qty * l.unitPrice * (1 - l.discount / 100));
    ht += h; byRate.set(l.tvaRate, (byRate.get(l.tvaRate) ?? 0) + h);
  }
  let tva = 0;
  const rates: { rate: number; base: number; tva: number }[] = [];
  for (const [rate, base] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) { const t = Math.round((base * rate) / 100); tva += t; rates.push({ rate, base, tva: t }); }
  return { ht, tva, ttc: ht + tva, rates };
}
