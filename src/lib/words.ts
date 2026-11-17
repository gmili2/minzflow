/** Montant en toutes lettres (français), pour « Arrêtée la présente facture à la somme de … ». */
const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const T = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function below100(n: number): string {
  if (n < 20) return U[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7 || t === 9) return T[t] + (u === 1 && t === 7 ? '-et-' : '-') + U[10 + u];
  if (u === 0) return T[t] + (t === 8 ? 's' : '');
  return T[t] + (u === 1 && t !== 8 ? '-et-un' : '-' + U[u]);
}
function below1000(n: number): string {
  const c = Math.floor(n / 100), r = n % 100;
  const head = c === 0 ? '' : c === 1 ? 'cent' : U[c] + '-cent' + (r === 0 ? 's' : '');
  return [head, r ? below100(r) : ''].filter(Boolean).join('-');
}
export function inWords(n: number): string {
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const units: [number, string, string][] = [[1e9, 'milliard', 'milliards'], [1e6, 'million', 'millions'], [1e3, 'mille', 'mille']];
  let rest = Math.floor(n);
  for (const [v, one, many] of units) {
    const q = Math.floor(rest / v);
    if (q) {
      if (v === 1e3) parts.push(q === 1 ? 'mille' : below1000(q).replace(/cents$/, 'cent') + '-mille');
      else parts.push(below1000(q) + '-' + (q > 1 ? many : one));
      rest %= v;
    }
  }
  if (rest) parts.push(below1000(rest));
  return parts.join('-');
}
/** 1234567 centimes → « douze-mille-trois-cent-quarante-cinq dirhams et soixante-sept centimes ». */
export function amountInWords(cents: number) {
  const dhs = Math.floor(Math.abs(cents) / 100), c = Math.abs(cents) % 100;
  const s = `${inWords(dhs)} dirham${dhs > 1 ? 's' : ''}` + (c ? ` et ${inWords(c)} centime${c > 1 ? 's' : ''}` : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
