# Pin the official multi-arch image so a stale or moved `latest` tag cannot
# silently change the filesystem layout used by this build.
FROM rustdesk/rustdesk-server:1.1.15@sha256:10818ec05b179039c6660f4d8e74b303f0db2858bbad2b18e24992ea22d54cd6 AS upstream

FROM alpine:3.20
RUN apk add --no-cache tini

RUN mkdir -p /usr/local/bin
# The official classic image installs both static binaries under /usr/bin.
COPY --from=upstream /usr/bin/hbbs /usr/local/bin/hbbs
COPY --from=upstream /usr/bin/hbbr /usr/local/bin/hbbr
COPY deploy/rustdesk-server/hbbs-entrypoint.sh /usr/local/bin/hbbs-entrypoint
RUN chmod +x /usr/local/bin/hbbs /usr/local/bin/hbbr /usr/local/bin/hbbs-entrypoint

ENTRYPOINT ["/sbin/tini", "--"]
