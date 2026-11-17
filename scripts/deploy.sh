#!/usr/bin/env bash
# Déploie MizanFlow sur l'hébergement cPanel Namecheap (même compte que GMBIJOUX) :
#   site  → ~/minzflow.mygympro.club          https://minzflow.mygympro.club
#   API   → ~/minzflow-api (app Node.js cPanel, URL /api)
# Premier lancement : crée la base MySQL, l'app Node.js, le .env (secrets aléatoires), le compte super-admin
# et l'entreprise de démonstration. Lancements suivants : met seulement le code à jour (.env et fichiers gardés).
#   ./scripts/deploy.sh
set -euo pipefail

DOMAIN=minzflow.mygympro.club
SITE_DIR=minzflow.mygympro.club
APP_DIR=minzflow-api
DB=gmbimeor_mizan
NODE_MAJOR=22
SSH_TARGET=gmbimeor@server71-1.web-hosting.com
SSH="ssh -i $HOME/.ssh/gmbijoux_deploy -p 21098 -o LogLevel=ERROR"

cd "$(dirname "$0")/.."

echo "▸ Construction du site et de l'API"
npm run build >/dev/null
(cd backend && npm run build >/dev/null)

echo "▸ Préparation du serveur (base, app Node.js, .env) — sans rien écraser"
FIRST=$($SSH "$SSH_TARGET" DOMAIN="$DOMAIN" APP_DIR="$APP_DIR" DB="$DB" NODE_MAJOR="$NODE_MAJOR" bash -se <<'EOF2'
set -euo pipefail
mkdir -p ~/$APP_DIR/prisma ~/$APP_DIR/tmp ~/$APP_DIR/uploads
if [ ! -f ~/$APP_DIR/.env ]; then
  DBPASS=$(openssl rand -hex 20)
  uapi Mysql create_database name=$DB >/dev/null
  uapi Mysql create_user name=$DB password=$DBPASS >/dev/null
  uapi Mysql set_privileges_on_database user=$DB database=$DB privileges='ALL PRIVILEGES' >/dev/null
  SUPER_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)
  umask 077
  cat > ~/$APP_DIR/.env <<ENV
NODE_ENV=production
DATABASE_URL="mysql://$DB:$DBPASS@127.0.0.1:3306/$DB?sslmode=disable"
JWT_SECRET="$(openssl rand -hex 32)"
FRONTEND_URL="https://$DOMAIN"
SUPERADMIN_EMAIL="admin@$DOMAIN"
SUPERADMIN_PASSWORD="$SUPER_PASS"
ENV
  echo first
fi
if [ ! -d ~/nodevenv/$APP_DIR ]; then
  cloudlinux-selector create --json --interpreter nodejs --version $NODE_MAJOR --app-root $APP_DIR \
    --domain $DOMAIN --app-uri api --app-mode production --startup-file dist/main.js >/dev/null
fi
EOF2
)

echo "▸ Envoi de l'API"
rsync -az --delete -e "$SSH" backend/dist/ "$SSH_TARGET:$APP_DIR/dist/"
rsync -az --delete -e "$SSH" backend/prisma/migrations/ "$SSH_TARGET:$APP_DIR/prisma/migrations/"
rsync -az -e "$SSH" backend/package.json backend/package-lock.json "$SSH_TARGET:$APP_DIR/"
rsync -az -e "$SSH" backend/prisma/schema.prisma "$SSH_TARGET:$APP_DIR/prisma/"

echo "▸ Envoi du site"
rsync -az --delete -e "$SSH" dist/assets/ "$SSH_TARGET:$SITE_DIR/assets/"
rsync -az --exclude assets -e "$SSH" dist/ "$SSH_TARGET:$SITE_DIR/"

echo "▸ Installation, migration de la base, redémarrage"
$SSH "$SSH_TARGET" APP_DIR="$APP_DIR" SITE_DIR="$SITE_DIR" NODE_MAJOR="$NODE_MAJOR" FIRST="$FIRST" bash -se <<'EOF2'
set -eo pipefail
source ~/nodevenv/$APP_DIR/$NODE_MAJOR/bin/activate
set -u
# Hébergement mutualisé : moteurs Prisma à 2 threads (limite de processus du compte).
export TOKIO_WORKER_THREADS=2
cd ~/$APP_DIR
npm install --omit=dev --no-audit --no-fund --loglevel=error
npx prisma generate >/dev/null
timeout 300 npx prisma migrate deploy
set -a; . ./.env; set +a
if [ "$FIRST" = "first" ]; then
  node dist/cli/bootstrap.js --demo
  echo "  ★ Super-admin : $SUPERADMIN_EMAIL / $SUPERADMIN_PASSWORD  (notez-le, il n'est affiché qu'une fois)"
else
  node dist/cli/bootstrap.js
fi
# cPanel crée le dossier api/ (config Passenger) en 700 : le serveur web ne peut pas le lire → /api en 404.
[ -d ~/$SITE_DIR/api ] && chmod 755 ~/$SITE_DIR/api && chmod 644 ~/$SITE_DIR/api/.htaccess
touch tmp/restart.txt
EOF2

echo "▸ Vérification"
for i in 1 2 3 4 5 6; do
  if curl -fsS "https://$DOMAIN/api/v1/health" >/dev/null 2>&1; then echo "✓ En ligne : https://$DOMAIN"; exit 0; fi
  sleep 10
done
echo "✗ L'API ne répond pas encore sur https://$DOMAIN/api/v1/health" >&2
exit 1
