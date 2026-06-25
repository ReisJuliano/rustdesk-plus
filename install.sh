#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Instale Docker Engine e Docker Compose antes de continuar."
    exit 1
  fi

  echo "Instalando Docker..."
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
  $SUDO systemctl enable --now docker
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

detect_public_ip() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true
  fi
}

install_docker

if [ ! -f .env ]; then
  public_host="${PUBLIC_HOST:-$(detect_public_ip)}"
  web_port="${WEB_PORT:-80}"
  if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":${web_port} "; then
    web_port=8080
  fi

  api_url=""
  if [ -n "$public_host" ]; then
    api_url="http://${public_host}"
    if [ "$web_port" != "80" ]; then
      api_url="${api_url}:${web_port}"
    fi
  fi

  cat > .env <<EOF
POSTGRES_PASSWORD=$(random_secret)
JWT_SECRET=$(random_secret)
WEB_PORT=$web_port
PUBLIC_HOST=$public_host
PUBLIC_API_URL=$api_url
EOF
fi

mkdir -p data/rustdesk data/deployment data/generated plus-data/postgres

public_host="$(sed -n 's/^PUBLIC_HOST=//p' .env | tail -n 1)"
if [ -n "$public_host" ]; then
  printf "%s" "$public_host" > data/deployment/public_host
fi

$SUDO docker compose up -d --build

web_port="$(sed -n 's/^WEB_PORT=//p' .env | tail -n 1)"
public_url="$(sed -n 's/^PUBLIC_API_URL=//p' .env | tail -n 1)"
if [ -z "$public_url" ]; then
  public_url="http://IP-DO-SERVIDOR:${web_port:-80}"
fi

echo
echo "RustDesk Plus está iniciando."
echo "Abra: $public_url"
echo "O primeiro acesso conclui a configuração e cria o administrador."
echo
echo "Libere no firewall:"
echo "  ${web_port:-80}/tcp"
echo "  21115/tcp"
echo "  21116/tcp e 21116/udp"
echo "  21117/tcp"
echo "  21118/tcp"
echo "  21119/tcp"
