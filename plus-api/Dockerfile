FROM rust:1-slim-bookworm AS api-builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY plus-api/Cargo.toml plus-api/Cargo.lock* ./
COPY plus-api/src ./src
COPY plus-api/migrations ./migrations
RUN cargo build --release

FROM golang:1.24-bookworm
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=api-builder /app/target/release/plus-api ./plus-api
COPY plus-api/migrations ./migrations

COPY agent/go.mod agent/main.go ./build-src/agent/
COPY installer/go.mod installer/main.go ./build-src/installer/

RUN cd /app/build-src/agent && go mod download \
    && cd /app/build-src/installer && go mod download \
    && mkdir -p /app/generated

ENV INSTALLER_SOURCE_DIR=/app/build-src
ENV INSTALLER_PATH=/app/generated/rustdesk-installer.exe
ENV RUSTDESK_KEY_PATH=/rustdesk-data/id_ed25519.pub
ENV DEPLOYMENT_HOST_PATH=/deployment/public_host

EXPOSE 21114
CMD ["./plus-api"]
