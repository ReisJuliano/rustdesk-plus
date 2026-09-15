# Instalação limpa de produção

Este fluxo cria uma implantação isolada para uma nova empresa. Ele não importa
usuários, chaves, dispositivos nem histórico de outra instalação.

## Requisitos

- VPS nova com Ubuntu 24.04 LTS ou Debian compatível;
- mínimo sugerido de 2 vCPU, 4 GB de RAM e 40 GB de SSD;
- IP público fixo;
- domínio com registro `A` apontando para o IP público da VPS;
- acesso SSH com `sudo`;
- portas liberadas também no firewall do provedor de nuvem.

| Porta | Protocolo | Finalidade |
|---|---|---|
| 22 | TCP | SSH; restrinja ao IP/rede administrativa |
| 80 | TCP | HTTP e emissão do certificado |
| 443 | TCP/UDP | painel HTTPS |
| 21115 | TCP | RustDesk NAT test |
| 21116 | TCP/UDP | rendezvous e registro |
| 21117 | TCP | relay |
| 21118 | TCP | WebSocket |
| 21119 | TCP | WebSocket relay |

## Instalação interativa

```bash
git clone https://github.com/edsonfl1301/rustdesk-plus.git
cd rustdesk-plus
git checkout feat/connection-audit
chmod +x install-production.sh deploy/operations/*.sh
./install-production.sh
```

O instalador pergunta:

- nome da empresa;
- domínio do painel;
- e-mail do primeiro administrador;
- ativação do agente e do cliente customizado;
- firewall, backup e retenção;
- origem autorizada para SSH.

O e-mail é usado somente no relatório local. O primeiro usuário e sua senha são
criados no assistente exibido ao abrir o painel.

## Instalação automatizada

As mesmas opções podem ser informadas como variáveis, permitindo uso em
cloud-init ou pipelines:

```bash
sudo env \
  COMPANY_NAME="Empresa Exemplo" \
  DOMAIN="rustdesk.empresa.com.br" \
  ADMIN_EMAIL="admin@empresa.com.br" \
  AGENT_ENABLED=false \
  CLIENT_BUILDER_ENABLED=false \
  CONFIGURE_FIREWALL=true \
  CONFIGURE_BACKUP=true \
  BACKUP_RETENTION_DAYS=30 \
  SSH_SOURCE="203.0.113.10/32" \
  ./install-production.sh
```

O instalador encerra sem alterar a máquina quando o DNS não aponta para o IP
público detectado, quando já existe `.env` ou quando o volume do PostgreSQL não
está vazio.

## O que é configurado

- Docker Engine e Docker Compose;
- segredos aleatórios em `.env` com permissão restrita;
- PostgreSQL, `hbbs`, `hbbr`, API, dashboard e Caddy;
- HTTPS automático pelo Caddy;
- auditoria central das sessões que passam pelo relay;
- firewall UFW sem substituir o firewall da nuvem;
- rotação diária de `data/audit/hbbr.log`;
- backup diário às 02:17;
- diagnóstico dos seis serviços e da rota `/health`;
- `installation-report.txt` sem senhas.

## Backup

Execução manual:

```bash
./deploy/operations/backup.sh
```

Cada backup contém:

- dump PostgreSQL no formato custom;
- `.env`;
- chave pública/privada do servidor RustDesk;
- configuração de implantação;
- instaladores gerados;
- manifesto com data UTC.

Por conter segredos e chaves, copie a pasta `backups` para armazenamento externo
criptografado. O backup local não protege contra perda da VPS.

## Diagnóstico

```bash
./deploy/operations/healthcheck.sh https://rustdesk.empresa.com.br
```

O comando valida `postgres`, `hbbr`, `hbbs`, `plus-api`, `dashboard`, `gateway`
e o endpoint público de saúde.

## Primeiro acesso

1. Abra `https://dominio-configurado`.
2. Conclua o assistente e crie o super administrador.
3. Confirme a chave pública na tela de configuração.
4. Instale inicialmente em duas máquinas de teste.
5. Faça uma conexão que utilize o relay e confirme início, fim e duração na tela
   **Auditoria**.
6. Execute um backup manual e copie-o para fora da VPS antes da distribuição em
   massa.

## Operação

- mantenha o sistema e Docker atualizados;
- monitore espaço em disco e tráfego do relay;
- teste a restauração dos backups periodicamente;
- restrinja SSH no firewall da nuvem e no UFW;
- nunca publique `.env`, backups, chaves ou tokens no GitHub;
- faça atualizações primeiro em uma VPS de homologação.

