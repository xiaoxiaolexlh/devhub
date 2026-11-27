import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileClock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauri, type PowerShellHistoryDocument, type PowerShellHistoryFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface Props {
  onOpenSettings: () => void;
}

type Notice = { tone: "success" | "error"; text: string } | null;

export function PowerShellHistoryPage({ onOpenSettings }: Props) {
  const [files, setFiles] = useState<PowerShellHistoryFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<PowerShellHistoryDocument | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const dirty = useMemo(
    () => Boolean(document && JSON.stringify(draft) !== JSON.stringify(document.commands)),
    [document, draft],
  );
  const visibleCommands = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return draft
      .map((command, index) => ({ command, index }))
      .filter(({ command }) => !query || command.toLocaleLowerCase().includes(query));
  }, [draft, search]);
  const selectedFile = files.find((file) => file.id === selectedId) ?? document?.file ?? null;

  useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    setLoading(true);
    try {
      const nextFiles = await tauri.powerShellHistoryList();
      setFiles(nextFiles);
      const first = nextFiles.find((file) => file.exists) ?? nextFiles[0];
      if (first) await openFile(first.id, true);
      else setNotice({ tone: "error", text: "没有找到可用的 PSReadLine 历史目录。" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function openFile(fileId: string, discardDraft = false) {
    if (!discardDraft && dirty && !window.confirm("放弃当前未保存的修改并切换历史文件？")) return;
    setLoading(true);
    setNotice(null);
    try {
      const next = await tauri.powerShellHistoryRead(fileId);
      setSelectedId(fileId);
      setDocument(next);
      setDraft(next.commands);
      setEditingIndex(null);
      setSearch("");
      setNewCommand("");
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (dirty && !window.confirm("刷新将放弃尚未保存的修改，继续吗？")) return;
    if (selectedId) await openFile(selectedId, true);
    try {
      setFiles(await tauri.powerShellHistoryList());
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  }

  function addCommand() {
    if (!newCommand.trim()) {
      setNotice({ tone: "error", text: "请输入要添加的命令。" });
      return;
    }
    setDraft((current) => [...current, newCommand]);
    setNewCommand("");
    setNotice(null);
  }

  function beginEdit(index: number, command: string) {
    setEditingIndex(index);
    setEditingText(command);
  }

  function applyEdit() {
    if (editingIndex === null) return;
    setDraft((current) => current.map((command, index) => index === editingIndex ? editingText : command));
    setEditingIndex(null);
    setNotice(null);
  }

  function deleteCommand(index: number) {
    if (!window.confirm(`从待保存历史中删除第 ${index + 1} 条命令？`)) return;
    setDraft((current) => current.filter((_, currentIndex) => currentIndex !== index));
    if (editingIndex === index) setEditingIndex(null);
  }

  async function save() {
    if (!document || !selectedId || !dirty) return;
    if (!window.confirm(
      `将 ${draft.length} 条命令写入此 PSReadLine 历史文件？\n\n${document.file.path}\n\n请确认所有 PowerShell 和 VS Code PowerShell 会话均已关闭。现有文件会先生成 .bak 备份；此操作不会执行命令。`,
    )) return;

    setSaving(true);
    setNotice(null);
    try {
      const result = await tauri.powerShellHistorySave(
        selectedId,
        draft,
        document.revision,
      );
      setDocument(result.document);
      setDraft(result.document.commands);
      setFiles((current) => current.map((file) => file.id === selectedId ? result.document.file : file));
      setNotice({
        tone: "success",
        text: result.backupPath
          ? `历史已保存。备份：${result.backupPath}`
          : "历史文件已创建并保存。",
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
      <AppHeader
        title="PowerShell 历史"
        subtitle="管理当前 Windows 用户的 PSReadLine 命令记录"
        onOpenSettings={onOpenSettings}
        rightActions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading || saving}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty || saving || loading}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存修改
            </Button>
          </>
        )}
      />

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">历史文件</div>
            <div className="mt-1 text-xs text-fg-muted">默认 PSReadLine 历史位置（自定义路径不会自动发现）</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {files.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => void openFile(file.id)}
                className={cn(
                  "mb-1 flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-bg-muted",
                  selectedId === file.id && "bg-accent/10 text-accent",
                )}
              >
                <FileClock className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{file.shell}</span>
                  <span className="mt-0.5 block truncate text-[11px] opacity-75">{file.fileName}</span>
                  <span className="mt-1 block text-[10px] text-fg-subtle">{file.exists ? "已存在" : "尚未创建"}</span>
                </span>
              </button>
            ))}
            {!files.length && !loading && <p className="px-3 py-4 text-xs text-fg-muted">没有可用的历史文件。</p>}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{selectedFile?.fileName ?? "请选择历史文件"}</div>
              <div className="mt-1 truncate text-xs text-fg-muted">{selectedFile?.path ?? ""}</div>
            </div>
            <div className="text-xs text-fg-muted">{draft.length} 条命令{dirty && <span className="ml-2 text-warning">有未保存修改</span>}</div>
          </div>

          <div className="shrink-0 border-b border-border px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-fg-muted">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              历史记录是明文；保存会修改所选文件并自动备份。请先关闭所有 PowerShell 和 VS Code PowerShell 会话，避免活动会话再次写入或覆盖修改。
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={newCommand}
                onChange={(event) => setNewCommand(event.target.value)}
                placeholder="输入要添加的命令（仅写入历史，不会执行）"
                rows={2}
                className="min-h-14 flex-1 resize-y rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <Button onClick={addCommand} disabled={!document}>
                <Plus className="h-4 w-4" />
                添加
              </Button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <Search className="h-4 w-4 text-fg-subtle" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索命令..." className="max-w-lg" />
            <span className="ml-auto text-xs text-fg-subtle">显示 {visibleCommands.length} 条</span>
          </div>

          {notice && (
            <div className={cn(
              "mx-4 mt-3 rounded-lg border px-3 py-2 text-xs",
              notice.tone === "success" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger",
            )}>
              {notice.text}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取历史...</div>
            ) : !selectedFile ? (
              <div className="flex h-full items-center justify-center text-sm text-fg-muted">请先选择历史文件。</div>
            ) : visibleCommands.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-sm text-fg-muted">
                <FileClock className="mb-2 h-8 w-8 opacity-40" />
                {draft.length ? "没有匹配的命令。" : "此历史文件暂无命令。可在上方添加。"}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleCommands.map(({ command, index }) => (
                  <article key={`${index}-${command.slice(0, 18)}`} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] text-fg-subtle">
                      <span>#{index + 1}</span>
                      <div className="ml-auto flex items-center gap-1">
                        {editingIndex === index ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={applyEdit} title="应用修改"><Check className="h-3.5 w-3.5" />完成</Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditingIndex(null)} title="取消编辑"><X className="h-3.5 w-3.5" />取消</Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => beginEdit(index, command)} title="编辑命令"><Pencil className="h-3.5 w-3.5" />编辑</Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteCommand(index)} title="删除命令" className="text-danger hover:text-danger"><Trash2 className="h-3.5 w-3.5" />删除</Button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingIndex === index ? (
                      <textarea
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                        rows={Math.min(8, Math.max(2, editingText.split("\n").length))}
                        className="w-full resize-y rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-xs text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-fg">{command}</pre>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
