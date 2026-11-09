import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { isEditableEnvironmentVariable, linesToPath, pathToLines, validateEnvironmentVariable } from "@/lib/environment";
import {
  tauri, type EnvironmentChangeResult, type EnvironmentScope,
  type EnvironmentSnapshot, type EnvironmentVariable,
} from "@/lib/tauri";

const scopeLabel = (scope: EnvironmentScope) => scope === "user" ? "用户变量" : "系统变量";
type Notice = { tone: "success" | "warning"; text: string } | null;
type Editor = {
  scope: EnvironmentScope;
  original: EnvironmentVariable | null;
  readOnly: boolean;
};
type Deletion = { scope: EnvironmentScope; variable: EnvironmentVariable };
const textAreaClass = "w-full resize-y rounded-md border border-border bg-bg p-3 font-mono text-xs leading-6 text-fg focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60";

export function EnvironmentVariablesSettings() {
  const [scope, setScope] = useState<EnvironmentScope>("user");
  const [snapshot, setSnapshot] = useState<EnvironmentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<EnvironmentVariable>({ name: "", value: "", value_type: 2 });
  const [pathLines, setPathLines] = useState(false);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);

  const load = useCallback(async (targetScope: EnvironmentScope) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setSnapshot(null);
    setLoadError(null);
    try {
      const result = await tauri.environmentList(targetScope);
      if (sequence === loadSequence.current) setSnapshot(result);
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(String(error));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
    return () => { loadSequence.current++; };
  }, [load, scope]);

  function switchScope(next: EnvironmentScope) {
    if (next === scope || busyRef.current || editor || deletion) return;
    setSnapshot(null);
    setNotice(null);
    setLoadError(null);
    setLoading(true);
    setScope(next);
  }

  function openEditor(original: EnvironmentVariable | null) {
    if (!snapshot || busyRef.current) return;
    const variable = original ?? { name: "", value: "", value_type: 2 };
    setDraft({ ...variable });
    setPathLines(variable.name.toLowerCase() === "path" && !/[\r\n]/.test(variable.value));
    setActionError(null);
    setEditor({ scope, original, readOnly: !snapshot.writable || !!original && !isEditableEnvironmentVariable(original) });
  }

  function showChangeResult(result: EnvironmentChangeResult, text: string) {
    setNotice({
      tone: result.notification_sent ? "success" : "warning",
      text: result.notification_sent
        ? `${text}。请重新打开终端或相关程序以使用新值。`
        : `${text}，但部分程序未响应环境更新通知。请重新打开相关程序，必要时注销后登录。`,
    });
  }

  async function save() {
    if (!editor || editor.readOnly || busyRef.current) return;
    const validation = validateEnvironmentVariable(draft);
    if (validation) { setActionError(validation); return; }
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await tauri.environmentSave(editor.scope, draft, editor.original);
      showChangeResult(result, `已${editor.original ? "修改" : "新增"}${scopeLabel(editor.scope)}「${draft.name}」`);
      setEditor(null);
      await load(editor.scope);
    } catch (error) {
      setActionError(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (!deletion || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await tauri.environmentDelete(deletion.scope, deletion.variable);
      showChangeResult(result, `已删除${scopeLabel(deletion.scope)}「${deletion.variable.name}」`);
      setDeletion(null);
      await load(deletion.scope);
    } catch (error) {
      setActionError(String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const keyword = query.toLowerCase();
  const variables = snapshot?.variables.filter((entry) =>
    entry.name.toLowerCase().includes(keyword) || entry.value.toLowerCase().includes(keyword),
  ) ?? [];
  const isPath = draft.name.toLowerCase() === "path";

  return (
    <section aria-labelledby="environment-title" className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <SlidersHorizontal className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="environment-title" className="text-lg font-semibold">Windows 环境变量</h2>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            管理持久保存的用户变量和系统变量。修改后请重新打开终端或程序；DevHub 启动的任务需重新打开 DevHub 后使用新值。
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-bg p-1" aria-label="环境变量范围">
          {(["user", "system"] as const).map((item) => (
            <Button key={item} size="sm" variant={scope === item ? "primary" : "ghost"}
              aria-pressed={scope === item} disabled={busy || !!editor || !!deletion}
              onClick={() => switchScope(item)}>{scopeLabel(item)}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void load(scope)} disabled={loading || busy}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />刷新
          </Button>
          <Button size="sm" variant="primary" disabled={!snapshot?.writable || loading || busy} onClick={() => openEditor(null)}>
            <Plus className="h-3.5 w-3.5" />新增变量
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        {scope === "user" ? "对当前 Windows 用户生效。" : "对所有 Windows 用户生效，修改通常需要管理员权限。"}
        {snapshot && !snapshot.writable && " 当前为只读，请以有权限的账号（系统变量需管理员）重新打开 DevHub 后修改。"}
      </p>
      {notice && (
        <p role="status" className={cn("mt-3 rounded-md border p-3 text-xs leading-5", notice.tone === "success"
          ? "border-success/20 bg-success/5 text-success" : "border-warning/20 bg-warning/5 text-warning")}>{notice.text}</p>
      )}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-fg-muted" />
        <Input className="pl-9" aria-label="搜索环境变量" placeholder="搜索变量名或值…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <div className="mt-3 max-h-[440px] overflow-auto rounded-lg border border-border bg-bg" aria-busy={loading}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" />正在读取{scopeLabel(scope)}…</div>
        ) : loadError ? (
          <p role="alert" className="break-words p-5 text-sm text-danger">{loadError}</p>
        ) : variables.length === 0 ? (
          <p className="py-12 text-center text-sm text-fg-muted">{query ? "没有匹配的环境变量" : "暂无环境变量"}</p>
        ) : (
          <table className="w-full table-fixed text-left text-xs">
            <thead className="sticky top-0 z-10 bg-bg-muted text-fg-muted"><tr>
              <th className="w-[28%] px-3 py-2 font-medium">变量名</th>
              <th className="px-3 py-2 font-medium">变量值</th>
              <th className="w-28 px-3 py-2 text-right font-medium">操作</th>
            </tr></thead>
            <tbody>{variables.map((entry) => {
              const writable = snapshot?.writable && isEditableEnvironmentVariable(entry);
              return (
                <tr key={entry.name} className="border-t border-border hover:bg-bg-subtle">
                  <td className="break-all px-3 py-3 align-top font-mono font-medium">{entry.name}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="line-clamp-2 break-all whitespace-pre-wrap font-mono text-fg-muted">
                      {isEditableEnvironmentVariable(entry) ? entry.value || "（空值）" : `不支持的类型 (${entry.value_type})，只读`}
                    </div>
                    {entry.value_type === 2 && <span className="mt-1 inline-block text-[10px] text-fg-subtle">可展开变量引用</span>}
                  </td>
                  <td className="px-2 py-2 align-top"><div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={`${writable ? "编辑" : "查看"} ${entry.name}`} onClick={() => openEditor(entry)}>
                      <Pencil className="h-3 w-3" />{writable ? "编辑" : "查看"}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-danger" disabled={!writable || busy}
                      aria-label={`删除 ${entry.name}`} title={`删除 ${entry.name}`}
                      onClick={() => { setActionError(null); setDeletion({ scope, variable: entry }); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {snapshot && <p className="mt-2 text-xs text-fg-subtle">{scopeLabel(scope)} · 显示 {variables.length} / {snapshot.variables.length} 个</p>}

      <Dialog open={!!editor} onOpenChange={(open) => { if (!open && !busyRef.current) setEditor(null); }}>
        <DialogContent width="max-w-2xl" showClose={!busy}>
          <DialogHeader>
            <DialogTitle>{editor?.readOnly ? "查看" : editor?.original ? "编辑" : "新增"}环境变量</DialogTitle>
            <DialogDescription className="text-xs text-fg-muted">
              {editor && scopeLabel(editor.scope)} · {editor?.original ? "变量名保持不变，可查看或修改完整值。" : "变量名不区分大小写，同名变量请使用编辑功能。"}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>变量名</span>
              <Input autoFocus value={draft.name} readOnly={!!editor?.original || editor?.readOnly} disabled={busy}
                placeholder="例如 JAVA_HOME、Path" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="environment-value" className="text-sm">变量值</label>
                {isPath && (
                  <Button size="sm" variant="ghost" disabled={busy || !pathLines && /[\r\n]/.test(draft.value)}
                    onClick={() => setPathLines(!pathLines)}>{pathLines ? "切换为原始文本" : "切换为每行一项"}</Button>
                )}
              </div>
              <textarea id="environment-value" className={textAreaClass} rows={isPath ? 10 : 5}
                spellCheck={false} readOnly={editor?.readOnly} disabled={busy}
                value={isPath && pathLines ? pathToLines(draft.value) : draft.value}
                onChange={(event) => setDraft({ ...draft, value: isPath && pathLines ? linesToPath(event.target.value) : event.target.value })} />
              <p className="text-xs leading-5 text-fg-muted">
                {isPath && pathLines ? "每行对应一个 Path 项，按行顺序保存；空行和重复项会保留。" : "按原样保存，保留空格、分号和 %变量名% 引用。空值也会保存为变量。"}
              </p>
            </div>
            {isEditableEnvironmentVariable(draft) ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <Checkbox checked={draft.value_type === 2} disabled={busy || editor?.readOnly}
                  onCheckedChange={(checked) => setDraft({ ...draft, value_type: checked === true ? 2 : 1 })} />
                允许 Windows 展开 %变量名% 引用
              </label>
            ) : <p className="text-xs text-warning">此变量的类型不受支持，无法在此编辑或删除。</p>}
            {actionError && <p role="alert" className="break-words text-sm text-danger">{actionError}</p>}
          </DialogBody>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" disabled={busy} onClick={() => setEditor(null)}>{editor?.readOnly ? "关闭" : "取消"}</Button>
            {!editor?.readOnly && <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletion} onOpenChange={(open) => { if (!open && !busyRef.current) setDeletion(null); }}>
        <DialogContent showClose={!busy}>
          <DialogHeader>
            <DialogTitle>删除环境变量</DialogTitle>
            <DialogDescription className="break-all text-sm text-fg-muted">
              确认删除{deletion && scopeLabel(deletion.scope)}「{deletion?.variable.name}」？依赖此变量的程序可能无法正常运行。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg-muted p-3 text-xs">{deletion?.variable.value || "（空值）"}</pre>
            {actionError && <p role="alert" className="mt-3 break-words text-sm text-danger">{actionError}</p>}
          </DialogBody>
          <DialogFooter className="shrink-0">
            <Button variant="ghost" disabled={busy} onClick={() => setDeletion(null)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
