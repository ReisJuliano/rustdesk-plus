"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getStats, listDevices, listTenants, setActiveTenant,
  isSuperAdmin,
  type Stats, type Device, type Tenant,
} from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { useRouter } from "next/navigation";

// ── Dashboard do super admin ──────────────────────────────────────────────────

function SuperAdminDashboard() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTenants()
      .then(setTenants)
      .finally(() => setLoading(false));
    const iv = setInterval(() => listTenants().then(setTenants), 20000);
    return () => clearInterval(iv);
  }, []);

  const totalDevices = tenants.reduce((s, t) => s + (t.device_count ?? 0), 0);
  const totalOnline  = tenants.reduce((s, t) => s + (t.online_count ?? 0), 0);
  const totalUsers   = tenants.reduce((s, t) => s + (t.user_count ?? 0), 0);

  function enterTenant(t: Tenant) {
    setActiveTenant(t.id, t.name);
    router.push("/devices");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="text-3xl font-bold text-slate-900">Visão Geral</h1>
        <p className="text-slate-400 text-sm mt-1">Todos os clientes e seus dispositivos</p>
      </div>

      {/* Totais globais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Clientes", value: tenants.length, bg: "bg-violet-50", iconBg: "bg-violet-600",
            icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h10.5a.75.75 0 0 1 0 1.5H12v13.75a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 1-.75.75H3a.75.75 0 0 1-.75-.75V2.75Z" clipRule="evenodd" /></svg> },
          { label: "Dispositivos", value: totalDevices, bg: "bg-blue-50", iconBg: "bg-blue-600",
            icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" /></svg> },
          { label: "Online agora", value: totalOnline, bg: "bg-emerald-50", iconBg: "bg-emerald-500",
            icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg> },
          { label: "Usuários", value: totalUsers, bg: "bg-amber-50", iconBg: "bg-amber-500",
            icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 17a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" /></svg> },
        ].map(({ label, value, bg, iconBg, icon }) => (
          <div key={label} className={`${bg} rounded-2xl border border-slate-200 p-5 shadow-sm`}>
            <div className={`h-11 w-11 rounded-2xl ${iconBg} flex items-center justify-center mb-3`}>{icon}</div>
            <p className="text-3xl font-bold text-slate-800">{loading ? "—" : value}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Cards por cliente */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Clientes</h2>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 h-32 animate-pulse" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <p className="text-slate-400">Nenhum cliente cadastrado.</p>
            <Link href="/tenants" className="text-blue-600 text-sm font-semibold hover:underline mt-2 inline-block">
              Cadastrar primeiro cliente →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tenants.map((t) => {
              const offline = (t.device_count ?? 0) - (t.online_count ?? 0);
              const pct = (t.device_count ?? 0) > 0
                ? Math.round(((t.online_count ?? 0) / (t.device_count ?? 0)) * 100)
                : 0;
              return (
                <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
                  {/* Tenant header */}
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-blue-600 flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-bold">{t.name[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{t.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{t.slug}</p>
                    </div>
                    {(t.online_count ?? 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      </span>
                    )}
                  </div>

                  {/* Métricas */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-50 rounded-xl py-2">
                      <p className="text-xl font-bold text-slate-800">{t.device_count ?? 0}</p>
                      <p className="text-xs text-slate-400">Total</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl py-2">
                      <p className="text-xl font-bold text-emerald-700">{t.online_count ?? 0}</p>
                      <p className="text-xs text-emerald-600">Online</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl py-2">
                      <p className="text-xl font-bold text-slate-500">{offline}</p>
                      <p className="text-xs text-slate-400">Offline</p>
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  {(t.device_count ?? 0) > 0 && (
                    <div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{pct}% online</p>
                    </div>
                  )}

                  {/* Ações */}
                  <div className="flex gap-2 mt-auto">
                    <button
                      onClick={() => enterTenant(t)}
                      className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                    >
                      Ver dispositivos
                    </button>
                    <Link
                      href="/terminal"
                      onClick={() => setActiveTenant(t.id, t.name)}
                      className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                      title="Terminal"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25Zm.943 8.752a.75.75 0 0 1 .055-1.06L6.836 9l-2.588-1.693a.75.75 0 1 1 .834-1.254l3.25 2.13a.75.75 0 0 1 0 1.254l-3.25 2.13a.75.75 0 0 1-1.06-.055ZM9.75 11.25a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" />
                      </svg>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard regular ─────────────────────────────────────────────────────────

const statCards = [
  { key: "total_devices" as keyof Stats, label: "Dispositivos", bg: "bg-blue-50", iconBg: "bg-blue-600",
    icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" /></svg> },
  { key: "online_devices" as keyof Stats, label: "Online agora", bg: "bg-emerald-50", iconBg: "bg-emerald-500",
    icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" /></svg> },
  { key: "offline_devices" as keyof Stats, label: "Offline", bg: "bg-slate-100", iconBg: "bg-slate-400",
    icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clipRule="evenodd" /></svg> },
  { key: "total_branches" as keyof Stats, label: "Filiais", bg: "bg-pink-50", iconBg: "bg-pink-500",
    icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 16.5v-13h-.25a.75.75 0 0 1 0-1.5h12.5a.75.75 0 0 1 0 1.5H16v13h.25a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75v-2.5a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5H4Z" clipRule="evenodd" /></svg> },
  { key: "total_users" as keyof Stats, label: "Usuários", bg: "bg-amber-50", iconBg: "bg-amber-500",
    icon: <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 17a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" /></svg> },
];

function RegularDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [online, setOnline] = useState<Device[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [s, d] = await Promise.all([getStats(), listDevices({ online: true })]);
        setStats(s);
        setOnline(d.slice(0, 8));
      } catch { /* ignore */ }
    }
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-3xl font-bold text-slate-900">Bem‑vindo!</h1>
        </div>
        <Link href="/devices"
          className="text-sm font-semibold text-white px-4 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 transition-colors">
          Ver dispositivos →
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map(({ key, label, bg, iconBg, icon }) => (
          <div key={key} className={`${bg} rounded-2xl border border-slate-200 p-5 shadow-sm`}>
            <div className={`h-11 w-11 rounded-2xl ${iconBg} flex items-center justify-center mb-3`}>{icon}</div>
            <p className="text-3xl font-bold text-slate-800">{stats?.[key] ?? "—"}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-bold text-slate-900">Dispositivos online</span>
            <span className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full">{online.length}</span>
          </div>
          <Link href="/devices" className="text-xs font-semibold text-blue-600 hover:text-blue-700">Ver todos →</Link>
        </div>
        {online.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-4xl mb-3">🖥️</div>
            <p className="text-sm text-slate-500">Nenhum dispositivo online agora</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {online.map((d) => (
              <Link key={d.id} href="/devices"
                className="flex items-center gap-3 px-6 py-3.5 hover:bg-blue-50 transition-colors group">
                <div className="h-9 w-9 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{d.alias || d.hostname || d.rustdesk_id}</p>
                  <p className="text-xs text-slate-400 font-mono truncate">{d.ip_address ?? d.rustdesk_id}{d.os ? ` · ${d.os}` : ""}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const user = getStoredUser();
  if (user && isSuperAdmin(user)) return <SuperAdminDashboard />;
  return <RegularDashboard />;
}
