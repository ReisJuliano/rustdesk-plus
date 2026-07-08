# Build via GitHub Actions (recomendado)

Compila o cliente RustDesk com branding num **runner Windows do GitHub** (grátis,
16 GB / 4 cores — o mesmo ambiente do CI oficial do RustDesk). O `plus-api` dispara
o workflow, faz polling e baixa o `.exe` pronto. Sem manter servidor de build.

## Como funciona

```
Dashboard (tenant) → plus-api
  → POST workflow_dispatch (build-plain.yml) com inputs: appname, server, key, apiServer, icon_url, custom...
  → polling do run (GET .../actions/runs)
  → baixa o artifact (.exe) via API
  → cacheia branded-{tenant}.exe → serve em /install/{code} e /i/{code}
```

O `build-plain.yml` é uma versão "plain" do `generator-windows.yml` do rdgen:
mesma receita testada (branding, engine, bridge, vcpkg, build.py, empacotamento),
mas **sem** o acoplamento ao servidor Django do rdgen — a config chega por **inputs
simples** e o resultado sai como **artifact** do Actions.

> A senha do tenant NÃO vai para o CI. Ela continua injetada no install, pelo
> instalador Go, via `RustDesk2.toml`. O `key` do servidor é público (já vai em
> todo cliente), então pode aparecer nos inputs/logs sem risco.

## Setup (uma vez)

1. **Fork** de [`wztx/rustdesk-client`](https://github.com/wztx/rustdesk-client)
   (ou `bryangerlach/rdgen`) na sua conta — pode deixar **privado**. Esse repo já
   traz os workflows reutilizáveis que o build precisa: `bridge.yml` e
   `third-party-RustDeskTempTopMostWindow.yml`.

2. Copie **`build-plain.yml`** (deste diretório) para `.github/workflows/` do fork
   e commite.

3. Em **Settings → Actions → General**, habilite Actions (botão verde, se pedido).

4. Crie um **fine-grained token** (Settings → Developer settings → Personal access
   tokens → Fine-grained): acesso só ao repo do fork, permissão **Actions: Read and
   write** (e **Contents: Read**). Guarde o token.

5. Configure o `plus-api` (`.env`) — ver variáveis abaixo.

## Config no plus-api (`.env`)

```
CLIENT_BUILDER_ENABLED=true
CLIENT_BUILDER_BACKEND=github            # github | ssh (ssh = build.ps1, fallback)
CLIENT_BUILDER_GH_REPO=SEU_USER/rustdesk-client
CLIENT_BUILDER_GH_WORKFLOW=build-plain.yml
CLIENT_BUILDER_GH_REF=master             # branch onde está o workflow
CLIENT_BUILDER_GH_TOKEN=github_pat_...    # token fine-grained (NUNCA commitar)
CLIENT_BUILDER_RUSTDESK_REF=1.4.8        # tag do RustDesk a compilar
```

Nada disso é hardcoded no código: tudo em env, opt-in (feature some do dashboard se
`CLIENT_BUILDER_ENABLED=false`). Seguro para repositório público.

## Inputs do workflow (`build-plain.yml`)

| Input | Obrig. | Descrição |
|---|---|---|
| `version` | sim | Tag do RustDesk (ex.: 1.4.8) |
| `appname` | sim | Nome de exibição do app |
| `filename` | sim | Nome-base do `.exe` final |
| `server` | sim | Host do servidor RustDesk (embutido) |
| `key` | sim | Chave pública do servidor (embutida) |
| `apiServer` | sim | API server embutido (use `.../t/{tenant_id}`) |
| `compname` | não | Empresa (copyright / "Sobre") |
| `urlLink` | não | URL do site |
| `icon_url` | não | URL de um PNG (256x256) para o ícone |
| `custom` | não | Conteúdo do `custom_.txt` (configs travadas) |

## Fallback

O `build.ps1` + `setup-windows.ps1` deste projeto continuam válidos para buildar
localmente (PC Windows ou uma instância maior) via SSH, caso não queira usar o
GitHub Actions. Veja o README principal de `tools/rustdesk-builder/`.
