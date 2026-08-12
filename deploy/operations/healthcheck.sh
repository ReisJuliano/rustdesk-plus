#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
compose() {
  if $SUDO docker compose version >/dev/null 2>&1; then
    $SUDO docker compose "$@"
  else
    $SUDO docker-compose "$@"
  fi
}
PUBLIC_URL="${1:-${PUBLIC_API_URL:-}}"
[ -n "$PUBLIC_URL" ] || { echo "Uso: $0 https://painel.empresa.com.br" >&2; exit 2; }

failed=0
for service in postgres hbbr hbbs plus-api dashboard gateway; do
  container_id=$(compose ps -q "$service")
  if [ -z "$container_id" ] || [ "$($SUDO docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null)" != "true" ]; then
    printf 'FALHA  %s não está em execução\n' "$service"
    failed=1
  else
    printf 'OK     %s\n' "$service"
  fi
done

attempt=1
while [ "$attempt" -le 12 ]; do
  if curl -fsS --max-time 10 "$PUBLIC_URL/health" >/dev/null 2>&1; then
    printf 'OK     %s/health\n' "$PUBLIC_URL"
    break
  fi
  if [ "$attempt" -eq 12 ]; then
    printf 'FALHA  %s/health não respondeu\n' "$PUBLIC_URL"
    failed=1
  else
    sleep 5
  fi
  attempt=$((attempt + 1))
done

exit "$failed"
