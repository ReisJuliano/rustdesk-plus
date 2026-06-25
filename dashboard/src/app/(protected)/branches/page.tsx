"use client";

import { useEffect, useState } from "react";
import {
  listBranches, createBranch, deleteBranch,
  listTags, createTag, deleteTag,
  type Branch, type Tag,
} from "@/lib/api";

const PRESET_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6b7280",
];

type Tab = "branches" | "tags";

export default function BranchesPage() {
  const [tab, setTab] = useState<Tab>("branches");

  // Branches
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [savingBranch, setSavingBranch] = useState(false);

  // Tags
  const [tags, setTags] = useState<Tag[]>([]);
  const [showTagForm, setShowTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0]);
  const [savingTag, setSavingTag] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function loadBranches() {
    setBranches(await listBranches());
  }
  async function loadTags() {
    setTags(await listTags());
  }

  useEffect(() => {
    loadBranches();
    loadTags();
  }, []);

  // ── Branch handlers ──────────────────────────────────────────────────────
  async function onCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    setSavingBranch(true);
    setError(null);
    try {
      await createBranch(newBranchName.trim(), newParentId || undefined);
      setNewBranchName(""); setNewParentId(""); setShowBranchForm(false);
      await loadBranches();
    } catch (err) { setError(err instanceof Error ? err.message : "Erro"); }
    finally { setSavingBranch(false); }
  }

  async function onDeleteBranch(id: string, name: string) {
    if (!confirm(`Remover filial "${name}"?`)) return;
    setError(null);
    try { await deleteBranch(id); await loadBranches(); }
    catch (err) { setError(err instanceof Error ? err.message : "Erro"); }
  }

  // ── Tag handlers ─────────────────────────────────────────────────────────
  async function onCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setSavingTag(true);
    setError(null);
    try {
      await createTag(newTagName.trim(), newTagColor);
      setNewTagName(""); setNewTagColor(PRESET_COLORS[0]); setShowTagForm(false);
      await loadTags();
    } catch (err) { setError(err instanceof Error ? err.message : "Erro"); }
    finally { setSavingTag(false); }
  }

  async function onDeleteTag(id: string, name: string) {
    if (!confirm(`Remover tag "${name}"?`)) return;
    try { await deleteTag(id); await loadTags(); }
    catch (err) { setError(err instanceof Error ? err.message : "Erro"); }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header + tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-slate-100 rounded-2xl p-1">
          {(["branches", "tags"] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setError(null); }}
              className={`px-5 py-1.5 rounded-xl text-sm transition-all ${
                tab === t
                  ? "bg-white text-blue-600 shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-600 font-medium"
              }`}>
              {t === "branches" ? "Filiais" : "Tags"}
            </button>
          ))}
        </div>

        {tab === "branches" ? (
          <button onClick={() => setShowBranchForm((v) => !v)}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
            {showBranchForm ? "Cancelar" : "+ Nova filial"}
          </button>
        ) : (
          <button onClick={() => setShowTagForm((v) => !v)}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
            {showTagForm ? "Cancelar" : "+ Nova tag"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-500">{error}</div>
      )}

      {/* ── Filiais ──────────────────────────────────────────────────────── */}
      {tab === "branches" && (
        <>
          {showBranchForm && (
            <form onSubmit={onCreateBranch}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Nova filial</h2>
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Nome</label>
                  <input required value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="Ex: Filial Centro"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Filial pai</label>
                  <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                    <option value="">Nenhuma</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <button type="submit" disabled={savingBranch}
                  className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {savingBranch ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3">Filial pai</th>
                  <th className="px-5 py-3">Criada em</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.map((b) => {
                  const parent = branches.find((p) => p.id === b.parent_id);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900">{b.name}</td>
                      <td className="px-5 py-3 text-slate-500">{parent?.name ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-400">{new Date(b.created_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => onDeleteBranch(b.id, b.name)}
                          className="rounded-2xl text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 transition-colors">
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {branches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                      Nenhuma filial cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      {tab === "tags" && (
        <>
          {showTagForm && (
            <form onSubmit={onCreateTag}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Nova tag</h2>
              <div className="flex gap-4 items-end flex-wrap">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Nome</label>
                  <input required value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Ex: Produção, TI, Matriz..."
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Cor</label>
                  <div className="flex gap-2 flex-wrap">
                    {PRESET_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setNewTagColor(c)}
                        className={`h-7 w-7 rounded-full transition-all ${newTagColor === c ? "ring-2 ring-offset-2 ring-blue-500 scale-110" : "hover:scale-105"}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <button type="submit" disabled={savingTag}
                  className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: newTagColor }}>
                  {savingTag ? "Salvando..." : "Criar tag"}
                </button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {tags.length === 0 ? (
              <div className="py-12 text-center">
                <p className="font-semibold text-slate-400">Nenhuma tag criada</p>
                <p className="text-sm mt-1 text-slate-400">Tags permitem filtrar dispositivos e executar comandos em grupos.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-colors">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: tag.color }}>
                      {tag.name}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">
                      Criada em {new Date(tag.created_at).toLocaleDateString()}
                    </span>
                    <button onClick={() => onDeleteTag(tag.id, tag.name)}
                      className="rounded-2xl text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50 px-2 py-1 transition-colors">
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
