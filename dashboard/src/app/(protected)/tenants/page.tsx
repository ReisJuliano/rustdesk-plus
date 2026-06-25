"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listTenants, createTenant, deleteTenant, isSuperAdmin,
  setActiveTenant, getServerConfigForTenant,
  type Tenant,
} from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [installCodes, setInstallCodes] = useState<Record<string, string>>({});
  const [apiUrl, setApiUrl] = useState("");
  const [showCode, setShowCode] = useState<Record<string, boolean>>({});

  const user = getStoredUser();

  useEffect(() => {
    if (!user || !isSuperAdmin(user)) {
      router.replace("/dashboard");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const list = await listTenants();
      setTenants(list);
      // Carrega install_code de cada tenant em paralelo
      const codes: Record<string, string> = {};
      let url = "";
      await Promise.all(list.map(async (t) => {
        try {
          const cfg = await getServerConfigForTenant(t.id);
          codes[t.id] = cfg.install_code ?? "";
          if (!url && cfg.api_url) url = cfg.api_url.replace(/\/$/, "");
        } catch { /* ignore */ }
      }));
      setInstallCodes(codes);
      setApiUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar clientes");
    }
  }

  function slugify(name: string) {
    return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createTenant(newName.trim(), newSlug.trim() || slugify(newName));
      setNewName("");
      setNewSlug("");
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao criar cliente");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(t: Tenant) {
    if (!confirm(`Remover "${t.name}"? Todos os dispositivos, usuários e dados serão excluídos.`)) return;
    try {
      await deleteTenant(t.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao remover");
    }
  }

  function enterTenant(t: Tenant) {
    setActiveTenant(t.id, t.name);
    router.push("/dashboard");
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
          <p className="text-slate-400 text-sm mt-1">
            {tenants.length} cliente{tenants.length !== 1 ? "s" : ""} cadastrado{tenants.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          {creating ? "Cancelar" : "+ Novo cliente"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-500">{error}</div>
      )}

      {creating && (
        <form onSubmit={onCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Novo cliente</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Nome</label>
              <input
                required
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setNewSlug(slugify(e.target.value)); }}
                placeholder="Rede Hiperfarma"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Slug</label>
              <input
                required
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="rede-hiperfarma"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Criando..." : "Criar cliente"}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {tenants.map((t) => (
          <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            {/* Avatar */}
            <div className="h-11 w-11 rounded-2xl bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-base">{t.name[0].toUpperCase()}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{t.name}</h3>
                <span className="text-xs text-slate-400 font-mono bg-slate-100 rounded-full px-2 py-0.5">{t.slug}</span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                <span>
                  <span className="font-semibold text-slate-600">{t.device_count ?? 0}</span> dispositivos
                </span>
                <span className="text-emerald-600 font-medium">
                  {t.online_count ?? 0} online
                </span>
                <span>
                  <span className="font-semibold text-slate-600">{t.user_count ?? 0}</span> usuários
                </span>
              </div>
            </div>

            {/* Código de instalação */}
            {installCodes[t.id] && apiUrl && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 flex-shrink-0">Código:</span>
                  <code className="font-mono text-xs font-bold text-slate-700 bg-slate-100 rounded px-2 py-0.5 tracking-widest">
                    {showCode[t.id] ? installCodes[t.id] : "••••••••"}
                  </code>
                  <button
                    onClick={() => setShowCode(v => ({ ...v, [t.id]: !v[t.id] }))}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    {showCode[t.id] ? "ocultar" : "ver"}
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(`irm "${apiUrl}/i/${installCodes[t.id]}" | iex`)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold ml-1"
                    title={`irm "${apiUrl}/i/${installCodes[t.id]}" | iex`}
                  >
                    Copiar comando
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => enterTenant(t)}
                className="rounded-2xl px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                Entrar
              </button>
              <button
                onClick={() => onDelete(t)}
                className="p-2 rounded-xl border border-slate-200 text-slate-300 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                title="Remover cliente"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {tenants.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <svg className="h-7 w-7 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h10.5a.75.75 0 0 1 0 1.5H12v13.75a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 1-.75.75H3a.75.75 0 0 1-.75-.75V2.75A.75.75 0 0 1 1 2.75Z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">Nenhum cliente ainda</p>
            <p className="text-slate-400 text-sm mt-1">Clique em "Novo cliente" para começar.</p>
          </div>
        )}
      </div>
    </div>
  );
}
