#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

DOCKER_COMPOSE=""

detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
  fi
}

install_docker() {
  detect_compose
  if [ -n "$DOCKER_COMPOSE" ]; then
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
  detect_compose
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
  domain="${DOMAIN:-}"
  web_port="${WEB_PORT:-80}"

  # Determina CADDY_ADDR e URLs a partir do domínio (se fornecido)
  if [ -n "$domain" ]; then
    caddy_addr="$domain"
    api_url="https://${domain}"
    public_host="${public_host:-$domain}"
  else
    if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":${web_port} "; then
      web_port=8080
    fi
    caddy_addr=":${web_port}"
    api_url=""
    if [ -n "$public_host" ]; then
      api_url="http://${public_host}"
      if [ "$web_port" != "80" ]; then
        api_url="${api_url}:${web_port}"
      fi
    fi
  fi

  cat > .env <<EOF
POSTGRES_PASSWORD=$(random_secret)
JWT_SECRET=$(random_secret)
WEB_PORT=$web_port
PUBLIC_HOST=$public_host
PUBLIC_API_URL=$api_url
CADDY_ADDR=$caddy_addr
EOF
fi

mkdir -p data/rustdesk data/deployment data/generated plus-data/postgres

public_host="$(sed -n 's/^PUBLIC_HOST=//p' .env | tail -n 1)"
if [ -n "$public_host" ]; then
  printf "%s" "$public_host" > data/deployment/public_host
fi

$SUDO $DOCKER_COMPOSE up -d --build

caddy_addr="$(sed -n 's/^CADDY_ADDR=//p' .env | tail -n 1)"
public_url="$(sed -n 's/^PUBLIC_API_URL=//p' .env | tail -n 1)"
if [ -z "$public_url" ]; then
  public_url="http://IP-DO-SERVIDOR"
fi

echo
echo "RustDesk Plus está iniciando."
echo "Acesse: $public_url"
echo "O primeiro acesso conclui a configuração e cria o administrador."
echo
if echo "$caddy_addr" | grep -qv '^:'; then
  echo "HTTPS habilitado para: $caddy_addr"
  echo "O certificado Let's Encrypt será obtido automaticamente."
  echo "Portas necessárias: 80/tcp, 443/tcp"
else
  echo "Modo HTTP. Para habilitar HTTPS, defina CADDY_ADDR=seudominio.com no .env"
  echo "Porta web: ${caddy_addr#:}/tcp"
fi
echo
echo "Libere também no firewall:"
echo "  21115/tcp"
echo "  21116/tcp e 21116/udp"
echo "  21117/tcp"
echo "  21118/tcp"
echo "  21119/tcp"
