"use client";

import { useEffect, useRef, useState } from "react";
import {
  getBranding,
  saveBranding,
  uploadBrandingIcon,
  triggerBrandingBuild,
  brandingIconUrl,
  getServerConfig,
  downloadInstaller,
  type TenantBranding,
} from "@/lib/api";

type Form = {
  app_name: string;
  file_name: string;
  comp_name: string;
  url_link: string;
  rustdesk_ref: string;
  custom_config: string;
};

const EMPTY: Form = {
  app_name: "",
  file_name: "",
  comp_name: "",
  url_link: "",
  rustdesk_ref: "1.4.8",
  custom_config: "",
};

function StatusBadge({ status }: { status: TenantBranding["build_status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: "Não gerado", cls: "bg-slate-100 text-slate-600" },
    queued: { label: "Na fila", cls: "bg-amber-100 text-amber-700" },
    building: { label: "Compilando…", cls: "bg-blue-100 text-blue-700" },
    ready: { label: "Pronto", cls: "bg-green-100 text-green-700" },
    failed: { label: "Falhou", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status] ?? map.idle;
  return <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${s.cls}`}>{s.label}</span>;
}

export default function CustomClientPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [status, setStatus] = useState<TenantBranding["build_status"]>("idle");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [hasIcon, setHasIcon] = useState(false);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [savedIconUrl, setSavedIconUrl] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [installCode, setInstallCode] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [building, setBuilding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await getBranding();
    setEnabled(r.enabled);
    setHasIcon(r.has_icon);
    if (r.branding) {
      setForm({
        app_name: r.branding.app_name,
        file_name: r.branding.file_name,
        comp_name: r.branding.comp_name,
        url_link: r.branding.url_link,
        rustdesk_ref: r.branding.rustdesk_ref || "1.4.8",
        custom_config: r.branding.custom_config,
      });
      setStatus(r.branding.build_status);
      setBuildError(r.branding.build_error);
    }
    if (r.has_icon && r.branding) {
      setSavedIconUrl(brandingIconUrl(r.branding.tenant_id, r.branding.updated_at));
    } else {
      setSavedIconUrl(null);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"));
    getServerConfig()
      .then((c) => {
        setInstallCode(c.install_code || "");
        setApiBase((c.api_url || "").replace(/\/+$/, ""));
      })
      .catch(() => {});
  }, []);

  // Polling enquanto está compilando
  useEffect(() => {
    if (status !== "queued" && status !== "building") return;
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [status]);

  // Preview do arquivo recem-selecionado (antes de salvar)
  useEffect(() => {
    if (!iconFile) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function persist() {
    await saveBranding(form);
    if (iconFile) {
      await uploadBrandingIcon(iconFile);
      setIconFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setHasIcon(true);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await persist();
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onBuild() {
    setBuilding(true);
    setError(null);
    try {
      await persist();
      await triggerBrandingBuild();
      setStatus("queued");
      setBuildError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao disparar o build");
    } finally {
      setBuilding(false);
    }
  }

  async function onDownloadInstaller() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadInstaller();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "instalador.exe";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao baixar o instalador");
    } finally {
      setDownloading(false);
    }
  }

  // Prefixo de TLS 1.2: PowerShell antigo (Win 7/8/2012/2016) tenta TLS 1.0 e falha
  // no HTTPS moderno. Não desabilita validação de certificado.
  const installCmd =
    apiBase && installCode
      ? `[Net.ServicePointManager]::SecurityProtocol='Tls12'; irm ${apiBase}/i/${installCode} | iex`
      : "";

  function copyCmd() {
    if (!installCmd) return;
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (enabled === null) return <div className="p-6 text-sm text-slate-400">Carregando…</div>;

  if (!enabled) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-800">Cliente Customizado</h1>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          O gerador de cliente customizado está <strong>desabilitado</strong> neste servidor. Para
          habilitar, configure{" "}
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">CLIENT_BUILDER_*</code> no{" "}
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">.env</code>.
        </div>
      </div>
    );
  }

  const busy = status === "queued" || status === "building";
  const input =
    "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40";
  const label = "block text-sm font-medium text-slate-700";

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Cliente Customizado</h1>
        <StatusBadge status={status} />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {status === "failed" && buildError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Último build falhou: {buildError}
        </div>
      )}

      <form onSubmit={onSave} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Nome do app *</label>
            <input className={input} value={form.app_name} onChange={(e) => set("app_name", e.target.value)}
              placeholder="Acme Remote" required />
          </div>
          <div>
            <label className={label}>Nome do arquivo *</label>
            <input className={input} value={form.file_name} onChange={(e) => set("file_name", e.target.value)}
              placeholder="acme-remote" required />
          </div>
          <div>
            <label className={label}>Empresa</label>
            <input className={input} value={form.comp_name} onChange={(e) => set("comp_name", e.target.value)}
              placeholder="Acme TI" />
          </div>
          <div>
            <label className={label}>Site (URL)</label>
            <input className={input} value={form.url_link} onChange={(e) => set("url_link", e.target.value)}
              placeholder="https://acme.com" />
          </div>
          <div>
            <label className={label}>Versão do RustDesk</label>
            <input className={input} value={form.rustdesk_ref} onChange={(e) => set("rustdesk_ref", e.target.value)}
              placeholder="1.4.8" />
          </div>
          <div>
            <label className={label}>Ícone (PNG 256×256)</label>
            <div className="mt-1 flex items-center gap-3">
              {(filePreview || savedIconUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={filePreview || savedIconUrl || ""} alt="ícone"
                  className="h-12 w-12 rounded-lg border border-slate-200 object-contain bg-slate-50 flex-shrink-0" />
              )}
              <input ref={fileRef} type="file" accept="image/png"
                onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
                className="flex-1 min-w-0 text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200" />
            </div>
            {filePreview ? (
              <p className="mt-1 text-xs text-amber-600">Novo ícone selecionado — salve para aplicar</p>
            ) : hasIcon ? (
              <p className="mt-1 text-xs text-green-600">Ícone atual salvo ✓</p>
            ) : null}
          </div>
        </div>
        <div>
          <label className={label}>Configurações travadas (custom.txt)</label>
          <textarea className={`${input} font-mono`} rows={3} value={form.custom_config}
            onChange={(e) => set("custom_config", e.target.value)}
            placeholder="(opcional) settings avançados do RustDesk" />
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {saving ? "Salvando…" : "Salvar"}
          </button>
          {saved && <span className="text-sm text-green-600">Salvo ✓</span>}
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-slate-600">
            {busy
              ? "O build roda no GitHub Actions (~30–45 min). Esta página atualiza sozinha."
              : status === "ready"
              ? "Cliente com marca pronto. Distribua pelo instalador abaixo."
              : "Gere o cliente com a marca acima. O build roda no GitHub Actions."}
          </div>
          <button onClick={onBuild} disabled={building || busy}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex-shrink-0">
            {building ? "Disparando…" : busy ? "Compilando…" : "Gerar cliente"}
          </button>
        </div>

        {status === "ready" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-sm text-slate-700">
              <strong>Instale pelo instalador.</strong> Ele baixa o cliente com a sua marca, aplica a{" "}
              <strong>senha do tenant</strong> e registra o serviço — necessário para acesso
              desassistido. O binário sozinho não tem a senha.
            </p>
            <button onClick={onDownloadInstaller} disabled={downloading}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
              {downloading ? "Baixando…" : "Baixar instalador"}
            </button>
            {installCmd && (
              <div>
                <label className="block text-xs font-medium text-slate-500">
                  Ou instale por linha de comando (PowerShell como administrador)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                    {installCmd}
                  </code>
                  <button onClick={copyCmd}
                    className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50">
                    {copied ? "✓ Copiado" : "Copiar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
