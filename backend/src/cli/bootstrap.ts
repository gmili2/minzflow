/**
 * Initialisation : crée (ou met à jour) le compte super-administrateur à partir de SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD.
 *   node dist/cli/bootstrap.js                 → super-admin seulement (mot de passe inchangé s'il existe déjà)
 *   node dist/cli/bootstrap.js --reset-password → réécrit le mot de passe du super-admin depuis le .env
 *   node dist/cli/bootstrap.js --demo           → ajoute l'entreprise de démonstration (données de la maquette)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { PayMethod } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../app.module';
import type { Ctx } from '../common/decorators';
import { hashPassword } from '../common/password';
import { addDays, iso, today } from '../common/util';
import { DocumentsService } from '../erp/documents.service';
import { pinPrismaEngine } from '../prisma-engine';
import { PrismaService } from '../prisma.service';

async function main() {
  pinPrismaEngine();
  const args = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;
  if (email && password) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({ data: { email, name: 'Super-administrateur', role: 'SUPERADMIN', passwordHash: await hashPassword(password) } });
      console.log(`  super-admin créé : ${email}`);
    } else if (args.includes('--reset-password')) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), role: 'SUPERADMIN', tenantId: null, active: true } });
      console.log(`  mot de passe du super-admin réinitialisé : ${email}`);
    }
  }

  if (args.includes('--demo')) await demo(prisma, app.get(DocumentsService));
  await app.close();
}

/** Entreprise de démonstration « Benali Solutions » (données de la maquette, sur les 6 derniers mois). */
async function demo(prisma: PrismaService, docs: DocumentsService) {
  const slug = 'benali-solutions-demo';
  if (await prisma.tenant.findUnique({ where: { slug } })) { console.log('  démo déjà présente'); return; }
  const pass = randomBytes(9).toString('base64url');
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Benali Solutions SARL', slug, primaryColor: '#047857', legalForm: 'SARL', ice: '001234567000089', rc: '412345', ifiscal: '45123456', patente: '35123456',
      cnss: '9123456', capital: '100 000 DH', address: 'Bd Zerktouni', city: 'Casablanca', phone: '0522 00 00 00', email: 'contact@benali-demo.ma',
      bankName: 'Banque Populaire', rib: '181 780 21211 12345678 0001 23', footer: 'Paiement à 30 jours. Merci pour votre confiance.', openingCash: 1500000,
      users: { create: [
        { email: 'demo@minzflow.ma', name: 'Ahmed Benali', role: 'ADMIN', passwordHash: await hashPassword(pass) },
        { email: 'salma@benali-demo.ma', name: 'Salma Idrissi', role: 'COMPTABLE', passwordHash: await hashPassword(pass) },
        { email: 'youssef@benali-demo.ma', name: 'Youssef Alaoui', role: 'COMMERCIAL', passwordHash: await hashPassword(pass) },
      ] },
    },
    include: { users: true },
  });
  const admin = tenant.users.find((u) => u.role === 'ADMIN')!;
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: 'ADMIN', name: admin.name };
  const T = today();
  const ago = (n: number) => iso(addDays(T, -n))!;

  const clientsData = [
    ['Entreprise Atlas', 'Casablanca', 'contact@atlas-demo.ma', '0522 45 67 89'], ['SARL InnovTech', 'Rabat', 'info@innovtech-demo.ma', '0537 22 18 40'],
    ['BTP Services', 'Tanger', 'admin@btp-demo.ma', '0539 31 00 12'], ['Riad Prestige', 'Marrakech', 'contact@riad-demo.ma', '0524 38 90 11'],
    ['Sahara Logistique', 'Agadir', 'ops@sahara-demo.ma', '0528 84 21 07'], ['Café Atlas', 'Fès', 'gerant@cafe-demo.ma', '0535 62 14 55'],
    ['Médina Design', 'Casablanca', 'studio@medina-demo.ma', '0522 98 76 54'], ['Hôtel Océan', 'Essaouira', 'direction@ocean-demo.ma', '0524 47 20 33'],
    ['Clinique Nour', 'Meknès', 'admin@nour-demo.ma', '0535 51 77 08'], ['Auto École Centre', 'Rabat', 'contact@autoecole-demo.ma', '0537 68 12 90'],
  ];
  const clients = [];
  for (const [name, city, email, phone] of clientsData) clients.push(await prisma.client.create({ data: { tenantId: tenant.id, name, city, email, phone } }));
  const suppliersData = [
    ['Maroc Bureautique', 'Fournitures', 'ventes@bureautique-demo.ma', '0522 30 11 22'], ['Atlas Cloud Hosting', 'Services IT', 'support@cloud-demo.ma', '0537 70 55 10'],
    ['Cabinet Fiduciaire Amal', 'Comptabilité', 'cabinet@amal-demo.ma', '0522 41 09 87'], ['Transports du Nord', 'Logistique', 'contact@tnord-demo.ma', '0539 94 33 21'],
    ['Matériaux Souss', 'Fournitures', 'commandes@souss-demo.ma', '0528 22 61 40'],
  ];
  const suppliers = [];
  for (const [name, category, email, phone] of suppliersData) suppliers.push(await prisma.supplier.create({ data: { tenantId: tenant.id, name, category, email, phone } }));

  const productsData: [string, string, number, number, number, number, boolean?][] = [
    ['Ordinateur portable Pro 14', 'Informatique', 30, 5, 6500, 8200], ['Écran 27 pouces', 'Informatique', 4, 5, 1800, 2400],
    ['Imprimante laser', 'Informatique', 0, 2, 2100, 2900], ['Licence logiciel de gestion', 'Logiciel', 40, 5, 900, 1500],
    ['Routeur Wi-Fi 6', 'Réseau', 20, 4, 650, 990], ['Câble réseau Cat6 (30 m)', 'Réseau', 60, 10, 120, 210],
    ['Ramette papier A4', 'Fournitures', 25, 20, 38, 55], ['Onduleur 1500 VA', 'Électricité', 8, 3, 1400, 1950],
    ['Clavier et souris sans fil', 'Informatique', 30, 6, 220, 349], ['Disque SSD 1 To', 'Informatique', 3, 5, 750, 1090],
    ['Maintenance informatique (jour)', 'Prestation', 0, 0, 0, 2500, true], ['Développement sur mesure (jour)', 'Prestation', 0, 0, 0, 4000, true],
    ['Formation équipe (jour)', 'Prestation', 0, 0, 0, 3000, true],
  ];
  const products: { id: string; name: string; salePrice: number; purchasePrice: number }[] = [];
  for (const [i, [name, category, stock, alert, pa, pv, service]] of productsData.entries()) {
    const p = await prisma.product.create({
      data: { tenantId: tenant.id, ref: `P-${String(i + 1).padStart(3, '0')}`, name, category, unit: service ? 'jour' : 'u', isService: !!service, stock, alertThreshold: alert, purchasePrice: pa * 100, salePrice: pv * 100 },
    });
    if (stock) await prisma.stockMovement.create({ data: { tenantId: tenant.id, productId: p.id, kind: 'IN', qty: stock, reason: 'Stock initial', userId: admin.id, date: addDays(T, -175) } });
    products.push(p);
  }
  const line = (pi: number, qty: number) => ({ productId: products[pi].id, designation: products[pi].name, qty, unitPrice: products[pi].salePrice, tvaRate: 20 });
  const pay = (id: string, amount: number, date: string, method: PayMethod = 'VIREMENT') => docs.addPayment(ctx, id, { date, amount, method });

  // Factures des 6 derniers mois (croissance régulière), la plupart payées.
  const plan: [number, number, [number, number][]][] = [];
  // Du plus ancien au plus récent : numérotation dans l'ordre des dates, activité en croissance.
  for (let i = 0; i <= 5; i++) {
    const base = 170 - i * 30;
    plan.push([base, i % 10, [[10, 2 + i], [8, 1]]]);
    plan.push([base - 8, (i + 2) % 10, [[0, 1 + Math.floor(i / 2)], [8, 1]]]);
    plan.push([base - 16, (i + 4) % 10, [[11, 1 + i]]]);
    plan.push([base - 22, (i + 7) % 10, [[3, 2 + Math.floor(i / 2)], [12, 1]]]);
  }
  let k = 0;
  for (const [daysAgo, ci, ls] of plan) {
    if (daysAgo < 0) continue;
    const f = await docs.create(ctx, 'FACTURE', { clientId: clients[ci].id, date: ago(daysAgo), subject: ['Maintenance informatique', 'Équipement bureau', 'Développement sur mesure', 'Licences et formation'][k % 4], lines: ls.map(([pi, q]) => line(pi, q)) });
    const d = await prisma.document.findUniqueOrThrow({ where: { id: f.id } });
    k++;
    if (daysAgo > 20 || k % 3 !== 0) await pay(f.id, d.totalTTC, ago(Math.max(0, daysAgo - 12)), k % 4 === 0 ? 'CHEQUE' : k % 5 === 0 ? 'ESPECES' : 'VIREMENT');
    else if (k % 2 === 0) await pay(f.id, Math.round(d.totalTTC / 2), ago(Math.max(0, daysAgo - 3)));
  }

  // Devis à différents stades, dont un converti en BL puis en facture.
  const q1 = await docs.create(ctx, 'DEVIS', { clientId: clients[3].id, date: ago(4), subject: 'Refonte du site web', lines: [line(11, 4), line(12, 1)] });
  await docs.setStatus(ctx, q1.id, 'ENVOYE');
  const q2 = await docs.create(ctx, 'DEVIS', { clientId: clients[0].id, date: ago(8), subject: 'Maintenance annuelle', lines: [line(10, 3)] });
  await docs.setStatus(ctx, q2.id, 'ACCEPTE');
  await docs.create(ctx, 'DEVIS', { clientId: clients[6].id, date: ago(11), subject: 'Pack poste de travail', lines: [line(0, 2), line(1, 2), line(8, 2)] });
  const q4 = await docs.create(ctx, 'DEVIS', { clientId: clients[2].id, date: ago(20), subject: 'Logiciel de suivi chantier', lines: [line(11, 6)] });
  await docs.setStatus(ctx, q4.id, 'REFUSE');
  const q5 = await docs.create(ctx, 'DEVIS', { clientId: clients[8].id, date: ago(6), subject: 'Équipement accueil', lines: [line(0, 2), line(4, 1), line(7, 1)] });
  await docs.setStatus(ctx, q5.id, 'ACCEPTE');
  await docs.convert(ctx, q5.id, 'BL');
  const q6 = await docs.create(ctx, 'DEVIS', { clientId: clients[7].id, date: ago(15), subject: 'Wifi et caisse hôtel', lines: [line(4, 3), line(5, 4)] });
  await docs.setStatus(ctx, q6.id, 'ACCEPTE');
  const bl = await docs.convert(ctx, q6.id, 'BL');
  await docs.setStatus(ctx, bl.id, 'LIVRE');
  await docs.convert(ctx, bl.id, 'FACTURE');

  // Commandes fournisseurs.
  const pline = (pi: number, qty: number) => ({ productId: products[pi].id, designation: products[pi].name, qty, unitPrice: products[pi].purchasePrice, tvaRate: 20 });
  const b1 = await docs.create(ctx, 'BC', { supplierId: suppliers[0].id, date: ago(25), subject: 'Ramettes et accessoires', lines: [pline(6, 40), pline(8, 10)] });
  await docs.setStatus(ctx, b1.id, 'RECU');
  const b1d = await prisma.document.findUniqueOrThrow({ where: { id: b1.id } });
  await pay(b1.id, b1d.totalTTC, ago(20));
  const b2 = await docs.create(ctx, 'BC', { supplierId: suppliers[4].id, date: ago(9), subject: 'Lot câblage réseau', lines: [pline(5, 30), pline(4, 5)] });
  await docs.setStatus(ctx, b2.id, 'RECU');
  await docs.create(ctx, 'BC', { supplierId: suppliers[0].id, date: ago(2), subject: 'Écrans et SSD', lines: [pline(1, 6), pline(9, 8)] });

  // Dépenses mensuelles.
  for (let m = 5; m >= 0; m--) {
    const b = m * 30 + 25;
    const ex: [string, string, number, number | null, PayMethod][] = [
      ['Loyer du bureau', 'Loyer', 600000, null, 'VIREMENT'], ['Hébergement et logiciels', 'Services', 152000, 1, 'CARTE'],
      ['Honoraires comptables', 'Services', 220000, 2, 'VIREMENT'], ['Carburant et déplacements', 'Transport', 90000 + (5 - m) * 8000, 3, 'ESPECES'],
      ['Téléphonie et internet', 'Autres', 70000, null, 'VIREMENT'],
    ];
    for (const [i, [label, category, amount, si, method]] of ex.entries()) {
      if (b - i * 4 < 0) continue;
      await prisma.expense.create({
        data: { tenantId: tenant.id, date: addDays(T, -(b - i * 4)), label, category, amount, tvaAmount: category === 'Loyer' ? 0 : Math.round(amount / 6), supplierId: si == null ? null : suppliers[si].id, method },
      });
    }
  }
  await prisma.cashOp.create({ data: { tenantId: tenant.id, date: addDays(T, -9), label: 'Apport en caisse', type: 'IN', amount: 200000 } });
  await prisma.activity.create({ data: { tenantId: tenant.id, kind: 'client', title: 'Espace de démonstration créé', sub: 'Données d\'exemple' } });
  console.log(`  démo créée : demo@minzflow.ma (admin), salma@benali-demo.ma (comptable), youssef@benali-demo.ma (commercial) — mot de passe : ${pass}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
