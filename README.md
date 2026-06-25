<div align="center">

# RustDesk Plus

**Painel de gerenciamento self-hosted para RustDesk — com servidor embutido**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8.svg)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org)

Suba o servidor RustDesk completo (`hbbs` + `hbbr`) e o painel de administração com um único comando.
Gerencie todos os seus dispositivos em tempo real: filiais, tags, execução remota de comandos e instalador `.exe` gerado automaticamente.

</div>

---

## O que é o RustDesk Plus

O RustDesk Plus é uma solução self-hosted completa que combina:

- **Servidor RustDesk** (`hbbs` + `hbbr`) — embutido no stack Docker, nenhuma instalação separada necessária
- **API de gerenciamento** (`plus-api`) — backend Rust/Axum que se comunica com os clientes RustDesk e expõe uma API REST para o painel
- **Dashboard web** — interface Next.js 15 para administrar dispositivos, usuários, filiais e executar comandos remotos
- **Agente Windows** — processo leve em Go que mantém conexão WebSocket permanente com o servidor, habilitando o terminal remoto
- **Instalador `.exe`** — gerado automaticamente com as configurações do seu servidor; basta executar em cada PC

A arquitetura mantém o `hbbs`/`hbbr` sem modificações (AGPL-3.0), enquanto o `plus-api` é um serviço completamente independente que implementa as rotas HTTP opcionais chamadas pelo cliente RustDesk quando a opção `api-server` está configurada.

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Servidor RustDesk embutido** | `hbbs` e `hbbr` sobem no mesmo `docker compose up` |
| **Auto-registro de dispositivos** | PCs aparecem no painel automaticamente ao conectar ao servidor |
| **Auto-filial por IP** | Dispositivos na mesma rede herdam a filial automaticamente |
| **Dashboard em tempo real** | Totais de dispositivos, online/offline, filiais e usuários |
| **Cards de dispositivos** | Status, IP, SO detectado, RustDesk ID, uptime online, tags |
| **3 modos de visualização** | Grid / Lista / Compacto |
| **Tags coloridas** | Tags ilimitadas para organizar e filtrar qualquer dispositivo |
| **Filiais hierárquicas** | Estrutura de filiais com suporte a pai/filho |
| **Terminal remoto** | Execute CMD/PowerShell em múltiplos dispositivos via WebSocket |
| **Seleção por tag** | Envie um comando para todos os dispositivos de uma tag de uma vez |
| **Instalador `.exe` automático** | Gerado no servidor com suas configurações; janela Win32 nativa |
| **Controle de usuários** | Papéis: `admin`, `operator`, `viewer` |
| **Favoritos** | Marque dispositivos importantes |
| **Setup guiado** | Primeiro acesso cria o admin e configura o servidor pelo browser |

---

## Arquitetura

```
 Cliente RustDesk (oficial, sem modificações)
         │
         │  /api/heartbeat  ─────────────────────────────────────────┐
         │  /api/sysinfo    ─────────────────────────────────────────┤
         │  (opcionais, só se api-server estiver configurado)        │
         │                                                           ▼
         │  21116 (sinalização)      ┌──────────────────────────────────────┐
         ├──────────────────────────►│           plus-api                   │
         │                           │         (Rust / Axum)                │
         │  21117 (relay)            │                                      │
         └──────────────────────────►│  • auto-registro + auto-filial       │
                                     │  • CRUD devices / branches / users   │
  ┌──────────────────────┐           │  • tags + execução remota            │
  │  hbbs (rendezvous)   │           │  • geração do instalador .exe        │
  │  hbbr (relay)        │           │  • PostgreSQL 16                     │
  │                      │           └─────────────────┬────────────────────┘
  │  RustDesk Server     │                             │
  │  (AGPL-3.0)          │                             │  REST / JSON
  │  portas: 21115–21119 │                             ▼
  └──────────────────────┘           ┌──────────────────────────────────────┐
              ▲                      │           dashboard                  │
              │ mesma rede Docker    │       (Next.js 15 / React 19)        │
              └──────────────────────┤  porta 80 (via nginx gateway)        │
                                     └──────────────────────────────────────┘

  PC gerenciado
  ┌───────────────────────────────┐
  │  rustdesk-agent.exe (Go)      │
  │  WebSocket ─► /ws/agent       │──────────────────────► plus-api :21114
  │  executa CMD/PowerShell       │
  └───────────────────────────────┘
```

O gateway Nginx (incluído no Compose) roteia:
- `/admin/*`, `/api/*`, `/ws/*`, `/setup/*`, `/health` → `plus-api:21114`
- Todo o resto → `dashboard:3000`

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Rust 1.75+ · Axum 0.7 · SQLx 0.7 · Argon2id · JWT HS256 |
| Banco de dados | PostgreSQL 16 (Alpine) |
| Frontend | Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 |
| Agente | Go 1.24 · gorilla/websocket |
| Instalador | Go 1.24 · Win32 API nativa (user32/gdi32/comctl32) |
| Servidor RustDesk | hbbs + hbbr (imagem oficial `rustdesk/rustdesk-server`) |
| Infra | Docker Compose · Nginx 1.27 |

---

## Instalacao Rapida

### Pre-requisitos

- Servidor Linux com Docker Engine e Docker Compose v2
- Portas abertas: `80/tcp` (ou outra via `WEB_PORT`), `21115/tcp`, `21116/tcp+udp`, `21117/tcp`, `21118/tcp`, `21119/tcp`

### Via script (recomendado)

```bash
git clone https://github.com/ReisJuliano/rustdesk-plus.git
cd rustdesk-plus
chmod +x install.sh
./install.sh
```

O script `install.sh`:
1. Instala Docker Engine e Docker Compose se ainda nao estiverem presentes (requer `apt-get`)
2. Detecta o IP publico do servidor automaticamente
3. Gera `POSTGRES_PASSWORD` e `JWT_SECRET` aleatorios com `openssl rand -hex 32`
4. Cria o arquivo `.env` com todos os valores
5. Cria os diretorios de volumes (`data/rustdesk`, `data/deployment`, `data/generated`, `plus-data/postgres`)
6. Executa `docker compose up -d --build`
7. Exibe a URL de acesso e a lista de portas para liberar no firewall

Ao final, acesse a URL exibida no terminal. O **primeiro acesso** abre o wizard de configuracao que cria o usuario administrador.

### Manual (passo a passo)

```bash
git clone https://github.com/ReisJuliano/rustdesk-plus.git
cd rustdesk-plus

# Crie o arquivo de configuracao
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
WEB_PORT=80
PUBLIC_HOST=IP_OU_DOMINIO_DO_SERVIDOR
PUBLIC_API_URL=http://IP_OU_DOMINIO_DO_SERVIDOR
EOF

# Crie os diretorios de dados
mkdir -p data/rustdesk data/deployment data/generated plus-data/postgres

# Grave o host para o hbbs
echo -n "IP_OU_DOMINIO_DO_SERVIDOR" > data/deployment/public_host

# Suba tudo
docker compose up -d --build
```

Acesse `http://IP_DO_SERVIDOR` e complete o setup pelo browser.

---

## Variaveis de Ambiente

As variaveis abaixo vao no arquivo `.env` na raiz do projeto.

| Variavel | Obrigatorio | Padrao | Descricao |
|---|---|---|---|
| `JWT_SECRET` | sim | — | Segredo para assinatura JWT (minimo 32 caracteres) |
| `POSTGRES_PASSWORD` | sim | `plusapi` | Senha do PostgreSQL |
| `PUBLIC_HOST` | recomendado | — | IP ou dominio publico do servidor (usado pelo hbbs e pelo setup) |
| `PUBLIC_API_URL` | recomendado | — | URL publica da API (ex: `http://meuservidor.com`) |
| `WEB_PORT` | nao | `80` | Porta HTTP do gateway Nginx |

Variaveis internas dos containers (nao precisam estar no `.env`):

| Variavel | Padrao | Descricao |
|---|---|---|
| `DATABASE_URL` | gerada pelo Compose | Connection string PostgreSQL |
| `BIND_ADDR` | `0.0.0.0:21114` | Endereco de bind da plus-api |
| `RUSTDESK_KEY_PATH` | `/rustdesk-data/id_ed25519.pub` | Caminho da chave publica do hbbr |
| `DEPLOYMENT_HOST_PATH` | `/deployment/public_host` | Arquivo com o IP publico para o hbbs |
| `INSTALLER_PATH` | `/generated/rustdesk-installer.exe` | Caminho do instalador gerado |

---

## Como Adicionar Dispositivos

### Opcao A — Instalador automatico (recomendado)

1. No dashboard, va em **Configuracoes**
2. Preencha o IP do servidor e a chave publica (lidos automaticamente se o servidor ja estiver rodando)
3. Clique em **Baixar instalador.exe**
4. Execute o arquivo em cada PC Windows como **Administrador**
5. O dispositivo aparece no painel em instantes

O instalador faz tudo automaticamente:
- Baixa o RustDesk oficial caso nao esteja instalado
- Configura `RustDesk2.toml` apontando para o seu servidor (IP, chave, api-server)
- Instala e inicia o `rustdesk-agent.exe` como tarefa agendada do Windows
- Exibe janela Win32 nativa com barra de progresso (sem dependencias externas)

O `.exe` e gerado no container `plus-api` na primeira vez que voce clicar em "Baixar" (ou quando as configuracoes mudarem). O build usa cross-compilation Go dentro do container — nao e necessario nenhuma ferramenta no seu PC.

### Opcao B — Configuracao manual do RustDesk

Edite `%APPDATA%\RustDesk\config\RustDesk2.toml` em cada PC:

```toml
rendezvous_server = 'SEU_SERVIDOR:21116'
nat_type = 1
serial = 0

[options]
key = 'CHAVE_PUBLICA_DO_SERVIDOR'
custom-rendezvous-server = 'SEU_SERVIDOR'
relay-server = 'SEU_SERVIDOR'
api-server = 'http://SEU_SERVIDOR'
```

Reinicie o RustDesk. O dispositivo aparece no painel em ate 30 segundos.

> A chave publica esta em `data/rustdesk/id_ed25519.pub` apos a primeira execucao do hbbr.

---

## Agente de Execucao Remota

O terminal remoto do dashboard requer o `rustdesk-agent.exe` instalado em cada PC.
Ao usar o instalador automatico (Opcao A acima), o agente ja e instalado e configurado automaticamente.

Para instalar o agente manualmente:

```bash
# Cross-compile de Linux ou macOS para Windows
cd agent
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-s -w -H=windowsgui -X main.apiURL=http://SEU_SERVIDOR" \
  -o rustdesk-agent.exe .
```

Instale no PC como tarefa agendada (Administrator):

```powershell
$dir = "C:\Program Files\RustDesk Plus"
New-Item -ItemType Directory -Force $dir
Copy-Item rustdesk-agent.exe "$dir\rustdesk-agent.exe"
schtasks /create /tn "RustDeskPlusAgent" /tr "$dir\rustdesk-agent.exe" `
  /sc onstart /ru SYSTEM /f
schtasks /run /tn "RustDeskPlusAgent"
```

O agente:
- Conecta ao `plus-api` via WebSocket (`/ws/agent?uuid=...&hostname=...&rustdesk_id=...`)
- Registra o dispositivo no banco automaticamente
- Aguarda comandos do painel e retorna o output linha a linha em tempo real
- Reconecta automaticamente em caso de queda

---

## Deploy em Producao

### Com dominio proprio (HTTPS)

O gateway Nginx embutido escuta na porta definida por `WEB_PORT` (padrao 80). Para HTTPS recomenda-se colocar um reverse proxy externo (Nginx, Caddy, Traefik) na frente.

Exemplo com Nginx externo e Let's Encrypt:

```nginx
server {
    listen 443 ssl http2;
    server_name painel.seudominio.com;

    ssl_certificate     /etc/letsencrypt/live/seudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seudominio.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Necessario para WebSocket (terminal remoto)
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
        proxy_read_timeout 3600s;
    }
}
```

Atualize o `.env` antes de rebuildar:

```env
PUBLIC_HOST=painel.seudominio.com
PUBLIC_API_URL=https://painel.seudominio.com
```

```bash
docker compose up -d --build
```

### Portas do servidor RustDesk

| Porta | Protocolo | Servico |
|---|---|---|
| 21115 | TCP | hbbs — teste de tipo NAT |
| 21116 | TCP+UDP | hbbs — registro e heartbeat de peers |
| 21117 | TCP | hbbr — relay de conexao |
| 21118 | TCP | hbbs — WebSocket (clientes web) |
| 21119 | TCP | hbbr — WebSocket (clientes web) |

Todas essas portas devem estar abertas no firewall do servidor.

### Como o hbbs descobre o IP publico

O container `hbbs` aguarda o arquivo `/deployment/public_host` ser gravado antes de iniciar.
Esse arquivo e preenchido automaticamente pelo `plus-api` a partir de:
1. A variavel `PUBLIC_HOST` do `.env` (na subida inicial)
2. O campo "IP do servidor" salvo nas Configuracoes do painel

Se o IP mudar, basta atualizar nas Configuracoes — o `hbbs` reinicia automaticamente.

---

## Estrutura do Projeto

```
rustdesk-plus/
│
├── compose.yaml                     # Ponto de entrada (inclui docker-compose.plus.yml)
├── docker-compose.plus.yml          # Definicao dos 6 servicos
├── install.sh                       # Script de instalacao one-liner
│
├── deploy/
│   ├── nginx.conf                   # Gateway: roteia /admin /api /ws /setup -> plus-api
│   └── rustdesk-server/
│       ├── Dockerfile               # Extrai hbbs/hbbr da imagem oficial + Alpine
│       └── hbbs-entrypoint.sh       # Aguarda o IP; reinicia hbbs se o IP mudar
│
├── plus-api/                        # Backend Rust
│   ├── Dockerfile                   # Multi-stage: rust:slim -> golang:bookworm
│   ├── Cargo.toml
│   ├── migrations/
│   │   ├── 0001_init.sql            # branches, users, devices, sessions_log
│   │   ├── 0002_add_device_fields.sql
│   │   ├── 0003_device_enhancements.sql  # ip_address, online_since
│   │   └── 0004_tags_and_exec.sql   # tags, device_tags, exec_jobs, exec_results
│   └── src/
│       ├── main.rs                  # Bootstrap admin, offline sweeper, bind
│       ├── auth.rs                  # Argon2id + JWT HS256
│       ├── config.rs                # Leitura/escrita server_config + chave ed25519
│       ├── installer.rs             # Build do .exe via go build cross-compile
│       ├── models.rs                # Structs SQLx
│       ├── state.rs                 # AppState { db, agents, installer_build }
│       ├── error.rs                 # AppError -> IntoResponse
│       └── routes/
│           ├── admin.rs             # CRUD + stats + tags + exec + download instalador
│           ├── client.rs            # /api/heartbeat /api/sysinfo (protocolo RustDesk)
│           ├── agent.rs             # WebSocket /ws/agent
│           └── setup.rs             # /setup/status + /setup (primeiro acesso)
│
├── dashboard/                       # Frontend Next.js 15
│   ├── Dockerfile
│   └── src/
│       ├── lib/
│       │   ├── api.ts               # Cliente HTTP tipado (todos os endpoints)
│       │   └── auth.ts              # Token em localStorage
│       └── app/
│           ├── login/               # Tela de login
│           └── (protected)/
│               ├── layout.tsx       # Navbar + guarda de autenticacao
│               ├── dashboard/       # Stats em tempo real
│               ├── devices/         # Cards + modal de edicao + tags + 3 views
│               ├── terminal/        # Execucao CMD/PowerShell em massa
│               ├── branches/        # CRUD de filiais e tags (abas)
│               ├── users/           # CRUD de usuarios
│               └── settings/        # Configuracao do servidor + download do instalador
│
├── agent/                           # Agente Windows (Go)
│   ├── main.go                      # WebSocket + exec CMD/PowerShell + reconnect
│   └── go.mod
│
├── installer/                       # Instalador Windows (Go + Win32)
│   ├── main.go                      # Janela nativa, barra de progresso, agente embutido
│   └── go.mod
│
├── data/                            # Volumes de runtime (gitignore)
│   ├── rustdesk/                    # Chaves ed25519 do hbbr, banco do hbbs
│   ├── deployment/                  # public_host (compartilhado com hbbs)
│   └── generated/                   # rustdesk-installer.exe gerado
│
├── plus-data/
│   └── postgres/                    # Dados do PostgreSQL
│
├── rustdesk-server/                 # Submodulo — codigo-fonte do hbbs/hbbr (referencia)
└── rustdesk-client/                 # Submodulo — codigo-fonte do cliente (referencia)
```

---

## API Reference

Todas as rotas autenticadas exigem o header:

```
Authorization: Bearer <token>
```

O token e obtido em `POST /admin/login` ou `POST /setup`.

### Autenticacao e Setup

| Metodo | Rota | Body | Descricao |
|---|---|---|---|
| `POST` | `/admin/login` | `{ email, password }` | Login de administrador |
| `GET` | `/setup/status` | — | Verifica se o sistema ja foi configurado |
| `POST` | `/setup` | `{ email, password, name, server_ip, api_url }` | Primeiro acesso: cria admin |
| `GET` | `/health` | — | Health check (`ok`) |

### Dispositivos

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/admin/devices` | Lista — query: `branch_id`, `search`, `online`, `favorite` |
| `GET` | `/admin/devices/:id` | Detalhes do dispositivo |
| `PATCH` | `/admin/devices/:id` | `{ alias?, description? }` |
| `DELETE` | `/admin/devices/:id` | Remove |
| `POST` | `/admin/devices/:id/branch` | `{ branch_id }` — atribui filial |
| `POST` | `/admin/devices/:id/favorite` | Toggle favorito |
| `GET` | `/admin/devices/:id/tags` | Lista tags do dispositivo |
| `POST` | `/admin/devices/:id/tags` | `{ tag_id }` — adiciona tag |
| `DELETE` | `/admin/devices/:id/tags/:tag_id` | Remove tag do dispositivo |
| `GET` | `/admin/device-tags` | Todas as relacoes device <-> tag |

### Tags

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/admin/tags` | Lista todas as tags |
| `POST` | `/admin/tags` | `{ name, color }` — cria tag |
| `DELETE` | `/admin/tags/:id` | Remove tag |

### Filiais

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/admin/branches` | Lista filiais |
| `POST` | `/admin/branches` | `{ name, parent_id? }` — cria filial |
| `DELETE` | `/admin/branches/:id` | Remove filial |

### Usuarios

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/admin/users` | Lista usuarios |
| `POST` | `/admin/users` | `{ email, password, name, role }` — cria usuario |
| `DELETE` | `/admin/users/:id` | Remove usuario |

Papeis validos para `role`: `admin`, `operator`, `viewer`.

### Sistema

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/admin/stats` | `{ total_devices, online_devices, offline_devices, total_branches, total_users }` |
| `GET` | `/admin/server-config` | Le configuracao do servidor |
| `POST` | `/admin/server-config` | `{ server_ip, server_key, api_url }` — salva |
| `GET` | `/admin/installer` | Download do `rustdesk-installer.exe` (gerado sob demanda) |

### Terminal Remoto

| Metodo | Rota | Descricao |
|---|---|---|
| `POST` | `/admin/exec` | `{ cmd, powershell?, targets?, tag_id? }` — dispara comando |
| `GET` | `/admin/exec/:job_id` | Resultados por dispositivo (polling) |
| `WS` | `/ws/agent` | Conexao do agente — query: `uuid`, `hostname?`, `rustdesk_id?`, `os?` |

### Rotas do protocolo RustDesk (cliente oficial)

| Metodo | Rota | Descricao |
|---|---|---|
| `POST` | `/api/heartbeat` | Auto-registro, captura IP, heranca de filial por IP |
| `POST` | `/api/sysinfo` | Atualiza hostname, SO, IP do dispositivo |
| `POST` | `/api/sysinfo_ver` | Retorna versao (stub: `"1"`) |
| `GET` | `/api/login-options` | Retorna `[]` |
| `POST` | `/api/login` | Stub (login de conta nao habilitado) |
| `POST` | `/api/logout` | Stub |
| `POST` | `/api/currentUser` | Stub |
| `POST` | `/api/ab/get` | Address book (stub: `{"data":"[]"}`) |
| `POST` | `/api/ab` | Address book set (stub) |

---

## Seguranca

- **Senhas** armazenadas com Argon2id (OWASP recomendado, resistente a ataques de GPU)
- **JWT HS256** com expiracao de 7 dias; hash de senha nunca serializado nas respostas
- **Roles** `admin` / `operator` / `viewer` com controle de acesso por papel
- **IP real** extraido de `X-Forwarded-For` / `X-Real-IP` (compativel com Nginx)
- **`JWT_SECRET`** e **`POSTGRES_PASSWORD`** gerados com `openssl rand -hex 32` pelo `install.sh`
- O setup (`/setup`) bloqueia novas requisicoes apos o primeiro administrador ser criado

Boas praticas para producao:
- Nunca exponha a porta `21114` diretamente; deixe o Nginx fazer o proxy
- Use HTTPS com certificado valido (Let's Encrypt / Certbot)
- Mantenha o `.env` fora do controle de versao (esta no `.gitignore`)
- Rotacione o `JWT_SECRET` periodicamente (invalida todos os tokens ativos)

---

## Banco de Dados

O esquema e criado automaticamente pelas migrations SQLx na inicializacao do `plus-api`.

```
branches          — filiais (hierarquicas via parent_id)
users             — administradores/operadores/viewers
user_branch_access — acesso de usuarios a filiais especificas
devices           — dispositivos registrados (auto-cadastro via heartbeat)
sessions_log      — historico de sessoes (para futuras implementacoes)
tags              — tags coloridas
device_tags       — relacao N:N entre devices e tags
exec_jobs         — trabalhos de execucao remota
exec_results      — resultados por dispositivo (saida acumulada + exit code)
server_config     — configuracao do servidor (server_ip, server_key, api_url)
```

---

## Desenvolvimento Local

### Requisitos

- Docker Desktop (WSL2 no Windows)
- Go 1.24+ (para o agente/instalador)
- Node.js 20+ (para o dashboard)
- Rust 1.75+ (opcional, apenas para compilar fora do Docker)

### Subir o backend

```bash
docker compose up -d --build
# A API estara em http://localhost:21114
# O painel estara em http://localhost:80
```

### Rodar o dashboard em modo dev

```bash
cd dashboard
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:21114" > .env.local
npm run dev
# Acesse http://localhost:3000
```

### Testar a API com curl

```bash
# Health check
curl http://localhost:21114/health

# Login (se ja tiver feito o setup)
curl -s -X POST http://localhost:21114/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@exemplo.com","password":"suasenha"}' | jq .

# Simular heartbeat de um dispositivo
curl -s -X POST http://localhost:21114/api/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"id":"123456789","uuid":"test-uuid-pc-01"}' | jq .
```

### Build do instalador manualmente

```bash
# No diretorio raiz do projeto (requer Go 1.24 e acesso ao agente compilado)
cd agent
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-s -w -H=windowsgui -X main.apiURL=http://SEU_IP" \
  -o ../installer/rustdesk-agent.exe .

cd ../installer
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-s -w -H=windowsgui -X main.serverIP=SEU_IP -X main.serverKey=SUA_CHAVE -X main.apiURL=http://SEU_IP" \
  -o rustdesk-installer.exe .
```

---

## Contribuindo

1. Faca um fork do repositorio
2. Crie uma branch descritiva: `git checkout -b feat/nome-da-feature`
3. Commit seguindo Conventional Commits: `git commit -m 'feat: adiciona suporte a X'`
4. Push: `git push origin feat/nome-da-feature`
5. Abra um Pull Request com descricao clara do que foi feito e por que

Para mudancas grandes (nova funcionalidade, refatoracao de arquitetura), abra uma issue primeiro para alinharmos a abordagem.

---

## Creditos

| | |
|---|---|
| **[@ReisJuliano](https://github.com/ReisJuliano)** | Desenvolvimento e manutenção |
| **[@darkbebs](https://github.com/darkbebs)** | Ideia original |

---

## Licenca

MIT (c) 2026 Contribuidores do RustDesk Plus — veja [LICENSE](LICENSE)

---

> **Aviso legal:** Este projeto nao tem afiliacao com o projeto RustDesk oficial nem com a Purslane Ltd. O cliente RustDesk e o servidor (`hbbs`/`hbbr`) sao licenciados sob AGPL-3.0. O RustDesk Plus e um servico completamente independente que se comunica com eles via HTTP sem modificar nenhum codigo original — o que o mantem fora do escopo da AGPL. Os binarios `hbbs` e `hbbr` sao obtidos diretamente da imagem Docker oficial `rustdesk/rustdesk-server` sem alteracoes.
