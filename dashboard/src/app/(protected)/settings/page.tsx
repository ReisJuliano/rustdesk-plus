"use client";

import { useEffect, useState } from "react";
import {
  downloadInstaller,
  getServerConfig,
  saveServerConfig,
  type ServerConfig,
} from "@/lib/api";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={copy}
      className="text-xs font-semibold text-blue-600 hover:text-blue-700 border border-slate-200 rounded-2xl px-3 py-1.5 hover:bg-blue-50 transition-colors"
    >
      {copied ? "✓ Copiado!" : "Copiar"}
    </button>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ServerConfig>({
    server_ip: "",
    server_key: "",
    api_url: "",
    rustdesk_password: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    getServerConfig().then(setConfig).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveServerConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onDownload() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadInstaller();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "rustdesk-installer.exe";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao baixar o instalador");
    } finally {
      setDownloading(false);
    }
  }

  const rustdeskToml = config.server_ip
    ? [
        `rendezvous_server = '${config.server_ip}:21116'`,
        "nat_type = 1",
        "serial = 0",
        "",
        "[options]",
        `key = '${config.server_key}'`,
        `custom-rendezvous-server = '${config.server_ip}'`,
        `relay-server = '${config.server_ip}'`,
        config.api_url ? `api-server = '${config.api_url}'` : null,
      ]
        .filter((line) => line !== null)
        .join("\n")
    : "";

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configuração do Servidor</h1>
        <p className="text-slate-400 text-sm mt-1">
          Dados usados pelo RustDesk e pelo instalador.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
          Dados do Servidor
        </h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                IP / Host
              </label>
              <input
                required
                value={config.server_ip}
                onChange={(e) => setConfig((current) => ({ ...current, server_ip: e.target.value }))}
                placeholder="168.138.151.131"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                URL da API
              </label>
              <input
                value={config.api_url}
                onChange={(e) => setConfig((current) => ({ ...current, api_url: e.target.value }))}
                placeholder="http://168.138.151.131:21114"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              Chave pública
            </label>
            <input
              value={config.server_key}
              readOnly
              placeholder="Aguardando o servidor gerar a chave..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600 placeholder-slate-400 font-mono"
            />
            <p className="text-xs text-slate-400">Gerada e atualizada automaticamente pelo servidor.</p>
          </div>
          {error && (
            <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-500">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Salvando..." : "Salvar configuração"}
            </button>
            {saved && <span className="text-sm text-emerald-600 font-semibold">✓ Salvo</span>}
          </div>
        </form>
      </div>

      {config.rustdesk_password && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Senha Padrão de Acesso Remoto
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            Configurada automaticamente em todos os PCs pelo instalador. Use esta senha ao conectar pelo RustDesk.
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-bold tracking-widest text-slate-900 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 select-all">
              {showPassword ? config.rustdesk_password : "••••••••"}
            </span>
            <button
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-2xl px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
            <CopyButton text={config.rustdesk_password} />
          </div>
        </div>
      )}

      {rustdeskToml && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
              RustDesk2.toml
            </h2>
            <CopyButton text={rustdeskToml} />
          </div>
          <pre className="bg-[#0f172a] text-green-400 text-xs rounded-2xl p-4 overflow-x-auto font-mono leading-relaxed">
            {rustdeskToml}
          </pre>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="w-full rounded-2xl px-5 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {downloading ? "Baixando..." : "Baixar instalador (.exe)"}
        </button>
      </div>
    </div>
  );
}
