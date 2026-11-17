import { totalsOf } from '../lib/totals';
import { TYPE_LABEL } from '../lib/docs';
import { dh, fdate, PAY_METHODS, qtyFmt } from '../lib/format';
import { amountInWords } from '../lib/words';

export type Company = {
  name: string; logoUrl: string | null; primaryColor: string; legalForm: string | null; ice: string | null; rc: string | null; ifiscal: string | null;
  patente: string | null; cnss: string | null; capital: string | null; address: string | null; city: string | null; phone: string | null; email: string | null;
  website: string | null; bankName: string | null; rib: string | null; footer: string | null; tvaDefault: number; paymentDays: number; quoteDays: number; openingCash: number;
};
export type Party = { id: string; name: string; ice: string | null; city: string | null; address: string | null; email: string | null; phone: string | null; contact: string | null };
export type FullDoc = {
  id: string; type: string; number: string; status: string; displayStatus: string; date: string; dueDate: string | null; subject: string | null; notes: string | null;
  client: Party | null; supplier: Party | null; clientId: string | null; supplierId: string | null;
  totalHT: number; totalTVA: number; totalTTC: number; paidAmount: number;
  lines: { id: string; productId: string | null; designation: string; qty: number; unitPrice: number; discount: number; tvaRate: number; totalHT: number; ref: string | null; unit: string | null }[];
  payments: { id: string; date: string; amount: number; method: string; reference: string | null; note: string | null }[];
  source: { id: string; type: string; number: string } | null;
  children: { id: string; type: string; number: string; status: string }[];
};

const TITLE: Record<string, string> = { DEVIS: 'DEVIS', BL: 'BON DE LIVRAISON', FACTURE: 'FACTURE', AVOIR: 'AVOIR', BC: 'BON DE COMMANDE' };

/** Document au format papier (toujours clair), utilisé à l'écran et à l'impression. */
export default function DocSheet({ doc, co }: { doc: FullDoc; co: Company }) {
  const party = doc.client ?? doc.supplier;
  const hasDiscount = doc.lines.some((l) => l.discount > 0);
  const showPrices = doc.type !== 'BL';
  const rates = totalsOf(doc.lines).rates;
  const legal = [co.legalForm && co.capital ? `${co.legalForm} au capital de ${co.capital}` : co.legalForm, co.ice && `ICE : ${co.ice}`, co.rc && `RC : ${co.rc}`, co.ifiscal && `IF : ${co.ifiscal}`, co.patente && `Patente : ${co.patente}`, co.cnss && `CNSS : ${co.cnss}`].filter(Boolean);
  const band = co.primaryColor || '#0B2540';
  const cols = hasDiscount ? '3fr .7fr 1.2fr .7fr .7fr 1.3fr' : '3fr .7fr 1.2fr .7fr 1.3fr';
  const paid = doc.displayStatus === 'PAYEE' || doc.displayStatus === 'PAYE';
  return (
    <div className="sheet">
      <div className="sheet-band" style={{ background: band }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {co.logoUrl && <img className="sheet-logo" src={co.logoUrl} alt="" />}
          <div><b style={{ fontSize: 18 }}>{co.name}</b><div style={{ opacity: 0.9, marginTop: 4 }}>{[co.address, co.city].filter(Boolean).join(', ')}</div><div style={{ opacity: 0.9 }}>{[co.phone, co.email].filter(Boolean).join(' • ')}</div></div>
        </div>
        <div style={{ textAlign: 'right' }}><b style={{ fontSize: 21, letterSpacing: '.04em' }}>{TITLE[doc.type]}</b><div style={{ marginTop: 4, fontSize: 15 }}>N° {doc.number}</div></div>
      </div>
      <div className="sheet-body">
        <div className="sheet-2">
          <div>
            <div className="sheet-lbl">Émetteur</div><b>{co.name}</b>
            {co.ice && <div>ICE : {co.ice}</div>}
            {co.phone && <div>Tél. : {co.phone}</div>}
          </div>
          <div>
            <div className="sheet-lbl">{doc.type === 'BC' ? 'Fournisseur' : doc.type === 'BL' ? 'Livré à' : 'Facturé à'}</div>
            <b>{party?.name}</b>
            {party?.ice && <div>ICE : {party.ice}</div>}
            {(party?.address || party?.city) && <div>{[party.address, party.city].filter(Boolean).join(', ')}</div>}
            {(party?.phone || party?.email) && <div>{[party.phone, party.email].filter(Boolean).join(' • ')}</div>}
          </div>
        </div>
        <div className="sheet-2">
          <div><div className="sheet-lbl">Date</div>{fdate(doc.date)}</div>
          {doc.dueDate && doc.type !== 'AVOIR' && <div><div className="sheet-lbl">{doc.type === 'DEVIS' ? 'Valable jusqu’au' : 'Échéance'}</div>{fdate(doc.dueDate)}</div>}
          {doc.source && <div><div className="sheet-lbl">Référence</div>{TYPE_LABEL[doc.source.type]} {doc.source.number}</div>}
        </div>
        {doc.subject && <div><div className="sheet-lbl">Objet</div>{doc.subject}</div>}
        <div>
          <div className="sheet-tr5 h" style={{ gridTemplateColumns: showPrices ? cols : '4fr 1fr 1fr' }}>
            <span>Désignation</span><span className="r">Qté</span>
            {showPrices ? <><span className="r">PU HT</span>{hasDiscount && <span className="r">Remise</span>}<span className="r">TVA</span><span className="r">Total HT</span></> : <span className="r">Unité</span>}
          </div>
          {doc.lines.map((l) => (
            <div key={l.id} className="sheet-tr5" style={{ gridTemplateColumns: showPrices ? cols : '4fr 1fr 1fr' }}>
              <span>{l.designation}{l.ref && <span style={{ color: '#8494A9', fontSize: 11 }}> — {l.ref}</span>}</span>
              <span className="r">{qtyFmt(l.qty)}</span>
              {showPrices ? <><span className="r">{dh(l.unitPrice)}</span>{hasDiscount && <span className="r">{l.discount ? l.discount + ' %' : ''}</span>}<span className="r">{l.tvaRate} %</span><span className="r">{dh(l.totalHT)}</span></> : <span className="r">{l.unit ?? ''}</span>}
            </div>
          ))}
        </div>
        {showPrices && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {paid && <span className="stamp">{doc.type === 'BC' ? 'RÉGLÉ' : 'PAYÉE'}</span>}
              {doc.type === 'AVOIR' && <span className="stamp" style={{ borderColor: '#5B21B6', color: '#5B21B6' }}>AVOIR</span>}
            </div>
            <div className="sheet-tot">
              <div><span>Total HT</span><span>{dh(doc.totalHT)}</span></div>
              {rates.map((r) => <div key={r.rate}><span>TVA {r.rate} %</span><span>{dh(r.tva)}</span></div>)}
              <div className="sheet-grand" style={{ background: band }}><span>Total TTC</span><span>{dh(doc.totalTTC)}</span></div>
              {doc.paidAmount > 0 && doc.paidAmount < doc.totalTTC && <><div><span>Déjà réglé</span><span>{dh(doc.paidAmount)}</span></div><div style={{ fontWeight: 700 }}><span>Reste à payer</span><span>{dh(doc.totalTTC - doc.paidAmount)}</span></div></>}
            </div>
          </div>
        )}
        {showPrices && (doc.type === 'FACTURE' || doc.type === 'DEVIS' || doc.type === 'AVOIR') && (
          <p style={{ margin: 0, fontSize: 12.5 }}>
            Arrêté{doc.type === 'FACTURE' ? 'e' : ''} {doc.type === 'FACTURE' ? 'la présente facture' : doc.type === 'DEVIS' ? 'le présent devis' : 'le présent avoir'} à la somme de : <b>{amountInWords(doc.totalTTC)} TTC</b>.
          </p>
        )}
        {doc.type === 'FACTURE' && doc.payments.length > 0 && (
          <div style={{ fontSize: 12 }}><div className="sheet-lbl">Règlements</div>{doc.payments.map((p) => <div key={p.id}>{fdate(p.date)} — {PAY_METHODS[p.method]}{p.reference ? ` n° ${p.reference}` : ''} — {dh(p.amount)}</div>)}</div>
        )}
        {doc.notes && <div style={{ fontSize: 12.5, whiteSpace: 'pre-line' }}><div className="sheet-lbl">Notes</div>{doc.notes}</div>}
        {doc.type === 'BL' && (
          <div className="sheet-2" style={{ marginTop: 20 }}>
            <div style={{ borderTop: '1px solid #CBD5E1', paddingTop: 8, fontSize: 12 }}>Signature et cachet de l'émetteur</div>
            <div style={{ borderTop: '1px solid #CBD5E1', paddingTop: 8, fontSize: 12 }}>Reçu conforme — signature du client</div>
          </div>
        )}
        <div style={{ borderTop: '1px solid #EEF2F6', paddingTop: 10, fontSize: 11, color: '#536379', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {co.footer && doc.type !== 'BC' && <div style={{ whiteSpace: 'pre-line' }}>{co.footer}</div>}
          {co.rib && doc.type === 'FACTURE' && <div>Règlement par virement : {co.bankName ? co.bankName + ' — ' : ''}RIB {co.rib}</div>}
          {legal.length > 0 && <div>{legal.join(' • ')}</div>}
        </div>
      </div>
    </div>
  );
}
