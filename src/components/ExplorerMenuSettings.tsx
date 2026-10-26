import { useEffect, useState } from "react";
import { Check, Copy, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { tauri, type ExplorerMenuStatus } from "@/lib/tauri";

export function ExplorerMenuSettings() {
  const [status, setStatus] = useState<ExplorerMenuStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [trustCommandCopyStatus, setTrustCommandCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const certificatePath = error?.match(
    /The Explorer menu signing certificate is not trusted\.[\s\S]*?then retry:\s*(.+)$/i,
  )?.[1]?.trim();
  const trustCommand = certificatePath
    ? `Import-Certificate -FilePath '${certificatePath.replace(/'/g, "''")}' -CertStoreLocation Cert:\\LocalMachine\\TrustedPeople`
    : null;

  useEffect(() => {
    let active = true;
    void tauri.explorerMenuStatus().then(
      value => { if (active) setStatus(value); },
      reason => { if (active) setError(String(reason)); },
    ).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    try { setStatus(await tauri.explorerMenuStatus()); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await tauri.explorerMenuSetEnabled(enabled);
      setStatus(result);
      setNotice(enabled
        ? "已注册“通过 DevHub 打开”，请重新打开资源管理器右键菜单。"
        : "已移除“通过 DevHub 打开”。");
    } catch (reason) {
      setError(String(reason));
      // Windows can remove an old registration before a replacement fails.
      // Refresh instead of keeping a stale 'installed' indicator.
      try { setStatus(await tauri.explorerMenuStatus()); }
      catch { setStatus(null); }
    } finally { setBusy(false); }
  }

  async function copyTrustCommand() {
    if (!trustCommand) return;
    try {
      await navigator.clipboard.writeText(trustCommand);
      setTrustCommandCopyStatus("copied");
      window.setTimeout(() => setTrustCommandCopyStatus("idle"), 1500);
    } catch {
      setTrustCommandCopyStatus("failed");
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-subtle p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <FolderOpen className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-fg">资源管理器右键菜单</h2>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            在 Windows 11 第一层右键菜单中添加“通过 DevHub 打开”。右键单个文件、文件夹或文件夹空白处，即可用内置工作区打开。
          </p>
          <p className="mt-2 text-xs text-fg-muted">
            {busy ? "正在处理…" : !status ? "暂时无法读取状态" : !status.supported
              ? "需要 Windows 11 x64" : status.installed ? "已启用" : "未启用"}
            {status && !status.available && "；菜单组件不完整，请重新构建或安装应用。"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || !status?.supported || !status.available}
              onClick={() => void setEnabled(true)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              {status?.installed ? "重新注册" : "添加到右键菜单"}
            </Button>
            {status?.installed && (
              <Button variant="outline" disabled={busy} onClick={() => void setEnabled(false)}>移除菜单</Button>
            )}
            <Button variant="ghost" size="icon" title="刷新菜单状态" aria-label="刷新菜单状态"
              disabled={busy} onClick={() => void refresh()}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {notice && <p role="status" className="mt-3 text-xs text-success">{notice}</p>}
          {trustCommand ? (
            <div role="alert" className="mt-3 space-y-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs">
              <p className="font-medium text-danger">需要管理员信任右键菜单证书</p>
              <p className="text-fg-muted">
                请在管理员 PowerShell 中运行此命令。每台电脑导入一次后，该电脑上的所有用户均可使用。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded border border-border bg-bg px-2 py-1.5 font-mono text-fg">
                  {trustCommand}
                </code>
                <Button variant="outline" size="sm" onClick={() => void copyTrustCommand()}>
                  {trustCommandCopyStatus === "copied" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {trustCommandCopyStatus === "copied" ? "已复制" : "复制命令"}
                </Button>
              </div>
              {trustCommandCopyStatus === "failed" && (
                <p role="status" className="text-warning">复制失败，请手动选择上方命令复制。</p>
              )}
              <p className="text-fg-muted">仅导入公开证书；操作会将其加入本机信任存储。</p>
            </div>
          ) : error ? (
            <p role="alert" className="mt-3 break-words text-xs text-danger">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
