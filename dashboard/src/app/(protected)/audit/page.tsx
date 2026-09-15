"use client";

import { useCallback, useEffect, useState } from "react";
import { listConnectionAudit, type ConnectionAudit } from "@/lib/api";

const connectionTypes: Record<number, string> = {
  0: "Controle remoto", 1: "Transferência de arquivos", 2: "Túnel de porta",
  3: "Câmera", 4: "Terminal",
};

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "â€”";
}

function duration(seconds: number | null) {
  if (seconds == null) return "â€”";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${m}min` : m ? `${m}min ${s}s` : `${s}s`;
}

const statusLabel = { launched: "Iniciada", connecting: "Conectando", active: "Ativa", closed: "Encerrada" };
const statusColor = { launched: "bg-amber-50 text-amber-700", connecting: "bg-blue-50 text-blue-700", active: "bg-emerald-50 text-emerald-700", closed: "bg-slate-100 text-slate-600" };

export default function AuditPage() {
  const [items, setItems] = useState<ConnectionAudit[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setItems(await listConnectionAudit({ search, limit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a auditoria");
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);

  return <div className="p-6 space-y-5">
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Auditoria de conexões</h1>
        <p className="text-sm text-slate-500 mt-1">Sessões registradas pelo cliente RustDesk e pelo servidor de relay.</p>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar origem ou destinoâ€¦"
        className="w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
    </div>

    {error && <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</div>}
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="text-left px-4 py-3">Origem</th><th className="text-left px-4 py-3">Destino</th>
              <th className="text-left px-4 py-3">Tipo</th><th className="text-left px-4 py-3">Início</th>
              <th className="text-left px-4 py-3">Fim / duração</th><th className="text-left px-4 py-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((a) => <tr key={a.id} className="hover:bg-slate-50/70">
              <td className="px-4 py-3"><div className="font-medium text-slate-800">{a.peer_name || a.peer_rustdesk_id || "Aguardando identificação"}</div>
                <div className="text-xs text-slate-400">{a.peer_rustdesk_id ? `ID ${a.peer_rustdesk_id}` : ""}{a.source_ip ? ` · IP ${a.source_ip}` : ""}</div>
                {a.initiated_by_name && <div className="text-xs text-blue-600 mt-0.5">Painel: {a.initiated_by_name}</div>}</td>
              <td className="px-4 py-3"><div className="font-medium text-slate-800">{a.alias || a.hostname || a.target_rustdesk_id}</div>
                <div className="text-xs text-slate-400">ID {a.target_rustdesk_id}</div></td>
              <td className="px-4 py-3 text-slate-600">{a.connection_type == null ? "â€”" : connectionTypes[a.connection_type] || `Tipo ${a.connection_type}`}</td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{date(a.started_at || a.launched_at)}</td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap"><div>{date(a.ended_at)}</div><div className="text-xs text-slate-400">{duration(a.duration_seconds)}</div></td>
              <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusColor[a.status]}`}>{statusLabel[a.status]}</span></td>
            </tr>)}
            {!loading && items.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Nenhuma conexão registrada ainda.</td></tr>}
            {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Carregandoâ€¦</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

