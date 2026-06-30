"use client";

import { useEffect, useRef, useState } from "react";
import {
  listTags, listDevices, execCommand, getExecResults, listTenants,
  setActiveTenant, getActiveTenantId, isSuperAdmin,
  type Tag, type Device, type ExecJobResult, type Tenant,
} from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

type TargetMode = "all" | "tag" | "device";

type HistoryEntry = {
  jobId: string;
  cmd: string;
  powershell: boolean;
  result: ExecJobResult | null;
  running: boolean;
  startedAt: number; // Date.now()
  cwd: string | null;
};

const CWD_SENTINEL = "__TRIVIO_CWD__";

function wrapForCwd(cmd: string, isPowershell: boolean): string {
  if (isPowershell) {
    return `${cmd}; Write-Host "${CWD_SENTINEL}:$(Get-Location)"`;
  }
  return `${cmd} & echo ${CWD_SENTINEL}:%CD%`;
}

function extractCwd(output: string): string | null {
  const lines = output.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(CWD_SENTINEL + ":")) {
      return lines[i].slice(CWD_SENTINEL.length + 1).trim();
    }
  }
  return null;
}

function stripSentinel(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(CWD_SENTINEL + ":"))
    .join("\n")
    .trimEnd();
}

function buildPrompt(isPowershell: boolean, cwd: string | null): string {
  if (isPowershell) return cwd ? `PS ${cwd}>` : "PS>";
  return cwd ? `${cwd}>` : ">";
}

export default function TerminalPage() {
  const user = getStoredUser();
  const superAdmin = user ? isSuperAdmin(user) : false;

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>(getActiveTenantId() ?? "");
  const [tags, setTags] = useState<Tag[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [targetMode, setTargetMode] = useState<TargetMode>("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [powershell, setPowershell] = useState(true);
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [tick, setTick] = useState(0);

  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const anyRunning = history.some((e) => e.running);
  // tick increments every second while running, forcing re-render so elapsed times update
  const now = tick >= 0 && anyRunning ? Date.now() : 0;
  const noTenantSelected = superAdmin && !selectedTenantId;
  const prompt = buildPrompt(powershell, currentDir);

  // Tick every second while any command is running (for elapsed timer)
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  // Auto-scroll to bottom whenever history updates
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [history]);

  useEffect(() => {
    if (superAdmin) listTenants().then(setTenants);
  }, [superAdmin]);

  useEffect(() => {
    if (superAdmin && !selectedTenantId) return;
    Promise.all([listTags(), listDevices({ online: true })]).then(([t, d]) => {
      setTags(t);
      setDevices(d);
    });
    return () => {
      pollsRef.current.forEach(clearInterval);
      pollsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  useEffect(() => {
    return () => {
      pollsRef.current.forEach(clearInterval);
    };
  }, []);

  function onTenantChange(id: string) {
    setSelectedTenantId(id);
    setHistory([]);
    setError(null);
    const tenant = tenants.find((t) => t.id === id);
    if (tenant) setActiveTenant(id, tenant.name);
    else setActiveTenant(null);
  }

  async function onRun() {
    const trimmed = cmd.trim();
    if (!trimmed || anyRunning) return;
    if (noTenantSelected) {
      setError("Selecione um cliente antes de executar.");
      return;
    }

    if (trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "cls") {
      setHistory([]);
      setCurrentDir(null);
      setCmd("");
      setCmdHistoryIdx(-1);
      return;
    }

    setCmd("");
    setError(null);
    setCmdHistoryIdx(-1);
    setCmdHistory((prev) => [trimmed, ...prev.slice(0, 49)]);

    const body: Parameters<typeof execCommand>[0] = { cmd: wrapForCwd(trimmed, powershell), powershell };
    if (targetMode === "tag" && selectedTag) body.tag_id = selectedTag;
    if (targetMode === "device" && selectedDeviceId) {
      const dev = devices.find((d) => d.id === selectedDeviceId);
      if (dev) body.targets = [dev.uuid];
    }

    const placeholderId = `pending-${Date.now()}`;
    setHistory((prev) => [
      ...prev,
      { jobId: placeholderId, cmd: trimmed, powershell, result: null, running: true, startedAt: Date.now(), cwd: currentDir },
    ]);

    try {
      const resp = await execCommand(body);

      if (resp.sent === 0) {
        const errMsg =
          resp.targets === 0
            ? "Nenhum dispositivo online encontrado."
            : "Agente não conectado. Reinstale o agente no PC.";
        setHistory((prev) =>
          prev.map((e) =>
            e.jobId === placeholderId
              ? {
                  ...e,
                  jobId: resp.job_id ?? placeholderId,
                  running: false,
                  result: {
                    job_id: resp.job_id ?? "",
                    cmd: trimmed,
                    powershell,
                    results: [
                      {
                        device_id: "err",
                        hostname: null,
                        alias: null,
                        rustdesk_id: "—",
                        ip_address: null,
                        output: errMsg,
                        exit_code: -1,
                        done: true,
                        started_at: new Date().toISOString(),
                        finished_at: new Date().toISOString(),
                      },
                    ],
                  },
                }
              : e
          )
        );
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      const jobId: string = resp.job_id;
      setHistory((prev) =>
        prev.map((e) => (e.jobId === placeholderId ? { ...e, jobId } : e))
      );

      const interval = setInterval(async () => {
        try {
          const r = await getExecResults(jobId);
          const allDone = r.results.length > 0 && r.results.every((x) => x.done);
          setHistory((prev) =>
            prev.map((e) =>
              e.jobId === jobId ? { ...e, result: r, running: !allDone } : e
            )
          );
          if (allDone) {
            clearInterval(interval);
            pollsRef.current.delete(jobId);
            // Extract CWD from last finished result
            const last = r.results[r.results.length - 1];
            if (last?.output) {
              const cwd = extractCwd(last.output);
              if (cwd) setCurrentDir(cwd);
            }
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        } catch {
          // ignore transient failures
        }
      }, 400);

      pollsRef.current.set(jobId, interval);

      setTimeout(() => {
        const iv = pollsRef.current.get(jobId);
        if (iv) {
          clearInterval(iv);
          pollsRef.current.delete(jobId);
          setHistory((prev) =>
            prev.map((e) => (e.jobId === jobId ? { ...e, running: false } : e))
          );
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }, 120_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao executar";
      setHistory((prev) =>
        prev.map((e) =>
          e.jobId === placeholderId
            ? {
                ...e,
                running: false,
                result: {
                  job_id: "",
                  cmd: trimmed,
                  powershell,
                  results: [
                    {
                      device_id: "err",
                      hostname: null,
                      alias: null,
                      rustdesk_id: "—",
                      ip_address: null,
                      output: msg,
                      exit_code: -1,
                      done: true,
                      started_at: new Date().toISOString(),
                      finished_at: null,
                    },
                  ],
                },
              }
            : e
        )
      );
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onRun();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(cmdHistoryIdx + 1, cmdHistory.length - 1);
      setCmdHistoryIdx(next);
      if (cmdHistory[next] !== undefined) setCmd(cmdHistory[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(cmdHistoryIdx - 1, -1);
      setCmdHistoryIdx(next);
      setCmd(next === -1 ? "" : cmdHistory[next]);
    }
  }

  const onlineDevices = devices.filter((d) => d.online);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Config header ── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Terminal Remoto</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Execute comandos com saída em tempo real. Use ↑↓ para histórico. Digite{" "}
              <code className="font-mono text-xs bg-slate-100 px-1 rounded">clear</code> para limpar.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setHistory([])}
              className="text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              Limpar
            </button>
            <button
              onClick={() => setShowConfig((v) => !v)}
              className="text-xs font-semibold text-slate-500 border border-slate-200 rounded-xl px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              {showConfig ? "▲ Ocultar" : "▼ Configurar"}
            </button>
          </div>
        </div>

        {showConfig && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
            {superAdmin && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest w-16">
                  Cliente
                </span>
                <select
                  value={selectedTenantId}
                  onChange={(e) => onTenantChange(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Selecione —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.online_count ?? 0} online)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest w-16">
                  Destino
                </span>
                <div className="flex gap-1">
                  {(
                    [
                      { val: "all", label: "Todos online" },
                      { val: "tag", label: "Por tag" },
                      { val: "device", label: "Um PC" },
                    ] as { val: TargetMode; label: string }[]
                  ).map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => setTargetMode(val)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                        targetMode === val
                          ? "text-white border-transparent bg-blue-600"
                          : "border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {targetMode === "tag" && (
                  <select
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecione tag</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
                {targetMode === "device" && (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecione PC</option>
                    {onlineDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.alias || d.hostname || d.rustdesk_id}
                        {d.ip_address ? ` — ${d.ip_address}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest w-12">
                  Shell
                </span>
                <div className="flex gap-1">
                  {[
                    { val: false, label: "CMD" },
                    { val: true, label: "PowerShell" },
                  ].map(({ val, label }) => (
                    <button
                      key={label}
                      onClick={() => setPowershell(val)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                        powershell === val
                          ? "text-white border-transparent bg-blue-600"
                          : "border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-2 text-sm text-rose-500">
            {error}
          </div>
        )}
      </div>

      {/* ── Terminal window — fills remaining height ── */}
      <div
        className={`flex-1 min-h-0 px-6 pb-6 flex flex-col ${
          noTenantSelected ? "opacity-40 pointer-events-none" : ""
        }`}
      >
        <div className="flex-1 min-h-0 flex flex-col bg-[#0d1117] rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
          {/* Scrollable history */}
          <div
            ref={termRef}
            className="flex-1 min-h-0 overflow-y-auto p-5 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {/* Empty state */}
            {history.length === 0 && (
              <div className="font-mono text-sm select-none space-y-0.5">
                <p className="text-slate-400">
                  {powershell
                    ? "Windows PowerShell"
                    : "Prompt de Comando (CMD)"}
                </p>
                <p className="text-slate-600 text-xs">
                  {targetMode === "all"
                    ? "Destino: todos os dispositivos online"
                    : targetMode === "tag"
                    ? `Destino: tag "${tags.find((t) => t.id === selectedTag)?.name ?? "—"}"`
                    : `Destino: ${
                        onlineDevices.find((d) => d.id === selectedDeviceId)?.alias ||
                        onlineDevices.find((d) => d.id === selectedDeviceId)?.hostname ||
                        "—"
                      }`}
                </p>
                <p className="text-slate-600 text-xs">
                  Digite um comando abaixo e pressione Enter.
                </p>
              </div>
            )}

            {/* Command history */}
            {history.map((entry, idx) => {
              const multiDevice = (entry.result?.results.length ?? 0) > 1;
              return (
                <div key={entry.jobId} className={idx > 0 ? "mt-3" : ""}>
                  {/* Prompt + command */}
                  <div className="flex items-start gap-2 font-mono text-sm">
                    <span className="text-blue-400 flex-shrink-0 select-none leading-relaxed whitespace-nowrap">
                      {buildPrompt(entry.powershell, entry.cwd)}
                    </span>
                    <span className="text-slate-100 break-all leading-relaxed">
                      {entry.cmd}
                    </span>
                  </div>

                  {/* Output */}
                  {entry.result ? (
                    entry.result.results.map((r) => (
                      <div key={r.device_id} className="mt-0.5">
                        {multiDevice && (
                          <div className="text-yellow-500 text-xs font-mono mt-1 select-none">
                            ──{" "}
                            {r.alias || r.hostname || r.rustdesk_id}
                            {r.ip_address ? ` (${r.ip_address})` : ""} ──
                          </div>
                        )}
                        {r.output && (() => {
                          const clean = stripSentinel(r.output);
                          return clean ? (
                            <pre
                              className={`font-mono text-sm whitespace-pre-wrap break-words leading-relaxed ${
                                r.exit_code !== null && r.exit_code !== 0
                                  ? "text-rose-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {clean}
                            </pre>
                          ) : null;
                        })()}
                        {!r.done && (
                          <span className="font-mono text-slate-500 text-sm">
                            <span className="animate-pulse">▊</span>
                            {!r.output && (
                              <span className="text-slate-600 text-xs ml-2 select-none">
                                {Math.floor((now - entry.startedAt) / 1000)}s — aguardando output...
                              </span>
                            )}
                          </span>
                        )}
                        {r.done && r.exit_code !== null && r.exit_code !== 0 && (
                          <p className="font-mono text-xs text-rose-500 select-none">
                            exit code {r.exit_code}
                          </p>
                        )}
                        {r.done && r.exit_code === 0 && (
                          <p className="font-mono text-xs text-slate-600 select-none">
                            concluído em {Math.floor(((r.finished_at ? new Date(r.finished_at).getTime() : Date.now()) - entry.startedAt) / 1000)}s
                          </p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="font-mono text-sm text-slate-500 mt-0.5">
                      <span className="animate-pulse">▊</span>
                      <span className="text-slate-600 text-xs ml-2 select-none">
                        {Math.floor((now - entry.startedAt) / 1000)}s — conectando ao agente...
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Blinking cursor line when idle */}
            {!anyRunning && history.length > 0 && (
              <div className="flex items-center gap-2 font-mono text-sm mt-3 select-none">
                <span className="text-blue-400">{prompt}</span>
                <span className="text-slate-100 animate-pulse">▌</span>
              </div>
            )}
          </div>

          {/* ── Input bar ── */}
          <div className="flex-shrink-0 border-t border-slate-700/60 px-5 py-3 flex items-center gap-2 bg-[#0d1117]">
            <span className="text-blue-400 font-mono text-sm flex-shrink-0 select-none">
              {prompt}
            </span>
            <input
              ref={inputRef}
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setCmdHistoryIdx(-1);
              }}
              onKeyDown={onKeyDown}
              disabled={anyRunning || noTenantSelected}
              placeholder={
                anyRunning
                  ? "executando..."
                  : noTenantSelected
                  ? "selecione um cliente acima"
                  : ""
              }
              className="flex-1 bg-transparent text-emerald-400 font-mono text-sm outline-none placeholder-slate-600 disabled:cursor-not-allowed caret-emerald-400"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {anyRunning ? (
              <span className="h-3 w-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
            ) : cmd.trim() ? (
              <button
                onClick={onRun}
                className="text-xs font-mono text-slate-500 px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
              >
                ↵
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
