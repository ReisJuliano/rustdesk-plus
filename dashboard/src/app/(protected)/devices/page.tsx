"use client";

import { useEffect, useRef, useState } from "react";
import {
  listBranches, listDevices, setDeviceBranch, toggleFavorite,
  deleteDevice, patchDevice, listTags, listDeviceTags, addDeviceTag, removeDeviceTag,
  getAllDeviceTags, getServerConfig,
  type Branch, type Device, type Tag, type DeviceTagRow,
} from "@/lib/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtId(id: string) {
  return id.replace(/(\d{3})(?=\d)/g, "$1 ");
}

function isNumericId(id: string) {
  return /^\d+$/.test(id.trim());
}

function connectDevice(id: string, password?: string) {
  if (isNumericId(id)) {
    const uri = password ? `rustdesk://${id}?password=${encodeURIComponent(password)}` : `rustdesk://${id}`;
    window.open(uri, "_blank");
  }
  // IDs não numéricos (agent:HOSTNAME) são placeholders temporários.
  // O RustDesk substituirá automaticamente quando enviar o heartbeat.
}

function fmtOnlineSince(since: string | null) {
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `Online há ${h}h${m > 0 ? ` ${m}min` : ""}`;
  if (m > 0) return `Online há ${m}min`;
  return "Online agora";
}

function fmtLastSeen(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

type OS = "windows" | "linux" | "mac" | "other";
function detectOS(os: string | null): OS {
  if (!os) return "other";
  const l = os.toLowerCase();
  if (l.includes("windows")) return "windows";
  if (l.includes("linux") || l.includes("ubuntu") || l.includes("debian")) return "linux";
  if (l.includes("mac") || l.includes("darwin")) return "mac";
  return "other";
}

function OsIcon({ os, className }: { os: string | null; className?: string }) {
  const type = detectOS(os);
  if (type === "windows")
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 5.6 10.5 4.5v7.5H3V5.6zM3 18.4 10.5 19.5V12H3v6.4zM11.5 4.35 21 3v9h-9.5V4.35zM11.5 19.65 21 21v-9h-9.5v7.65z" />
      </svg>
    );
  if (type === "linux")
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.5 2C9.5 2 7 5 7 8c0 1.5.5 2.8 1.2 3.8L6.5 16c-.3.8.2 1.5 1 1.5H8l.5-1c.6.6 1.5 1 2.5 1h3c1 0 1.9-.4 2.5-1l.5 1h.5c.8 0 1.3-.7 1-1.5l-1.7-4.2C17.5 10.8 18 9.5 18 8c0-3-2.5-6-5.5-6zm0 2c2 0 3.5 2 3.5 4 0 .9-.3 1.7-.7 2.3H9.7C9.3 9.7 9 8.9 9 8c0-2 1.5-4 3.5-4zM10 15l.5 1h3l.5-1H10z" />
      </svg>
    );
  if (type === "mac")
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.42c1.28.07 2.18.75 2.92.76.9-.15 1.74-.82 3.1-.82 1.97.08 3.44.97 4.39 2.5-3.53 2.08-2.53 7.11 1.09 8.32-.51 1.2-1.12 2.36-3.5 2.1zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    );
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-slate-400 hover:text-blue-600"
      title="Copiar ID"
    >
      {ok ? (
        <svg className="h-3 w-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// ── Modal de detalhes ─────────────────────────────────────────────────────────

function DeviceModal({
  device, branches, password, onClose, onRefresh,
}: {
  device: Device; branches: Branch[]; password: string; onClose: () => void; onRefresh: () => void;
}) {
  const [alias, setAlias] = useState(device.alias ?? "");
  const [description, setDescription] = useState(device.description ?? "");
  const [branchId, setBranchId] = useState(device.branch_id ?? "");
  const [saving, setSaving] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [deviceTagIds, setDeviceTagIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([listTags(), listDeviceTags(device.id)]).then(([all, mine]) => {
      setAllTags(all);
      setDeviceTagIds(new Set(mine.map((t) => t.id)));
    }).catch(() => {});
  }, [device.id]);

  async function onToggleTag(tagId: string) {
    if (deviceTagIds.has(tagId)) {
      await removeDeviceTag(device.id, tagId);
      setDeviceTagIds((prev) => { const s = new Set(prev); s.delete(tagId); return s; });
    } else {
      await addDeviceTag(device.id, tagId);
      setDeviceTagIds((prev) => new Set([...prev, tagId]));
    }
  }

  async function onSave() {
    setSaving(true);
    try {
      await patchDevice(device.id, { alias: alias.trim(), description: description.trim() });
      await setDeviceBranch(device.id, branchId || null);
      onRefresh();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function onFavorite() {
    await toggleFavorite(device.id);
    onRefresh();
    onClose();
  }

  async function onDelete() {
    if (!confirm(`Remover "${device.alias || device.hostname || device.rustdesk_id}"?`)) return;
    await deleteDevice(device.id);
    onRefresh();
    onClose();
  }

  const displayName = device.alias || device.hostname || device.rustdesk_id;
  const branch = branches.find((b) => b.id === device.branch_id);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-4 flex items-start gap-3 ${device.online ? "bg-emerald-50" : "bg-slate-50"}`}>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${device.online ? "bg-emerald-100" : "bg-slate-100"}`}>
            <OsIcon os={device.os} className={`h-5 w-5 ${device.online ? "text-emerald-600" : "text-slate-400"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${device.online ? "bg-emerald-500" : "bg-slate-300"}`} />
              <h2 className="font-bold text-slate-900 truncate">{displayName}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{device.os ?? "SO desconhecido"}</p>
            {device.online && device.online_since && (
              <p className="text-xs text-emerald-600 font-medium">{fmtOnlineSince(device.online_since)}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Info chips */}
        <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-slate-100">
          <div className="group flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-xs text-slate-600 font-mono">
            {fmtId(device.rustdesk_id)}
            <CopyBtn text={device.rustdesk_id} />
          </div>
          {device.ip_address && (
            <div className="group flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-xs text-slate-600 font-mono">
              {device.ip_address}
              <CopyBtn text={device.ip_address} />
            </div>
          )}
          {branch && (
            <span className="bg-blue-50 text-blue-600 rounded-full px-3 py-1 text-xs font-medium">
              {branch.name}
            </span>
          )}
        </div>

        {/* Edit fields */}
        <div className="px-6 py-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Apelido</label>
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={device.hostname || "Ex: Recepção Principal"}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Observações sobre este dispositivo..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white resize-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Filial</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Sem filial</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tags</label>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => {
                  const active = deviceTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => onToggleTag(tag.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border-2 transition-all ${
                        active
                          ? "text-white border-transparent shadow-md"
                          : "bg-white border-slate-100 text-slate-600 hover:border-slate-300 hover:shadow-sm"
                      }`}
                      style={active ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
                    >
                      {active ? (
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      )}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {allTags.length === 0 && (
            <p className="text-xs text-slate-400">
              Nenhuma tag cadastrada.{" "}
              <a href="/branches" className="text-blue-600 hover:underline">Criar tags em Filiais & Tags</a>
            </p>
          )}

          <div className="flex gap-3 text-xs text-slate-400 pt-1">
            <span>Criado: {fmtLastSeen(device.created_at)}</span>
            <span>·</span>
            <span>Visto: {fmtLastSeen(device.last_seen_at)}</span>
          </div>
        </div>

        {/* Actions */}
        {password && isNumericId(device.rustdesk_id) && (
          <div className="px-6 pb-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">Senha:</span>
            <span className="font-mono text-xs font-bold text-slate-700 tracking-widest bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 select-all">{password}</span>
            <CopyBtn text={password} />
          </div>
        )}
        <div className="px-6 pb-5 flex gap-2">
          <button
            onClick={onFavorite}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
              device.favorite
                ? "border-amber-300 bg-amber-50 text-amber-600"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={device.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {device.favorite ? "Favorito" : "Favoritar"}
          </button>
          <button
            onClick={() => connectDevice(device.rustdesk_id, password)}
            disabled={!isNumericId(device.rustdesk_id)}
            title={!isNumericId(device.rustdesk_id) ? "Aguardando ID do RustDesk..." : undefined}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isNumericId(device.rustdesk_id) ? "Conectar" : "Aguardando..."}
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
            title="Remover"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function DeviceCard({
  device, branches, tags, password, onRefresh, onClick,
}: {
  device: Device; branches: Branch[]; tags: Tag[]; password: string; onRefresh: () => void; onClick: () => void;
}) {
  async function onToggleFav(e: React.MouseEvent) {
    e.stopPropagation();
    await toggleFavorite(device.id);
    onRefresh();
  }

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Remover "${device.alias || device.hostname || device.rustdesk_id}"?`)) return;
    await deleteDevice(device.id);
    onRefresh();
  }

  const displayName = device.alias || device.hostname || device.rustdesk_id;
  const branch = branches.find((b) => b.id === device.branch_id);
  const osType = detectOS(device.os);
  const osColors: Record<string, string> = {
    windows: "text-blue-600 bg-blue-50",
    linux: "text-orange-600 bg-orange-50",
    mac: "text-slate-600 bg-slate-100",
    other: "text-slate-600 bg-slate-100",
  };

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-2xl border flex flex-col cursor-pointer transition-all hover:shadow-md hover:border-slate-300 select-none ${
        device.online ? "border-slate-200" : "border-slate-100 opacity-75"
      }`}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <button onClick={onToggleFav} className={`p-1 rounded transition-colors ${device.favorite ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill={device.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${device.online ? "bg-emerald-500" : "bg-slate-300"}`} />
          <span className={`text-xs font-medium ${device.online ? "text-emerald-600" : "text-slate-400"}`}>
            {device.online ? (device.online_since ? fmtOnlineSince(device.online_since) : "Online") : "Offline"}
          </span>
        </div>
      </div>

      {/* OS Icon */}
      <div className="flex justify-center py-3">
        <div className={`h-14 w-14 rounded-2xl flex items-center justify-center ${osColors[osType]}`}>
          <OsIcon os={device.os} className="h-7 w-7" />
        </div>
      </div>

      {/* Name */}
      <div className="px-3 text-center space-y-0.5">
        <p className="text-sm font-semibold text-slate-900 truncate" title={displayName}>{displayName}</p>
        <p className="text-xs text-slate-400">{device.os ?? "SO desconhecido"}</p>
        <p className="text-xs text-slate-400 font-mono group flex items-center justify-center gap-0.5">
          {fmtId(device.rustdesk_id)}
        </p>
        {device.ip_address && (
          <p className="text-xs text-slate-300 font-mono">{device.ip_address}</p>
        )}
      </div>

      {/* Branch + Tags */}
      <div className="px-3 mt-2 space-y-1.5">
        <div className="flex justify-center min-h-[20px]">
          {branch ? (
            <span className="bg-blue-50 text-blue-600 text-xs rounded-full px-2.5 py-0.5 font-medium">{branch.name}</span>
          ) : (
            <span className="text-xs text-slate-200">Sem filial</span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-center">
            {tags.map((t) => (
              <span key={t.id} className="text-white text-xs rounded-full px-2 py-0.5 font-semibold leading-none"
                style={{ backgroundColor: t.color, fontSize: "10px" }}>
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-3 pb-3 mt-3">
        <button
          onClick={(e) => { e.stopPropagation(); connectDevice(device.rustdesk_id, password); }}
          disabled={!isNumericId(device.rustdesk_id)}
          title={!isNumericId(device.rustdesk_id) ? "Aguardando ID do RustDesk..." : undefined}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isNumericId(device.rustdesk_id) ? "Conectar" : "Aguardando..."}
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-xl border border-slate-200 text-slate-300 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
          title="Remover"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Filter = "all" | "online" | "offline" | "favorites";
type SortKey = "name" | "status" | "last_seen" | "branch";
type ViewMode = "grid" | "list" | "compact";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selected, setSelected] = useState<Device | null>(null);
  const [deviceTagMap, setDeviceTagMap] = useState<Map<string, Tag[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [rdPassword, setRdPassword] = useState("");

  async function load() {
    try {
      const f: Record<string, unknown> = {};
      if (branchFilter) f.branch_id = branchFilter;
      if (search) f.search = search;
      if (statusFilter === "online") f.online = true;
      if (statusFilter === "offline") f.online = false;
      if (statusFilter === "favorites") f.favorite = true;
      const [d, b, allDT] = await Promise.all([listDevices(f), listBranches(), getAllDeviceTags()]);

      // Build device → tags map
      const tagMap = new Map<string, Tag[]>();
      for (const row of allDT) {
        if (!tagMap.has(row.device_id)) tagMap.set(row.device_id, []);
        tagMap.get(row.device_id)!.push({ id: row.tag_id, name: row.name, color: row.color, created_at: "" });
      }
      setDeviceTagMap(tagMap);

      // Sort client-side
      d.sort((a, b) => {
        if (sortKey === "status") return (b.online ? 1 : 0) - (a.online ? 1 : 0);
        if (sortKey === "name") return (a.alias || a.hostname || a.rustdesk_id).localeCompare(b.alias || b.hostname || b.rustdesk_id);
        if (sortKey === "last_seen") return new Date(b.last_seen_at ?? 0).getTime() - new Date(a.last_seen_at ?? 0).getTime();
        if (sortKey === "branch") return (a.branch_id ?? "zzz").localeCompare(b.branch_id ?? "zzz");
        return 0;
      });
      // favorites always first
      d.sort((a, b2) => (b2.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

      setDevices(d);
      setBranches(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao carregar");
    }
  }

  useEffect(() => {
    getServerConfig().then((cfg) => setRdPassword(cfg.rustdesk_password ?? "")).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter, search, statusFilter, sortKey]);

  const onlineCount = devices.filter((d) => d.online).length;

  return (
    <>
      {selected && (
        <DeviceModal
          device={selected}
          branches={branches}
          password={rdPassword}
          onClose={() => setSelected(null)}
          onRefresh={() => { load(); setSelected(null); }}
        />
      )}

      <div className="p-6 space-y-5 bg-slate-50 min-h-full">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dispositivos</h1>
          <p className="text-slate-500 text-sm mt-1">
            {devices.length} dispositivo{devices.length !== 1 ? "s" : ""} ·{" "}
            <span className="text-emerald-600 font-medium">{onlineCount} online</span>
            <span className="text-slate-300 mx-1">·</span>
            <span className="text-slate-400">Clique em um card para configurar</span>
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            placeholder="Buscar nome, ID, IP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-52"
          />
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Todas as filiais</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {(["all", "online", "offline", "favorites"] as Filter[]).map((f) => {
              const labels: Record<Filter, string> = { all: "Todos", online: "Online", offline: "Offline", favorites: "★" };
              return (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-3.5 py-2 text-xs font-medium transition-colors ${statusFilter === f ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                  {labels[f]}
                </button>
              );
            })}
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="status">↕ Status</option>
            <option value="name">↕ Nome</option>
            <option value="last_seen">↕ Último acesso</option>
            <option value="branch">↕ Filial</option>
          </select>

          {/* View mode toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden ml-auto">
            {([
              { mode: "grid" as ViewMode, icon: "⊞", title: "Cards" },
              { mode: "list" as ViewMode, icon: "☰", title: "Lista" },
              { mode: "compact" as ViewMode, icon: "⊟", title: "Compacto" },
            ]).map(({ mode, icon, title }) => (
              <button key={mode} onClick={() => setViewMode(mode)} title={title}
                className={`px-3 py-2 text-sm transition-colors ${viewMode === mode ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {icon}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Grid */}
        {devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">Nenhum dispositivo encontrado</p>
            <p className="text-slate-400 text-sm mt-1">
              Os PCs aparecem automaticamente quando o RustDesk conecta ao servidor.
            </p>
          </div>
        ) : (
          <>
            {/* Grid view */}
            {viewMode === "grid" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                {devices.map((d) => (
                  <DeviceCard key={d.id} device={d} branches={branches} tags={deviceTagMap.get(d.id) ?? []} password={rdPassword} onRefresh={load} onClick={() => setSelected(d)} />
                ))}
              </div>
            )}

            {/* List view */}
            {viewMode === "list" && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Nome</th>
                      <th className="px-4 py-3">SO</th>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">IP</th>
                      <th className="px-4 py-3">Filial</th>
                      <th className="px-4 py-3">Visto</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {devices.map((d) => {
                      const branch = branches.find((b) => b.id === d.branch_id);
                      return (
                        <tr key={d.id} onClick={() => setSelected(d)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                          <td className="px-4 py-2.5">
                            <span className={`h-2 w-2 rounded-full inline-block ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {d.favorite && <span className="text-amber-400 text-xs">★</span>}
                              <span className="font-medium text-slate-900">{d.alias || d.hostname || d.rustdesk_id}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><OsIcon os={d.os} className="h-4 w-4 text-slate-500" /></td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{fmtId(d.rustdesk_id)}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{d.ip_address ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            {branch ? <span className="bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 text-xs">{branch.name}</span> : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-400">{fmtLastSeen(d.last_seen_at)}</td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); connectDevice(d.rustdesk_id, rdPassword); }}
                              disabled={!isNumericId(d.rustdesk_id)}
                              title={!isNumericId(d.rustdesk_id) ? "Aguardando ID do RustDesk..." : undefined}
                              className="text-xs text-blue-600 hover:underline disabled:text-slate-300 disabled:cursor-not-allowed"
                            >
                              {isNumericId(d.rustdesk_id) ? "Conectar" : "Aguardando..."}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Compact view */}
            {viewMode === "compact" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {devices.map((d) => {
                  const branch = branches.find((b) => b.id === d.branch_id);
                  return (
                    <div key={d.id} onClick={() => setSelected(d)}
                      className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md hover:border-slate-300 transition-all">
                      <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <OsIcon os={d.os} className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{d.alias || d.hostname || d.rustdesk_id}</p>
                        <p className="text-xs text-slate-400 font-mono">{d.ip_address ?? fmtId(d.rustdesk_id)}</p>
                      </div>
                      {branch && <span className="text-xs bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 flex-shrink-0">{branch.name}</span>}
                      {d.favorite && <span className="text-amber-400 text-xs flex-shrink-0">★</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
