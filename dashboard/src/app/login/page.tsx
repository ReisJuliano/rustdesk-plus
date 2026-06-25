"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  completeSetup,
  getSetupStatus,
  login,
  setToken,
  type SetupStatus,
} from "@/lib/api";
import { setStoredUser } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Administrador");
  const [tenantName, setTenantName] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then((setup) => {
        setStatus(setup);
        const host = window.location.hostname;
        setServerIp(setup.server_ip || host);
        setApiUrl(setup.api_url || window.location.origin);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Servidor indisponível"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!status) return;
    setError(null);
    setLoading(true);
    try {
      const response = status.configured
        ? await login(email, password)
        : await completeSetup({
            email,
            password,
            name,
            server_ip: serverIp,
            api_url: apiUrl,
            tenant_name: tenantName || name,
          });
      setToken(response.token);
      setStoredUser(response.user);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível continuar");
    } finally {
      setLoading(false);
    }
  }

  const firstRun = status?.configured === false;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className={`w-full ${firstRun ? "max-w-xl" : "max-w-sm"}`}>
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 1 1.1 1.677A.75.75 0 0 1 13 17.5H7a.75.75 0 0 1-.745-.823A3.501 3.501 0 0 1 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Z" clipRule="evenodd" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">RustDesk Plus</h1>
          <p className="text-sm text-slate-500 mt-1">
            {firstRun ? "Configuração inicial do servidor" : "Entre com sua conta"}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          {!status && !error ? (
            <p className="text-sm text-slate-500 text-center">Preparando o servidor...</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {firstRun && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Seu nome">
                      <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="Nome da empresa (primeiro cliente)">
                      <input required value={tenantName} onChange={(e) => setTenantName(e.target.value)}
                        placeholder="Minha Empresa" className={inputClass} />
                    </Field>
                  </div>
                  <Field label="IP ou domínio público">
                    <input required value={serverIp} onChange={(e) => setServerIp(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="URL pública da API">
                    <input required value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className={inputClass} />
                  </Field>
                  <div className="rounded-xl bg-blue-50 border border-blue-100 px-3.5 py-3 text-xs text-blue-700">
                    A chave do RustDesk é criada e preenchida automaticamente pelo servidor.
                  </div>
                </>
              )}

              <Field label="Email">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@empresa.com" className={inputClass} />
              </Field>
              <Field label="Senha">
                <input type="password" required minLength={firstRun ? 8 : undefined}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" className={inputClass} />
              </Field>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-sm text-red-600">
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || !status}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {loading ? "Salvando..." : firstRun ? "Configurar e iniciar" : "Entrar"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
