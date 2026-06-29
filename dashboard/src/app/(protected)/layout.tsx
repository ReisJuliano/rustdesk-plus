"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setToken, setActiveTenant, getActiveTenantId, getActiveTenantName, isSuperAdmin } from "@/lib/api";
import { getStoredUser, setStoredUser } from "@/lib/auth";

const navItems = [
  { href: "/dashboard", label: "Dashboard",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" /></svg> },
  { href: "/devices", label: "Dispositivos",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" /></svg> },
  { href: "/terminal", label: "Terminal",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25Zm.943 8.752a.75.75 0 0 1 .055-1.06L6.836 9l-2.588-1.693a.75.75 0 1 1 .834-1.254l3.25 2.13a.75.75 0 0 1 0 1.254l-3.25 2.13a.75.75 0 0 1-1.06-.055ZM9.75 11.25a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" /></svg> },
  { href: "/scripts", label: "Scripts",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v2.752l.104-.002h13.792c.035 0 .07 0 .104.002V6.75A1.75 1.75 0 0 0 15.25 5H9.378a.25.25 0 0 1-.177-.073L7.823 3.549A1.75 1.75 0 0 0 6.586 3H4.75ZM3.104 9a1.75 1.75 0 0 0-1.673 2.265l1.385 4.5A1.75 1.75 0 0 0 4.489 17h11.022a1.75 1.75 0 0 0 1.673-1.235l1.385-4.5A1.75 1.75 0 0 0 16.896 9H3.104Z" /></svg> },
  { href: "/branches", label: "Filiais & Tags",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 16.5v-13h-.25a.75.75 0 0 1 0-1.5h12.5a.75.75 0 0 1 0 1.5H16v13h.25a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75v-2.5a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5H4Z" clipRule="evenodd" /></svg> },
  { href: "/users", label: "Usuários",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 17a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" /></svg> },
  { href: "/settings", label: "Configuração",
    icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" /></svg> },
];

const tenantsNavItem = {
  href: "/tenants",
  label: "Clientes",
  icon: <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h10.5a.75.75 0 0 1 0 1.5H12v13.75a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-3.5a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 1-.75.75H3a.75.75 0 0 1-.75-.75V2.75A.75.75 0 0 1 1 2.75Zm16.5 10.5a.75.75 0 0 1 .75.75v3.25a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V14a2 2 0 0 1 4 0v-.75a.75.75 0 0 1 .25 0ZM13 9.25a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z" clipRule="evenodd" /></svg>,
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  // Inicializa direto do sessionStorage para não ter flash de nav errado na primeira render
  const [activeTenantName, setActiveTenantName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem("activeTenantName");
  });
  const user = getStoredUser();

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { router.replace("/login"); return; }

    // Super admin pode acessar /tenants, /dashboard, /terminal e /settings sem tenant ativo.
    // Qualquer outra rota redireciona para /tenants para escolher um cliente.
    const stored = getStoredUser();
    const superAdminFreePages = ["/tenants", "/dashboard", "/terminal", "/settings"];
    if (
      stored &&
      isSuperAdmin(stored) &&
      !getActiveTenantId() &&
      !superAdminFreePages.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      router.replace("/tenants");
      return;
    }

    setReady(true);
    setActiveTenantName(getActiveTenantName());
  }, [router, pathname]);

  // Atualiza o banner ao voltar de navegações
  useEffect(() => {
    setActiveTenantName(getActiveTenantName());
  }, [pathname]);

  function logout() {
    setToken(null);
    setStoredUser(null);
    setActiveTenant(null);
    router.replace("/login");
  }

  function exitTenant() {
    setActiveTenant(null);
    setActiveTenantName(null);
    router.push("/tenants");
  }

  if (!ready) return null;

  const superAdmin = user ? isSuperAdmin(user) : false;
  // Super admin sem cliente ativo: só Dashboard, Terminal, Clientes, Configuração.
  // Super admin com cliente ativo (impersonando): nav completo igual ao cliente + link Clientes.
  const superAdminNavItems = [
    tenantsNavItem,
    navItems.find((n) => n.href === "/dashboard")!,
    navItems.find((n) => n.href === "/terminal")!,
    navItems.find((n) => n.href === "/settings")!,
  ];
  const superAdminWithTenantNavItems = [tenantsNavItem, ...navItems];
  const allNavItems = superAdmin
    ? activeTenantName
      ? superAdminWithTenantNavItems
      : superAdminNavItems
    : navItems;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="w-56 flex-shrink-0 flex flex-col bg-white border-r border-slate-200">
        {/* Logo */}
        <div className="px-4 h-14 flex items-center gap-2.5 border-b border-slate-100">
          <div className="h-8 w-8 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="font-semibold text-sm text-slate-800 tracking-tight">RustDesk Plus</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {allNavItems.map(({ href, label, icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}>
                <span className={`h-4 w-4 flex-shrink-0 ${active ? "text-white" : "text-slate-400"}`}>{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate leading-tight">{user?.name}</p>
              <p className="text-xs text-slate-400 capitalize">{user?.role === "super_admin" ? "Super Admin" : user?.role}</p>
            </div>
            <button onClick={logout} title="Sair"
              className="text-slate-400 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Banner de impersonation */}
        {superAdmin && activeTenantName && (
          <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-amber-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
              </svg>
              <span className="text-amber-700 font-medium">Visualizando como:</span>
              <span className="text-amber-900 font-bold">{activeTenantName}</span>
            </div>
            <button
              onClick={exitTenant}
              className="text-xs font-semibold text-amber-700 hover:text-amber-900 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 transition-colors"
            >
              Sair do cliente
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
