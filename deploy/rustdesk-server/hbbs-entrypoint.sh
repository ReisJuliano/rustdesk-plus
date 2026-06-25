#!/bin/sh
set -eu

CONFIG_FILE="${DEPLOYMENT_HOST_PATH:-/deployment/public_host}"
mkdir -p "$(dirname "$CONFIG_FILE")" /data

while true; do
  if [ ! -s "$CONFIG_FILE" ]; then
    echo "hbbs aguardando a configuração inicial pela interface..."
    sleep 3
    continue
  fi

  public_host="$(tr -d '\r\n ' < "$CONFIG_FILE")"
  echo "iniciando hbbs com relay ${public_host}:21117"
  cd /data
  /usr/local/bin/hbbs -r "${public_host}:21117" &
  pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    current_host="$(tr -d '\r\n ' < "$CONFIG_FILE" 2>/dev/null || true)"
    if [ "$current_host" != "$public_host" ]; then
      echo "configuração alterada; reiniciando hbbs..."
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      break
    fi
  done
done
