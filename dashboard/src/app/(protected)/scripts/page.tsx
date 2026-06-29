"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type NodeProps,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  listScripts,
  createScript,
  updateScript,
  deleteScript,
  runScript,
  listScriptRuns,
  getScriptRun,
  listDevices,
  listTags,
  type Script,
  type ScriptNode as ApiScriptNode,
  type ScriptEdge as ApiScriptEdge,
  type ScriptRun,
  type ScriptRunResult,
  type ScriptDefinition,
  type Device,
  type Tag,
} from "@/lib/api";

// ── Tipos de nós ─────────────────────────────────────────────────────────────

type NodeData = {
  label: string;
  command?: string;
  powershell?: boolean;
  timeout_seconds?: number;
  url?: string;
  destination?: string;
  message?: string;
  onSelect?: (id: string) => void;
  selected?: boolean;
};

// ── Componentes de nó customizados ────────────────────────────────────────────

function NodeWrapper({
  id,
  color,
  icon,
  data,
  preview,
}: {
  id: string;
  color: string;
  icon: React.ReactNode;
  data: NodeData;
  preview?: string;
}) {
  return (
    <div
      onClick={() => data.onSelect?.(id)}
      className={`relative rounded-xl border-2 shadow-lg cursor-pointer transition-all min-w-[200px] max-w-[260px] ${
        data.selected ? "ring-2 ring-white ring-offset-1 ring-offset-transparent" : ""
      }`}
      style={{ background: "#1e293b", borderColor: color }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: "2px solid #1e293b", width: 12, height: 12 }} />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color }}>{icon}</span>
          <span className="text-white font-semibold text-sm truncate">{data.label || "Sem título"}</span>
        </div>
        {preview && (
          <p className="text-xs font-mono text-slate-400 truncate leading-relaxed">{preview}</p>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color, border: "2px solid #1e293b", width: 12, height: 12 }} />
    </div>
  );
}

function ShellNode({ id, data }: NodeProps<Node<NodeData>>) {
  return (
    <NodeWrapper id={id} color="#3b82f6" data={data}
      icon={<svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25Zm.943 8.752a.75.75 0 0 1 .055-1.06L6.836 9l-2.588-1.693a.75.75 0 1 1 .834-1.254l3.25 2.13a.75.75 0 0 1 0 1.254l-3.25 2.13a.75.75 0 0 1-1.06-.055ZM9.75 11.25a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" /></svg>}
      preview={data.command ? (data.powershell ? "PS> " : "CMD> ") + data.command : undefined}
    />
  );
}

function DownloadNode({ id, data }: NodeProps<Node<NodeData>>) {
  return (
    <NodeWrapper id={id} color="#10b981" data={data}
      icon={<svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>}
      preview={data.url}
    />
  );
}

function NotifyNode({ id, data }: NodeProps<Node<NodeData>>) {
  return (
    <NodeWrapper id={id} color="#94a3b8" data={data}
      icon={<svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" /></svg>}
      preview={data.message}
    />
  );
}

const nodeTypes = { shell: ShellNode, download: DownloadNode, notify: NotifyNode };

// ── Utilitários ───────────────────────────────────────────────────────────────

function newNodeId() {
  return `n${Date.now().toString(36)}`;
}

function definitionToFlow(def: ScriptDefinition): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const nodes: Node<NodeData>[] = (def.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.data.label || "",
      command: n.data.command,
      powershell: n.data.powershell,
      timeout_seconds: n.data.timeout_seconds,
      url: n.data.url,
      destination: n.data.destination,
      message: n.data.message,
    },
  }));
  const edges: Edge[] = (def.edges || []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: "#475569", strokeWidth: 2 },
    animated: false,
  }));
  return { nodes, edges };
}

function flowToDefinition(nodes: Node<NodeData>[], edges: Edge[]): ScriptDefinition {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as ApiScriptNode["type"],
      position: n.position,
      data: {
        label: n.data.label,
        command: n.data.command,
        powershell: n.data.powershell,
        timeout_seconds: n.data.timeout_seconds,
        url: n.data.url,
        destination: n.data.destination,
        message: n.data.message,
      },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  };
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    running: "bg-blue-100 text-blue-700",
    done: "bg-emerald-100 text-emerald-700",
    failed: "bg-rose-100 text-rose-700",
    partial: "bg-amber-100 text-amber-700",
  };
  const labels: Record<string, string> = {
    pending: "Aguardando",
    running: "Executando",
    done: "Concluído",
    failed: "Falhou",
    partial: "Parcial",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-500"}`}>
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse" />
      )}
      {labels[status] ?? status}
    </span>
  );
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// ── Painel de configuração do nó ──────────────────────────────────────────────

function NodeConfigPanel({
  nodeId,
  nodes,
  onUpdate,
  onDelete,
  onClose,
}: {
  nodeId: string;
  nodes: Node<NodeData>[];
  onUpdate: (id: string, data: Partial<NodeData>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const { type, data } = node;

  return (
    <div className="w-72 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-sm font-semibold text-slate-700 capitalize">
          {type === "shell" ? "Comando Shell" : type === "download" ? "Download de Arquivo" : "Nota"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { onDelete(nodeId); onClose(); }}
            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            title="Remover nó"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Título do passo</label>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={data.label || ""}
            onChange={(e) => onUpdate(nodeId, { label: e.target.value })}
            placeholder="Ex: Instalar AnyDesk"
          />
        </div>

        {type === "shell" && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-500">Comando</label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onUpdate(nodeId, { powershell: false })}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${!data.powershell ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                  >CMD</button>
                  <button
                    onClick={() => onUpdate(nodeId, { powershell: true })}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${data.powershell ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                  >PS</button>
                </div>
              </div>
              <textarea
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={5}
                value={data.command || ""}
                onChange={(e) => onUpdate(nodeId, { command: e.target.value })}
                placeholder={data.powershell ? "Get-Process | Where-Object CPU -gt 100" : "echo Hello World"}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Timeout (segundos)</label>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={data.timeout_seconds || 60}
                min={5}
                max={3600}
                onChange={(e) => onUpdate(nodeId, { timeout_seconds: Number(e.target.value) })}
              />
            </div>
          </>
        )}

        {type === "download" && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">URL do arquivo</label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={data.url || ""}
                onChange={(e) => onUpdate(nodeId, { url: e.target.value })}
                placeholder="https://example.com/installer.exe"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Destino (caminho local)</label>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={data.destination || ""}
                onChange={(e) => onUpdate(nodeId, { destination: e.target.value })}
                placeholder={`C:\\Temp\\installer.exe`}
              />
              <p className="text-xs text-slate-400 mt-1">Deixe em branco para salvar em C:\Temp\</p>
            </div>
          </>
        )}

        {type === "notify" && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Mensagem / anotação</label>
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
              value={data.message || ""}
              onChange={(e) => onUpdate(nodeId, { message: e.target.value })}
              placeholder="Anotação sobre este passo do script..."
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Aba: Biblioteca / Builder ─────────────────────────────────────────────────

function BuilderTab() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await listScripts();
      setScripts(s);
      if (!selectedScript && s.length > 0) {
        openScript(s[0], s[0]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  function openScript(script: Script, _: Script) {
    setSelectedScript(script);
    setSelectedNodeId(null);
    const { nodes: n, edges: e } = definitionToFlow(script.definition);
    setNodes(n);
    setEdges(e);
    setSaveStatus("idle");
  }

  // Injeta callbacks de seleção nos dados dos nós
  const nodesWithCallbacks = nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      onSelect: setSelectedNodeId,
      selected: n.id === selectedNodeId,
    },
  }));

  function scheduleSave(newNodes: Node<NodeData>[], newEdges: Edge[]) {
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!selectedScript) return;
      try {
        const def = flowToDefinition(newNodes, newEdges);
        const updated = await updateScript(selectedScript.id, { definition: def });
        setSelectedScript(updated);
        setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
  }

  function handleNodesChange(changes: Parameters<typeof onNodesChange>[0]) {
    onNodesChange(changes);
    if (changes.some((c) => c.type === "position" || c.type === "remove")) {
      const newNodes = nodes.filter((n) => {
        const rm = changes.find((c) => c.type === "remove" && c.id === n.id);
        return !rm;
      });
      scheduleSave(newNodes, edges);
    }
  }

  function handleEdgesChange(changes: Parameters<typeof onEdgesChange>[0]) {
    onEdgesChange(changes);
    if (changes.some((c) => c.type === "remove")) {
      const newEdges = edges.filter((e) => {
        const rm = changes.find((c) => c.type === "remove" && c.id === e.id);
        return !rm;
      });
      scheduleSave(nodes, newEdges);
    }
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdges = addEdge({ ...connection, style: { stroke: "#475569", strokeWidth: 2 } }, edges);
      setEdges(newEdges);
      scheduleSave(nodes, newEdges);
    },
    [nodes, edges],
  );

  function addNode(type: "shell" | "download" | "notify") {
    const id = newNodeId();
    const defaultLabels = { shell: "Comando", download: "Download", notify: "Nota" };
    const newNode: Node<NodeData> = {
      id,
      type,
      position: { x: 100 + nodes.length * 280, y: 200 },
      data: { label: defaultLabels[type], powershell: type === "shell" ? true : undefined },
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setSelectedNodeId(id);
    scheduleSave(newNodes, edges);
  }

  function updateNodeData(id: string, data: Partial<NodeData>) {
    const newNodes = nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...data } } : n,
    );
    setNodes(newNodes);
    scheduleSave(newNodes, edges);
  }

  function deleteNode(id: string) {
    const newNodes = nodes.filter((n) => n.id !== id);
    const newEdges = edges.filter((e) => e.source !== id && e.target !== id);
    setNodes(newNodes);
    setEdges(newEdges);
    scheduleSave(newNodes, newEdges);
  }

  async function handleCreateScript() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const s = await createScript({ name: newName.trim() });
      const updated = [s, ...scripts];
      setScripts(updated);
      openScript(s, s);
      setCreatingNew(false);
      setNewName("");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteScript(id: string) {
    if (!confirm("Excluir este script?")) return;
    await deleteScript(id);
    const updated = scripts.filter((s) => s.id !== id);
    setScripts(updated);
    if (selectedScript?.id === id) {
      if (updated.length > 0) openScript(updated[0], updated[0]);
      else { setSelectedScript(null); setNodes([]); setEdges([]); }
    }
  }

  return (
    <div className="flex h-full">
      {/* Painel esquerdo — biblioteca */}
      <div className="w-64 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-3 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Biblioteca</span>
          <button
            onClick={() => setCreatingNew(true)}
            className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            title="Novo script"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
          </button>
        </div>

        {creatingNew && (
          <div className="px-3 py-2 border-b border-slate-100 bg-blue-50">
            <input
              autoFocus
              className="w-full rounded-lg border border-blue-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder="Nome do script..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateScript();
                if (e.key === "Escape") { setCreatingNew(false); setNewName(""); }
              }}
            />
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={handleCreateScript}
                disabled={saving || !newName.trim()}
                className="flex-1 text-xs py-1 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Criar
              </button>
              <button
                onClick={() => { setCreatingNew(false); setNewName(""); }}
                className="flex-1 text-xs py-1 rounded-lg bg-slate-100 text-slate-600 font-medium hover:bg-slate-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">Carregando...</div>
          ) : scripts.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">
              Nenhum script ainda.<br />Crie o primeiro!
            </div>
          ) : (
            scripts.map((s) => (
              <div
                key={s.id}
                onClick={() => openScript(s, s)}
                className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                  selectedScript?.id === s.id ? "bg-blue-50 border-r-2 border-blue-600" : "hover:bg-slate-50"
                }`}
              >
                <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: selectedScript?.id === s.id ? "#dbeafe" : "#f1f5f9" }}>
                  <svg className={`h-4 w-4 ${selectedScript?.id === s.id ? "text-blue-600" : "text-slate-400"}`} viewBox="0 0 20 20" fill="currentColor">
                    <path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v2.752l.104-.002h13.792c.035 0 .07 0 .104.002V6.75A1.75 1.75 0 0 0 15.25 5H9.378a.25.25 0 0 1-.177-.073L7.823 3.549A1.75 1.75 0 0 0 6.586 3H4.75ZM3.104 9a1.75 1.75 0 0 0-1.673 2.265l1.385 4.5A1.75 1.75 0 0 0 4.489 17h11.022a1.75 1.75 0 0 0 1.673-1.235l1.385-4.5A1.75 1.75 0 0 0 16.896 9H3.104Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${selectedScript?.id === s.id ? "text-blue-700" : "text-slate-700"}`}>{s.name}</p>
                  <p className="text-xs text-slate-400">{s.definition.nodes?.length ?? 0} passos</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteScript(s.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-rose-500 transition-all"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Canvas React Flow */}
      {selectedScript ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0">
            <span className="text-sm font-semibold text-slate-700 truncate flex-1">{selectedScript.name}</span>
            <span className={`text-xs font-medium transition-all ${
              saveStatus === "saving" ? "text-amber-500" : saveStatus === "saved" ? "text-emerald-600" : "text-transparent"
            }`}>
              {saveStatus === "saving" ? "Salvando..." : "✓ Salvo"}
            </span>
            {/* Palete de nós */}
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-xs text-slate-400 mr-1">Adicionar:</span>
              <button
                onClick={() => addNode("shell")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25Zm.943 8.752a.75.75 0 0 1 .055-1.06L6.836 9l-2.588-1.693a.75.75 0 1 1 .834-1.254l3.25 2.13a.75.75 0 0 1 0 1.254l-3.25 2.13a.75.75 0 0 1-1.06-.055ZM9.75 11.25a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" /></svg>
                Shell
              </button>
              <button
                onClick={() => addNode("download")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" /><path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" /></svg>
                Download
              </button>
              <button
                onClick={() => addNode("notify")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" /></svg>
                Nota
              </button>
            </div>
          </div>

          {/* Canvas + painel de config */}
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0" style={{ background: "#0f172a" }}>
              <ReactFlow
                nodes={nodesWithCallbacks}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={onConnect}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                deleteKeyCode="Delete"
                defaultEdgeOptions={{ style: { stroke: "#475569", strokeWidth: 2 } }}
              >
                <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={24} size={1.5} />
                <Controls showInteractive={false} style={{ background: "#1e293b", border: "1px solid #334155" }} />
                <MiniMap nodeColor={() => "#334155"} maskColor="#0f172a88" style={{ background: "#1e293b", border: "1px solid #334155" }} />
              </ReactFlow>
            </div>

            {selectedNodeId && (
              <NodeConfigPanel
                nodeId={selectedNodeId}
                nodes={nodes}
                onUpdate={updateNodeData}
                onDelete={deleteNode}
                onClose={() => setSelectedNodeId(null)}
              />
            )}
          </div>

          {nodes.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ top: "10rem" }}
            >
              <div className="text-center">
                <p className="text-slate-500 text-sm">Canvas vazio</p>
                <p className="text-slate-600 text-xs mt-1">Use os botões acima para adicionar passos</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-slate-900">
          <div className="text-center">
            <div className="h-16 w-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v2.752l.104-.002h13.792c.035 0 .07 0 .104.002V6.75A1.75 1.75 0 0 0 15.25 5H9.378a.25.25 0 0 1-.177-.073L7.823 3.549A1.75 1.75 0 0 0 6.586 3H4.75ZM3.104 9a1.75 1.75 0 0 0-1.673 2.265l1.385 4.5A1.75 1.75 0 0 0 4.489 17h11.022a1.75 1.75 0 0 0 1.673-1.235l1.385-4.5A1.75 1.75 0 0 0 16.896 9H3.104Z" />
              </svg>
            </div>
            <p className="text-slate-400 font-medium">Selecione ou crie um script</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba: Executar ─────────────────────────────────────────────────────────────

function ExecuteTab() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [targetType, setTargetType] = useState<"all" | "devices" | "tag">("all");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState<{ run_id: string; results: ScriptRunResult[] } | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  useEffect(() => {
    Promise.all([listScripts(), listDevices(), listTags()]).then(([s, d, t]) => {
      setScripts(s);
      setDevices(d);
      setTags(t);
      if (s.length > 0) setSelectedScriptId(s[0].id);
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function handleRun() {
    if (!selectedScriptId) return;
    setRunning(true);
    try {
      const body: Parameters<typeof runScript>[1] = { target_type: targetType };
      if (targetType === "devices") body.target_ids = selectedDevices;
      if (targetType === "tag") body.tag_id = selectedTag;
      const res = await runScript(selectedScriptId, body);
      startPolling(res.run_id);
    } catch (e: unknown) {
      alert((e as Error).message);
      setRunning(false);
    }
  }

  function startPolling(runId: string) {
    setActiveRun({ run_id: runId, results: [] });
    pollStartRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      // Timeout de segurança: para de polear após 20 minutos
      if (Date.now() - pollStartRef.current > 20 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRunning(false);
        return;
      }
      try {
        const data = await getScriptRun(runId);
        setActiveRun({ run_id: runId, results: data.results });
        const allDone = data.results.every((r) => r.status === "done" || r.status === "failed");
        if (allDone && data.results.length > 0) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
        }
      } catch {
        // ignore poll errors
      }
    }, 1000);
  }

  function toggleDevice(uuid: string) {
    setSelectedDevices((prev) => prev.includes(uuid) ? prev.filter((u) => u !== uuid) : [...prev, uuid]);
  }

  const selectedScriptObj = scripts.find((s) => s.id === selectedScriptId);
  const doneCount = activeRun?.results.filter((r) => r.status === "done").length ?? 0;
  const failedCount = activeRun?.results.filter((r) => r.status === "failed").length ?? 0;
  const totalCount = activeRun?.results.length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-800">Executar Script</h2>

        {/* Seleção de script */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Script</label>
          <select
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            value={selectedScriptId}
            onChange={(e) => setSelectedScriptId(e.target.value)}
          >
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.definition.nodes?.length ?? 0} passos)</option>
            ))}
          </select>
          {selectedScriptObj && (
            <p className="text-xs text-slate-400 mt-1">{selectedScriptObj.description || "Sem descrição"}</p>
          )}
        </div>

        {/* Alvo */}
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Executar em</label>
          <div className="flex gap-2">
            {(["all", "devices", "tag"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTargetType(t)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  targetType === t ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"
                }`}
              >
                {t === "all" ? "Todos dispositivos" : t === "devices" ? "Dispositivos" : "Por tag"}
              </button>
            ))}
          </div>

          {targetType === "tag" && (
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
            >
              <option value="">— Selecione uma tag —</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}

          {targetType === "devices" && (
            <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              {devices.length === 0 ? (
                <p className="text-sm text-slate-400 p-3">Nenhum dispositivo disponível</p>
              ) : (
                devices.map((d) => (
                  <label key={d.uuid} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0">
                    <input
                      type="checkbox"
                      checked={selectedDevices.includes(d.uuid)}
                      onChange={() => toggleDevice(d.uuid)}
                      className="rounded accent-blue-600"
                    />
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className="text-sm text-slate-700 truncate">{d.alias || d.hostname || d.rustdesk_id}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleRun}
          disabled={running || !selectedScriptId || (targetType === "devices" && selectedDevices.length === 0) || (targetType === "tag" && !selectedTag)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {running ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Executando...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg>
              Executar Script
            </>
          )}
        </button>
      </div>

      {/* Progresso em tempo real */}
      {activeRun && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-800">Execução em andamento</span>
              {running && <span className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-emerald-600 font-medium">{doneCount} ok</span>
              {failedCount > 0 && <span className="text-rose-600 font-medium">{failedCount} falha</span>}
              <span className="text-slate-400">/ {totalCount}</span>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="h-1.5 bg-slate-100">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: totalCount > 0 ? `${((doneCount + failedCount) / totalCount) * 100}%` : "0%" }}
            />
          </div>

          <div className="divide-y divide-slate-100">
            {activeRun.results.map((r) => (
              <div key={r.id}>
                <button
                  onClick={() => setExpandedDevice(expandedDevice === r.id ? null : r.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    r.status === "done" ? "bg-emerald-500" :
                    r.status === "failed" ? "bg-rose-500" :
                    r.status === "running" ? "bg-blue-500 animate-pulse" : "bg-slate-300"
                  }`} />
                  <span className="flex-1 text-sm font-medium text-slate-700 truncate">
                    {r.alias || r.hostname || r.rustdesk_id}
                  </span>
                  {statusBadge(r.status)}
                  {r.steps.length > 0 && (
                    <svg className={`h-4 w-4 text-slate-400 transition-transform ${expandedDevice === r.id ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>

                {expandedDevice === r.id && (
                  <div className="px-5 pb-3 space-y-2">
                    {r.error && r.steps.length === 0 && (
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 flex items-center gap-2">
                        <svg className="h-4 w-4 text-rose-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
                        <span className="text-sm text-rose-700">{r.error}</span>
                      </div>
                    )}
                    {r.steps.map((step) => (
                      <div key={step.node_id} className="rounded-xl border border-slate-100 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            step.status === "done" ? "bg-emerald-500" :
                            step.status === "failed" ? "bg-rose-500" :
                            step.status === "running" ? "bg-blue-500 animate-pulse" : "bg-slate-300"
                          }`} />
                          <span className="text-xs font-medium text-slate-600 flex-1">{step.node_label}</span>
                          {step.exit_code !== null && (
                            <span className={`text-xs font-mono ${step.exit_code === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              exit {step.exit_code}
                            </span>
                          )}
                        </div>
                        {step.output && (
                          <pre className="px-3 py-2 text-xs font-mono text-slate-300 bg-slate-900 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {step.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba: Histórico ────────────────────────────────────────────────────────────

function HistoryTab() {
  const [runs, setRuns] = useState<ScriptRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailRun, setDetailRun] = useState<{ run: ScriptRun; results: ScriptRunResult[] } | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);

  useEffect(() => {
    listScriptRuns({ limit: 50 }).then((r) => {
      setRuns(r);
      setLoading(false);
    });
  }, []);

  async function openDetail(runId: string) {
    const data = await getScriptRun(runId);
    setDetailRun(data);
    setExpandedDevice(null);
  }

  if (detailRun) {
    const { run, results } = detailRun;
    const done = results.filter((r) => r.status === "done").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return (
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto">
        <button onClick={() => setDetailRun(null)} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 mb-4 font-medium">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
          Voltar ao histórico
        </button>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-800">{run.script_name}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(run.created_at)}</p>
              </div>
              {statusBadge(run.status)}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
              <span>{results.length} dispositivos</span>
              <span className="text-emerald-600">{done} concluídos</span>
              {failed > 0 && <span className="text-rose-600">{failed} falharam</span>}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {results.map((r) => (
              <div key={r.id}>
                <button
                  onClick={() => setExpandedDevice(expandedDevice === r.id ? null : r.id)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.status === "done" ? "bg-emerald-500" : r.status === "failed" ? "bg-rose-500" : "bg-slate-300"}`} />
                  <span className="flex-1 text-sm font-medium text-slate-700 truncate">{r.alias || r.hostname || r.rustdesk_id}</span>
                  {statusBadge(r.status)}
                  {r.steps.length > 0 && (
                    <svg className={`h-4 w-4 text-slate-400 transition-transform ${expandedDevice === r.id ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>

                {expandedDevice === r.id && (
                  <div className="px-5 pb-3 space-y-2">
                    {r.error && r.steps.length === 0 && (
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 flex items-center gap-2">
                        <svg className="h-4 w-4 text-rose-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" /></svg>
                        <span className="text-sm text-rose-700">{r.error}</span>
                      </div>
                    )}
                    {r.steps.map((step) => (
                      <div key={step.node_id} className="rounded-xl border border-slate-100 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${step.status === "done" ? "bg-emerald-500" : step.status === "failed" ? "bg-rose-500" : "bg-slate-300"}`} />
                          <span className="text-xs font-medium text-slate-600 flex-1">{step.node_label}</span>
                          {step.exit_code !== null && (
                            <span className={`text-xs font-mono ${step.exit_code === 0 ? "text-emerald-600" : "text-rose-600"}`}>exit {step.exit_code}</span>
                          )}
                          <span className="text-xs text-slate-400">{formatDateTime(step.started_at)}</span>
                        </div>
                        {step.output && (
                          <pre className="px-3 py-2 text-xs font-mono text-slate-300 bg-slate-900 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {step.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Histórico de Execuções</h2>
        </div>
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Carregando...</div>
        ) : runs.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">Nenhuma execução registrada ainda.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => openDetail(r.id)}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{r.script_name}</span>
                    {statusBadge(r.status)}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                    <span>{formatDateTime(r.created_at)}</span>
                    <span>·</span>
                    <span>{r.target_type === "all" ? "Todos dispositivos" : r.target_type === "tag" ? "Por tag" : `${r.target_ids.length} dispositivos`}</span>
                    {r.total_devices !== undefined && (
                      <>
                        <span>·</span>
                        <span className="text-emerald-600">{r.done_devices ?? 0}/{r.total_devices} ok</span>
                        {(r.failed_devices ?? 0) > 0 && <span className="text-rose-600">{r.failed_devices} falha</span>}
                      </>
                    )}
                  </div>
                </div>
                <svg className="h-4 w-4 text-slate-300 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ScriptsPage() {
  const [tab, setTab] = useState<"builder" | "execute" | "history">("builder");

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header com abas */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-1 px-6 pt-4">
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900">Central de Scripts</h1>
            <p className="text-xs text-slate-400 mt-0.5">Crie e execute automações nos dispositivos dos seus clientes</p>
          </div>
        </div>
        <div className="flex gap-0 px-6 mt-3">
          {(
            [
              { key: "builder", label: "Biblioteca", icon: <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v2.752l.104-.002h13.792c.035 0 .07 0 .104.002V6.75A1.75 1.75 0 0 0 15.25 5H9.378a.25.25 0 0 1-.177-.073L7.823 3.549A1.75 1.75 0 0 0 6.586 3H4.75ZM3.104 9a1.75 1.75 0 0 0-1.673 2.265l1.385 4.5A1.75 1.75 0 0 0 4.489 17h11.022a1.75 1.75 0 0 0 1.673-1.235l1.385-4.5A1.75 1.75 0 0 0 16.896 9H3.104Z" /></svg> },
              { key: "execute", label: "Executar", icon: <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" /></svg> },
              { key: "history", label: "Histórico", icon: <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" /></svg> },
            ] as const
          ).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Conteúdo da aba */}
      <div className={`flex-1 min-h-0 ${tab === "builder" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
        {tab === "builder" && <BuilderTab />}
        {tab === "execute" && <ExecuteTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}
