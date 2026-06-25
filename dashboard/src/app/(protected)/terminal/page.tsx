"use client";

import { useEffect, useRef, useState } from "react";
import {
  listTags, listDevices, execCommand, getExecResults, listTenants,
  setActiveTenant, getActiveTenantId, isSuperAdmin,
  type Tag, type Device, type ExecJobResult, type Tenant,
} from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

type TargetMode = "all" | "tag" | "devices";

export default function TerminalPage() {
  const user = getStoredUser();
  const superAdmin = user ? isSuperAdmin(user) : false;

  const [tenants, setTenants]               = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(getActiveTenantId() ?? "");
  const [tags, setTags]                     = useState<Tag[]>([]);
  const [devices, setDevices]               = useState<Device[]>([]);
  const [targetMode, setTargetMode]         = useState<TargetMode>("all");
  const [selectedTag, setSelectedTag]       = useState("");
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [cmd, setCmd]                       = useState("");
  const [powershell, setPowershell]         = useState(false);
  const [running, setRunning]               = useState(false);
  const [result, setResult]                 = useState<ExecJobResult | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Carrega lista de tenants para o super admin
  useEffect(() => {
    if (superAdmin) listTenants().then(setTenants);
  }, [superAdmin]);

  // Recarrega devices/tags quando o tenant muda
  useEffect(() => {
    if (superAdmin && !selectedTenantId) return;
    setSelectedDevices(new Set());
    setSelectedTag("");
    Promise.all([listTags(), listDevices({ online: true })]).then(([t, d]) => {
      setTags(t);
      setDevices(d);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  function onTenantChange(id: string) {
    setSelectedTenantId(id);
    setResult(null);
    setError(null);
    const tenant = tenants.find((t) => t.id === id);
    if (tenant) setActiveTenant(id, tenant.name);
    else setActiveTenant(null);
  }

  async function onRun() {
    if (!cmd.trim()) return;
    if (superAdmin && !selectedTenantId) {
      setError("Selecione um cliente antes de executar.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const body: Parameters<typeof execCommand>[0] = { cmd: cmd.trim(), powershell };
      if (targetMode === "tag" && selectedTag) body.tag_id = selectedTag;
      if (targetMode === "devices" && selectedDevices.size > 0) {
        const uuids = devices.filter((d) => selectedDevices.has(d.id)).map((d) => d.uuid);
        body.targets = uuids;
      }

      const resp = await execCommand(body);
      if (resp.sent === 0) {
        throw new Error(
          resp.targets === 0
            ? "Nenhum dispositivo online foi encontrado."
            : "Nenhum agente está conectado. Reinstale o agente no PC."
        );
      }

      pollRef.current = setInterval(async () => {
        try {
          const r = await getExecResults(resp.job_id);
          setResult(r);
          if (r.results.length > 0 && r.results.every((x) => x.done)) {
            clearInterval(pollRef.current!);
            setRunning(false);
          }
        } catch { /* ignore */ }
      }, 800);

      setTimeout(() => {
        if (pollRef.current) { clearInterval(pollRef.current); setRunning(false); }
      }, 60000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao executar");
      setRunning(false);
    }
  }

  function toggleDevice(id: string) {
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const onlineDevices = devices.filter((d) => d.online);
  const noTenantSelected = superAdmin && !selectedTenantId;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Terminal Remoto</h1>
        <p className="text-slate-400 text-sm mt-1">
          Execute comandos em múltiplos dispositivos simultaneamente. Requer o agente instalado.
        </p>
      </div>

      {/* Seletor de cliente — só para super admin */}
      {superAdmin && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest block mb-2">
            Cliente
          </label>
          <select
            value={selectedTenantId}
            onChange={(e) => onTenantChange(e.target.value)}
            className="w-full sm:w-auto rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Selecione um cliente —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.online_count ?? 0} online)
              </option>
            ))}
          </select>
          {noTenantSelected && (
            <p className="text-xs text-slate-400 mt-2">Selecione um cliente para ver os dispositivos e executar comandos.</p>
          )}
        </div>
      )}

      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 ${noTenantSelected ? "opacity-40 pointer-events-none" : ""}`}>
        {/* Destino */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Destino</label>
          <div className="flex gap-2 flex-wrap">
            {(["all", "tag", "devices"] as TargetMode[]).map((m) => {
              const labels: Record<TargetMode, string> = { all: "Todos online", tag: "Por tag", devices: "Selecionar PCs" };
              return (
                <button key={m} onClick={() => setTargetMode(m)}
                  className={`px-4 py-1.5 rounded-2xl text-xs font-semibold border transition-all ${
                    targetMode === m ? "text-white border-transparent bg-blue-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}>
                  {labels[m]}
                </button>
              );
            })}
          </div>

          {targetMode === "tag" && (
            <select value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Selecione uma tag</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}

          {targetMode === "devices" && (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-slate-200 rounded-2xl bg-white">
              {onlineDevices.length === 0 && <p className="text-xs text-slate-400">Nenhum dispositivo online com agente</p>}
              {onlineDevices.map((d) => (
                <button key={d.id} onClick={() => toggleDevice(d.id)}
                  className={`px-3 py-1 rounded-2xl text-xs font-semibold border transition-all ${
                    selectedDevices.has(d.id) ? "text-white border-transparent bg-blue-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}>
                  {d.alias || d.hostname || d.rustdesk_id}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Shell */}
        <div className="flex items-center gap-4">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Shell</label>
          <div className="flex gap-3">
            {[{ val: false, label: "CMD" }, { val: true, label: "PowerShell" }].map(({ val, label }) => (
              <label key={label} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={powershell === val} onChange={() => setPowershell(val)} className="accent-blue-600" />
                <span className="text-sm text-slate-700 font-medium">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Comando */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Comando</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono">
                {powershell ? "PS>" : ">"}
              </span>
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onRun(); } }}
                placeholder={powershell ? "Get-Process | Sort CPU -Desc | Select -First 10" : "ipconfig /all"}
                className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button onClick={onRun} disabled={running || !cmd.trim()}
              className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
              {running
                ? <><span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Executando...</>
                : <>▶ Executar</>}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-500">{error}</div>
      )}

      {/* Resultados */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">{result.cmd}</span>
            <span>·</span>
            <span>{result.results.length} dispositivo{result.results.length !== 1 ? "s" : ""}</span>
            {running && <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse ml-1" />}
          </div>
          {result.results.map((r) => (
            <div key={r.device_id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 ${r.done ? "bg-slate-50" : "bg-blue-50"}`}>
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${r.done ? "bg-slate-300" : "bg-blue-600 animate-pulse"}`} />
                <span className="font-semibold text-sm text-slate-900">{r.alias || r.hostname || r.rustdesk_id}</span>
                {r.ip_address && <span className="text-xs text-slate-400 font-mono">{r.ip_address}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {r.done && r.exit_code !== null && (
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full font-semibold ${r.exit_code === 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600"}`}>
                      exit {r.exit_code}
                    </span>
                  )}
                  {!r.done && <span className="text-xs text-slate-500 font-medium">executando...</span>}
                </div>
              </div>
              <pre className="bg-[#0f172a] text-green-400 text-xs font-mono p-4 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {r.output || (r.done ? "(sem output)" : "aguardando...")}
              </pre>
            </div>
          ))}
          {result.results.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-8 text-center text-slate-400 text-sm">
              Aguardando resposta dos agentes...
              <p className="text-xs mt-1 text-slate-400">O agente precisa estar instalado e conectado em cada PC.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
