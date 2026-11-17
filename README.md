# MizanFlow — ERP multi-entreprises

ERP en ligne pour PME marocaines : devis, bons de livraison, factures et avoirs, achats fournisseurs, stock,
trésorerie (caisse/banque), dépenses, bilan avec TVA, utilisateurs et rôles, assistant. Plusieurs entreprises
sur la même plateforme, chacune avec ses données isolées, son logo et sa couleur.

- **Front** : React 19 + Vite (`src/`), design repris de la maquette « MizanFlow — Démo ERP ».
- **API** : NestJS 11 + Prisma 6 + MariaDB (`backend/`). Montants en centimes, quantités en décimal.

## Comptes

- **Super-administrateur** (`/super`) : crée les entreprises (logo, couleur, ICE/RC/IF, coordonnées, compte admin),
  les suspend ou les supprime. Créé par `node dist/cli/bootstrap.js` à partir de `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.
- **Dans chaque entreprise** : Administrateur, Comptable, Commercial, Lecture seule (droits vérifiés côté API,
  `backend/src/common/access.ts`).

## Flux métier

- Devis → bon de livraison → facture (ou devis → facture). Le stock sort à la livraison du BL, ou à l'émission
  d'une facture directe. Une facture ne se supprime pas : on l'annule, ce qui crée un avoir (numérotation continue).
- Commande fournisseur → réception (entrée en stock) → règlements.
- Paiements partiels (espèces, chèque, virement, carte, effet) ; la trésorerie regroupe encaissements, règlements,
  dépenses et opérations manuelles.
- Documents imprimables en PDF (navigateur) avec logo, mentions légales, TVA par taux et montant en lettres.

## Développement local

```bash
cd backend && docker compose -p minzflow up -d        # MariaDB sur le port 3310
cp .env.example .env && npm install && npx prisma migrate dev
npm run build && node --env-file=.env dist/cli/bootstrap.js --demo
node --env-file=.env dist/main.js                      # API sur :3004
cd .. && npm install && API_URL=http://localhost:3004 npx vite --port 5177
```

## Production

`./scripts/deploy.sh` (hébergement cPanel, https://minzflow.mygympro.club). Le premier lancement affiche les accès
super-admin et le mot de passe de l'entreprise de démonstration.
