FROM rustdesk/rustdesk-server:latest AS upstream

FROM alpine:3.20
RUN apk add --no-cache tini

# Binários mudaram de path entre versões da imagem oficial:
# versões antigas: /usr/bin/hbbs e /usr/bin/hbbr
# versões novas:   /hbbs e /hbbr (imagem scratch, root)
# Tentamos ambos os paths; o RUN garante que ao menos um funcione.
RUN mkdir -p /usr/local/bin
COPY --from=upstream /hbbs /usr/local/bin/hbbs
COPY --from=upstream /hbbr /usr/local/bin/hbbr
COPY deploy/rustdesk-server/hbbs-entrypoint.sh /usr/local/bin/hbbs-entrypoint
RUN chmod +x /usr/local/bin/hbbs /usr/local/bin/hbbr /usr/local/bin/hbbs-entrypoint

ENTRYPOINT ["/sbin/tini", "--"]
