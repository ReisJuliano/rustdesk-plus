#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

COMPOSE_MODE=""

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

prompt() {
  variable="$1"
  label="$2"
  default="$3"
  eval "current=\${$variable:-}"
  [ -n "$current" ] && return
  if [ ! -t 0 ]; then
    [ -n "$default" ] || die "$variable precisa ser informado no modo não interativo."
    eval "$variable=\$default"
    return
  fi
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$label" "$default"
  else
    printf '%s: ' "$label"
  fi
  IFS= read -r answer
  eval "$variable=\${answer:-\$default}"
}

prompt_optional() {
  variable="$1"
  label="$2"
  eval "current=\${$variable:-}"
  [ -n "$current" ] && return
  [ -t 0 ] || { eval "$variable="; return; }
  printf '%s: ' "$label"
  IFS= read -r answer
  eval "$variable=\$answer"
}

confirm() {
  variable="$1"
  label="$2"
  default="$3"
  eval "current=\${$variable:-}"
  [ -n "$current" ] && return
  if [ ! -t 0 ]; then
    eval "$variable=\$default"
    return
  fi
  if [ "$default" = "true" ]; then suffix="S/n"; else suffix="s/N"; fi
  printf '%s [%s]: ' "$label" "$suffix"
  IFS= read -r answer
  case "$answer" in
    s|S|sim|SIM|Sim) eval "$variable=true" ;;
    n|N|nao|não|NAO|NÃO) eval "$variable=false" ;;
    *) eval "$variable=\$default" ;;
  esac
}

detect_compose() {
  if command -v docker >/dev/null 2>&1 && $SUDO docker compose version >/dev/null 2>&1; then
    COMPOSE_MODE="plugin"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_MODE="standalone"
  fi
}

compose() {
  if [ "$COMPOSE_MODE" = "plugin" ]; then
    $SUDO docker compose "$@"
  else
    $SUDO docker-compose "$@"
  fi
}

install_dependencies() {
  detect_compose
  if [ -n "$COMPOSE_MODE" ] && command -v curl >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1 \
    && command -v ufw >/dev/null 2>&1 && command -v crontab >/dev/null 2>&1; then
    return
  fi
  command -v apt-get >/dev/null 2>&1 || die "Use Ubuntu/Debian ou instale Docker Compose, curl e OpenSSL manualmente."
  say "Instalando dependências"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl openssl ca-certificates ufw cron
  $SUDO systemctl enable --now docker
  $SUDO systemctl enable --now cron
  detect_compose
  [ -n "$COMPOSE_MODE" ] || die "Docker Compose não foi encontrado após a instalação."
}

random_secret() { openssl rand -hex 32; }

valid_domain() {
  echo "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' && echo "$1" | grep -q '\.'
}

configure_firewall() {
  [ "$CONFIGURE_FIREWALL" = "true" ] || return
  command -v ufw >/dev/null 2>&1 || die "UFW não está instalado."
  say "Configurando firewall"
  if [ -n "$SSH_SOURCE" ]; then
    $SUDO ufw allow from "$SSH_SOURCE" to any port 22 proto tcp
  else
    $SUDO ufw allow 22/tcp
    printf 'AVISO: SSH foi liberado para qualquer origem. Restrinja a porta 22 no firewall da nuvem.\n'
  fi
  $SUDO ufw allow 80/tcp
  $SUDO ufw allow 443/tcp
  $SUDO ufw allow 443/udp
  $SUDO ufw allow 21115/tcp
  $SUDO ufw allow 21116/tcp
  $SUDO ufw allow 21116/udp
  $SUDO ufw allow 21117/tcp
  $SUDO ufw allow 21118/tcp
  $SUDO ufw allow 21119/tcp
  $SUDO ufw --force enable
}

configure_operations() {
  [ "$CONFIGURE_BACKUP" = "true" ] || return
  say "Configurando backup diário e rotação do log"
  mkdir -p backups
  chmod 700 backups
  project_dir=$(pwd)
  cron_line="17 2 * * * cd $project_dir && RETENTION_DAYS=$BACKUP_RETENTION_DAYS ./deploy/operations/backup.sh >> $project_dir/backups/backup.log 2>&1"
  ($SUDO crontab -l 2>/dev/null | grep -Fv './deploy/operations/backup.sh' || true; printf '%s\n' "$cron_line") | $SUDO crontab -
  $SUDO sh -c "cat > /etc/logrotate.d/rustdesk-plus-audit" <<EOF
$project_dir/data/audit/hbbr.log {
    daily
    rotate 30
    size 100M
    missingok
    notifempty
    copytruncate
    compress
    delaycompress
}
EOF
}

install_dependencies

printf '\nRustDesk Plus — instalação limpa de produção\n'
printf 'Cada execução prepara uma nova empresa com banco e chaves próprios.\n\n'

prompt COMPANY_NAME "Nome da empresa" ""
prompt DOMAIN "Domínio completo do painel" ""
prompt ADMIN_EMAIL "E-mail do administrador (para o relatório)" ""
confirm AGENT_ENABLED "Ativar agente de gerenciamento" "false"
confirm CLIENT_BUILDER_ENABLED "Ativar cliente customizado" "false"
confirm CONFIGURE_FIREWALL "Configurar o firewall UFW" "true"
confirm CONFIGURE_BACKUP "Configurar backup diário" "true"
prompt BACKUP_RETENTION_DAYS "Dias de retenção dos backups" "30"
prompt_optional SSH_SOURCE "Rede/IP autorizado para SSH (vazio libera para qualquer origem)"

[ -n "$COMPANY_NAME" ] || die "Informe o nome da empresa."
valid_domain "$DOMAIN" || die "Informe um domínio válido, por exemplo rustdesk.empresa.com.br."
echo "$ADMIN_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "Informe um e-mail válido."
echo "$BACKUP_RETENTION_DAYS" | grep -Eq '^[1-9][0-9]*$' || die "A retenção precisa ser um número positivo."

if [ -f .env ]; then
  die "Já existe um arquivo .env. Este instalador é exclusivo para instalações limpas."
fi
if [ -d plus-data/postgres ] && [ "$(find plus-data/postgres -mindepth 1 -print -quit 2>/dev/null)" ]; then
  die "O banco local já contém dados. Use uma VPS nova ou remova os dados conscientemente."
fi

say "Validando DNS"
resolved_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')
public_ip=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)
[ -n "$resolved_ip" ] || die "O domínio ainda não possui um registro DNS A válido."
if [ -n "$public_ip" ] && [ "$resolved_ip" != "$public_ip" ]; then
  die "O domínio aponta para $resolved_ip, mas esta VPS usa $public_ip. Corrija o DNS antes de continuar."
fi

umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=$(random_secret)
JWT_SECRET=$(random_secret)
PUBLIC_HOST=$DOMAIN
PUBLIC_API_URL=https://$DOMAIN
AGENT_ENABLED=$AGENT_ENABLED
CADDY_ADDR=$DOMAIN
WEB_BIND=0.0.0.0
WEB_PORT=80
HTTPS_BIND=0.0.0.0
HTTPS_PORT=443
CLIENT_BUILDER_ENABLED=$CLIENT_BUILDER_ENABLED
CLIENT_BUILDER_GH_REPO=
CLIENT_BUILDER_GH_WORKFLOW=build-plain.yml
CLIENT_BUILDER_GH_REF=master
CLIENT_BUILDER_GH_TOKEN=
CLIENT_BUILDER_RUSTDESK_REF=1.4.8
CLIENT_BUILDER_STORAGE=local
EOF

mkdir -p data/rustdesk data/deployment data/generated data/audit plus-data/postgres backups
printf '%s' "$DOMAIN" > data/deployment/public_host
chmod 700 plus-data/postgres backups

configure_firewall
configure_operations

say "Construindo e iniciando os serviços"
compose up -d --build

say "Executando diagnóstico"
if ! ./deploy/operations/healthcheck.sh "https://$DOMAIN"; then
  printf '\nOs containers iniciaram, mas o diagnóstico ainda não passou.\n'
  printf 'Confira o DNS, as portas 80/443 e execute novamente: ./deploy/operations/healthcheck.sh https://%s\n' "$DOMAIN"
  exit 1
fi

cat > installation-report.txt <<EOF
RustDesk Plus — relatório de instalação
Empresa: $COMPANY_NAME
Administrador: $ADMIN_EMAIL
URL: https://$DOMAIN
Host RustDesk: $DOMAIN
Agente de gerenciamento: $AGENT_ENABLED
Cliente customizado: $CLIENT_BUILDER_ENABLED
Backup diário: $CONFIGURE_BACKUP
Retenção: $BACKUP_RETENTION_DAYS dias
Instalado em: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

Próximo passo: acesse a URL e conclua o primeiro cadastro pelo assistente.
Os segredos permanecem somente no arquivo .env desta VPS.
EOF
chmod 600 installation-report.txt

printf '\nInstalação concluída.\n'
printf 'Painel: https://%s\n' "$DOMAIN"
printf 'Relatório: %s/installation-report.txt\n' "$(pwd)"
printf 'Backup manual: ./deploy/operations/backup.sh\n'
printf 'Diagnóstico: ./deploy/operations/healthcheck.sh https://%s\n' "$DOMAIN"
