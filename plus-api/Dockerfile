FROM rust:1-slim-bookworm AS api-builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY plus-api/Cargo.toml plus-api/Cargo.lock* ./
COPY plus-api/src ./src
COPY plus-api/migrations ./migrations
RUN cargo build --release

FROM golang:1.24-bookworm
# Wine + Inno Setup: o cliente do RustDesk (Windows) é compilado a partir de um
# .iss (ver installer/rustdesk-plus.iss) via ISCC, que só existe para Windows —
# roda sob Wine dentro deste container Linux. xvfb porque o instalador do
# próprio Inno Setup abre janelas mesmo em modo silencioso.
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xvfb wine wine32 \
    && rm -rf /var/lib/apt/lists/*

ARG INNOSETUP_VERSION=6.3.3
RUN curl -fsSL -o /tmp/innosetup.exe "https://files.jrsoftware.org/is/6/innosetup-${INNOSETUP_VERSION}.exe" \
    && xvfb-run -a wine /tmp/innosetup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="Z:\opt\innosetup" \
    && rm -f /tmp/innosetup.exe

ENV WINE_BIN=wine
ENV ISCC_PATH=/opt/innosetup/ISCC.exe
WORKDIR /app

COPY --from=api-builder /app/target/release/plus-api ./plus-api
COPY plus-api/migrations ./migrations

COPY agent/go.mod agent/main.go ./build-src/agent/
COPY installer/rustdesk-plus.iss ./build-src/installer/rustdesk-plus.iss

RUN cd /app/build-src/agent && go mod download \
    && mkdir -p /app/generated

ENV INSTALLER_SOURCE_DIR=/app/build-src
ENV INSTALLER_PATH=/app/generated/rustdesk-installer.exe
ENV RUSTDESK_KEY_PATH=/rustdesk-data/id_ed25519.pub
ENV DEPLOYMENT_HOST_PATH=/deployment/public_host

EXPOSE 21114
CMD ["./plus-api"]
