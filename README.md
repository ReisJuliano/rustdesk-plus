<div align="center">

# RustDesk Plus

**Painel de gerenciamento self-hosted multi-tenant para RustDesk — com servidor embutido**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8.svg)](https://go.dev)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org)

Suba o servidor RustDesk completo (`hbbs` + `hbbr`) e o painel de administração com um único comando.
Gerencie múltiplos clientes (tenants) em um único servidor — cada um com seus próprios dispositivos, usuários, filiais e senha de acesso remoto.

</div>

---

## O que é o RustDesk Plus

O RustDesk Plus é uma solução self-hosted multi-tenant que combina:

- **Servidor RustDesk** (`hbbs` + `hbbr`) — embutido no stack Docker, compartilhado entre todos os clientes
- **Multi-tenancy** — cada cliente enxerga apenas seus próprios dispositivos, usuários e configurações
- **API de gerenciamento** (`plus-api`) — backend Rust/Axum com isolamento por tenant
- **Dashboard web** — interface Next.js 15 com painel separado para super admin e para cada cliente
- **Agente Windows** — processo leve em Go que mantém conexão WebSocket permanente com o servidor
- **Instalador `.exe` por cliente** — gerado automaticamente com senha exclusiva por tenant

---

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Multi-tenant** | N clientes num único servidor; dados, usuários e senha completamente isolados |
| **Super Admin** | Visão global de todos os clientes; acesso ao painel de cada um com um clique |
| **Servidor RustDesk embutido** | `hbbs` e `hbbr` sobem no mesmo `docker compose up` |
| **Instalador por cliente** | `.exe` gerado com a senha exclusiva do cliente; cache invalidado automaticamente |
| **Senha de acesso remoto** | 8 chars A-Z0-9, gerada automaticamente por tenant, visível nas Configurações |
| **Auto-registro de dispositivos** | PCs aparecem no painel automaticamente ao conectar ao servidor |
| **Auto-filial por IP** | Dispositivos na mesma rede herdam a filial automaticamente (por tenant) |
| **Dashboard em tempo real** | Stats por cliente: dispositivos, online/offline, filiais, usuários |
| **3 modos de visualização** | Grid / Lista / Compacto na página de Dispositivos |
| **Tags coloridas** | Tags ilimitadas por tenant para organizar e filtrar dispositivos |
| **Filiais hierárquicas** | Estrutura de filiais com suporte a pai/filho, por tenant |
| **Terminal remoto** | Execute CMD/PowerShell em múltiplos dispositivos; super admin filtra por cliente |
| **Controle de usuários** | Papéis: `admin`, `operator`, `viewer` por tenant |
| **Serviço Windows** | Instalador configura RustDesk como serviço auto-start no Windows |

---

## Arquitetura

```
 Cliente RustDesk (oficial, sem modificações)
         │
         │  /api/heartbeat?tid=<tenant_id>  ──────────────────────────────┐
         │  /api/sysinfo?tid=<tenant_id>    ──────────────────────────────┤
         │                                                                 │
         │  21116 (sinalização)      ┌──────────────────────────────────────────┐
         ├──────────────────────────►│             plus-api                     │
         │                           │           (Rust / Axum)                  │
         │  21117 (relay)            │                                          │
         └──────────────────────────►│  • multi-tenant (tenant_id em tudo)      │
                                     │  • auto-registro + auto-filial           │
  ┌──────────────────────┐           │  • CRUD devices / branches / users       │
  │  hbbs (rendezvous)   │           │  • tags + execução remota                │
  │  hbbr (relay)        │           │  • instalador .exe por tenant            │
  │  (AGPL-3.0)          │           │  • PostgreSQL 16                         │
  │  portas: 21115–21119 │           └──────────────────────┬───────────────────┘
  └──────────────────────┘                                  │
              ▲                                             │  REST / JSON
              │ mesma rede Docker                           ▼
              └─────────────────────────┌──────────────────────────────────────┐
                                        │           dashboard                  │
                                        │       (Next.js 15 / React 19)        │
                                        │  porta 80 (via nginx gateway)        │
                                        └──────────────────────────────────────┘
  PC gerenciado
  ┌───────────────────────────────┐
  │  rustdesk-agent.exe (Go)      │──────────────────────► plus-api :21114
  │  WebSocket /ws/agent?tid=...  │
  └───────────────────────────────┘
```

O gateway Nginx roteia:
- `/admin/*`, `/api/*`, `/ws/*`, `/setup/*`, `/health`, `/super/*` → `plus-api:21114`
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

## Instalação Rápida

### Pré-requisitos

- Servidor Linux com Docker Engine e Docker Compose v2 (ou `docker-compose` standalone)
- Portas abertas: `80/tcp` (ou outra via `WEB_PORT`), `21115/tcp`, `21116/tcp+udp`, `21117/tcp`, `21118/tcp`, `21119/tcp`

### Via script (recomendado)

```bash
git clone https://github.com/ReisJuliano/rustdesk-plus.git
cd rustdesk-plus
chmod +x install.sh
./install.sh
```

O script `install.sh`:
1. Instala Docker Engine e Docker Compose se ainda não estiverem presentes (detecta `docker compose` e `docker-compose`)
2. Detecta o IP público do servidor automaticamente
3. Gera `POSTGRES_PASSWORD` e `JWT_SECRET` aleatórios com `openssl rand -hex 32`
4. Cria o arquivo `.env` com todos os valores
5. Cria os diretórios de volumes
6. Executa `docker compose up -d --build`
7. Exibe a URL de acesso

### Manual (passo a passo)

```bash
git clone https://github.com/ReisJuliano/rustdesk-plus.git
cd rustdesk-plus

cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
WEB_PORT=80
PUBLIC_HOST=IP_OU_DOMINIO_DO_SERVIDOR
PUBLIC_API_URL=http://IP_OU_DOMINIO_DO_SERVIDOR
EOF

mkdir -p data/rustdesk data/deployment data/generated plus-data/postgres
echo -n "IP_OU_DOMINIO_DO_SERVIDOR" > data/deployment/public_host

docker compose up -d --build
```

---

## Primeiro Acesso — Setup

Ao abrir o painel pela primeira vez, um wizard guiado solicita:

| Campo | Descrição |
|---|---|
| **Seu nome** | Nome do super admin |
| **Nome da empresa (primeiro cliente)** | Cria automaticamente o primeiro tenant |
| **IP / domínio público** | IP do servidor para o hbbs e o instalador |
| **URL pública da API** | URL base da API (ex: `http://meuservidor.com`) |
| **Email e senha** | Credenciais do super admin (mínimo 8 chars) |

Após o setup, o super admin tem acesso ao painel completo.

---

## Papéis de Usuário

| Papel | Descrição |
|---|---|
| `super_admin` | Acesso global — gerencia todos os tenants, vê o painel de qualquer cliente |
| `admin` | Administrador de um tenant — CRUD completo dentro do seu tenant |
| `operator` | Operador — pode executar comandos e ver dispositivos |
| `viewer` | Somente leitura |

O `super_admin` não pertence a nenhum tenant específico. Ao entrar no painel de um cliente, opera com o contexto daquele tenant (header `X-Tenant-Id` enviado automaticamente).

---

## Gestão de Clientes (Multi-tenant)

### Criar novo cliente

1. Logue como super admin
2. Menu **Clientes** → **+ Novo cliente**
3. Preencha nome e slug
4. O sistema gera automaticamente uma senha de acesso remoto exclusiva para o cliente

### Acessar o painel de um cliente

1. Menu **Clientes** → clique em **Entrar** no card do cliente
2. Um banner amarelo no topo indica qual cliente você está visualizando
3. Todo o painel (dispositivos, terminal, filiais, usuários, configuração) fica scoped para esse cliente
4. Clique em **Sair do cliente** para voltar à visão global

### Adicionar PCs ao cliente

1. Entre no painel do cliente (passo acima)
2. Menu **Configuração** → **Baixar instalador (.exe)**
3. Execute o `.exe` nos PCs do cliente como Administrador

O instalador faz automaticamente:
- Baixa e instala o RustDesk oficial (se necessário)
- Configura o servidor (IP, chave pública, api-server com tenant_id)
- Define a senha de acesso remoto exclusiva do cliente
- Instala o RustDesk como serviço Windows (auto-start, sobrevive a reboots)
- Instala o `rustdesk-agent.exe` como tarefa agendada do Windows

### Senha de acesso remoto

Cada cliente tem uma senha de 8 caracteres (A-Z0-9), gerada automaticamente.

- **Visível em**: Configuração → "Senha Padrão de Acesso Remoto"
- **Embutida no instalador**: o `.exe` de cada cliente já vem com a senha configurada
- **Usada na conexão**: o botão "Conectar" no dashboard abre `rustdesk://<id>?password=<senha>` automaticamente

---

## Variáveis de Ambiente

| Variável | Obrigatório | Padrão | Descrição |
|---|---|---|---|
| `JWT_SECRET` | sim | — | Segredo para assinatura JWT (mínimo 32 caracteres) |
| `POSTGRES_PASSWORD` | sim | `plusapi` | Senha do PostgreSQL |
| `PUBLIC_HOST` | recomendado | — | IP ou domínio público do servidor |
| `PUBLIC_API_URL` | recomendado | — | URL pública da API (ex: `http://meuservidor.com`) |
| `WEB_PORT` | não | `80` | Porta HTTP do gateway Nginx |

---

## Estrutura do Projeto

```
rustdesk-plus/
│
├── compose.yaml                     # Ponto de entrada
├── docker-compose.plus.yml          # Definição dos 6 serviços
├── install.sh                       # Script de instalação one-liner
│
├── deploy/
│   ├── nginx.conf                   # Gateway: roteia /admin /api /ws /setup /super → plus-api
│   └── rustdesk-server/
│       ├── Dockerfile               # Extrai hbbs/hbbr da imagem oficial + Alpine
│       └── hbbs-entrypoint.sh       # Aguarda o IP; reinicia hbbs se o IP mudar
│
├── plus-api/                        # Backend Rust
│   ├── Dockerfile
│   ├── Cargo.toml
│   ├── migrations/
│   │   ├── 0001_init.sql
│   │   ├── 0002_add_device_fields.sql
│   │   ├── 0003_device_enhancements.sql
│   │   ├── 0004_tags_and_exec.sql
│   │   └── 0005_multi_tenancy.sql   # tenants, tenant_config, tenant_id em tudo
│   └── src/
│       ├── main.rs
│       ├── auth.rs                  # JWT com tenant_id; super_admin role
│       ├── config.rs                # Config global + senha por tenant
│       ├── installer.rs             # Build .exe por tenant com cache
│       ├── models.rs
│       ├── state.rs                 # Mapa de agentes com chave {tenant_id}:{uuid}
│       └── routes/
│           ├── admin.rs             # CRUD scoped por tenant; /super/tenants para super admin
│           ├── client.rs            # /api/heartbeat e /api/sysinfo com tenant_id
│           ├── agent.rs             # WebSocket /ws/agent com tenant_id
│           └── setup.rs             # Cria primeiro tenant + super admin
│
├── dashboard/                       # Frontend Next.js 15
│   └── src/app/(protected)/
│       ├── tenants/                 # Gestão de clientes (super admin)
│       ├── dashboard/               # Visão global (super admin) ou por tenant
│       ├── devices/                 # Dispositivos do tenant ativo
│       ├── terminal/                # Terminal com seletor de cliente (super admin)
│       ├── branches/                # Filiais & Tags do tenant
│       ├── users/                   # Usuários do tenant
│       └── settings/                # Config global (super admin) + senha do tenant
│
├── agent/                           # Agente Windows (Go) — envia tenant_id no WS
├── installer/                       # Instalador Windows (Go + Win32)
└── data/                            # Volumes de runtime (gitignore)
```

---

## API Reference

Todas as rotas autenticadas exigem:
```
Authorization: Bearer <token>
```

Rotas de tenant (admin/operator/viewer) exigem adicionalmente, quando chamadas por super admin:
```
X-Tenant-Id: <uuid-do-tenant>
```

### Super Admin

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/super/tenants` | Lista todos os tenants com stats |
| `POST` | `/super/tenants` | `{ name, slug }` — cria tenant |
| `DELETE` | `/super/tenants/:id` | Remove tenant e todos os dados (cascade) |

### Autenticação e Setup

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/admin/login` | `{ email, password }` |
| `GET` | `/setup/status` | Verifica se o sistema já foi configurado |
| `POST` | `/setup` | `{ email, password, name, server_ip, api_url, tenant_name }` |
| `GET` | `/health` | Health check |

### Dispositivos, Usuários, Filiais, Tags, Exec

Todas as rotas `/admin/*` já documentadas na v1.0 continuam funcionando, agora filtradas por tenant automaticamente.

---

## Atualização do Servidor

```bash
cd rustdesk-plus
git pull origin main
docker-compose up -d --build
```

O banco de dados é atualizado automaticamente pelas migrations SQLx. Volumes (`plus-data/postgres`, `data/`) são preservados.

---

## Segurança

- **Senhas** armazenadas com Argon2id
- **JWT HS256** com `tenant_id` embutido no token; expiração de 7 dias
- **Isolamento de tenant** garantido em todas as queries SQL com `WHERE tenant_id = $N`
- **Super admin** identificado por `role = 'super_admin'` no JWT com `tenant_id = NULL`
- **Senha de acesso remoto** por tenant — um cliente não conhece a senha do outro
- **`JWT_SECRET`** e **`POSTGRES_PASSWORD`** gerados com `openssl rand -hex 32`

---

## Créditos

| | |
|---|---|
| **[@ReisJuliano](https://github.com/ReisJuliano)** | Desenvolvimento e manutenção |
| **[@darkbebs](https://github.com/darkbebs)** | Ideia original |

---

## Licença

MIT (c) 2026 Contribuidores do RustDesk Plus — veja [LICENSE](LICENSE)

---

> **Aviso legal:** Este projeto não tem afiliação com o projeto RustDesk oficial nem com a Purslane Ltd. O cliente RustDesk e o servidor (`hbbs`/`hbbr`) são licenciados sob AGPL-3.0. O RustDesk Plus é um serviço completamente independente que se comunica com eles via HTTP sem modificar nenhum código original. Os binários `hbbs` e `hbbr` são obtidos diretamente da imagem Docker oficial `rustdesk/rustdesk-server` sem alterações.
