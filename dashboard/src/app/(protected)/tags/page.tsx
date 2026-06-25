"use client";

import { useEffect, useState } from "react";
import { listTags, createTag, deleteTag, type Tag } from "@/lib/api";

const PRESET_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#6b7280",
];

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setTags(await listTags()); } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createTag(name.trim(), color);
      setName("");
      setColor(PRESET_COLORS[0]);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar tag");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string, tagName: string) {
    if (!confirm(`Remover tag "${tagName}"? Será desvinculada de todos os dispositivos.`)) return;
    await deleteTag(id);
    await load();
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tags</h1>
          <p className="text-slate-500 text-sm mt-1">
            Organize dispositivos com tags personalizadas. Você pode filtrar e executar comandos por tag.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          {showForm ? "Cancelar" : "+ Nova tag"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={onSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-semibold text-slate-800">Nova tag</h2>
          <div className="flex gap-4 items-end flex-wrap">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Nome</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Produção, TI, Matriz..."
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Cor</label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full transition-all ${color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : "hover:scale-105"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: color }}
            >
              {saving ? "Salvando..." : "Criar tag"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {tags.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p className="font-medium">Nenhuma tag criada</p>
            <p className="text-sm mt-1">Crie tags para organizar e filtrar seus dispositivos.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-colors">
                <span
                  className="h-4 w-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <div className="flex-1">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  Criada em {new Date(tag.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => onDelete(tag.id, tag.name)}
                  className="text-xs text-red-500 hover:text-red-700 hover:underline"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
