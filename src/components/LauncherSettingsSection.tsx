import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauri, type LauncherSettings, type LauncherStatus } from "@/lib/tauri";
import { DEFAULT_LAUNCHER_SETTINGS, launcherStatusMessage } from "@/lib/launcher";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";

export function LauncherSettingsSection({ value = DEFAULT_LAUNCHER_SETTINGS, onChange }: {
  value?: LauncherSettings; onChange: (value: LauncherSettings) => void;
}) {
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    const refresh = () => { void tauri.launcherStatus().then((status) => { if (!disposed) setStatus(status); }).catch((failure) => { if (!disposed) setError(String(failure)); }); };
    refresh();
    void listen("devhub:settings-changed", refresh).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, []);
  return <div className="space-y-4 text-sm">
    <label className="flex items-center gap-2"><Checkbox checked={value.enabled} onCheckedChange={(enabled) => onChange({ ...value, enabled: enabled === true })} />启用全局快捷键</label>
    <label className="block space-y-1.5"><span className="text-xs text-fg-muted">快捷键组合</span>
      <Input value={value.shortcut} placeholder="Ctrl+Alt+Space" onChange={(event) => onChange({ ...value, shortcut: event.target.value })} className="max-w-xs" />
    </label>
    <p className="text-xs text-fg-muted">支持 Ctrl、Alt、Shift、Win 搭配字母、数字、Space 或 F1–F24。保存后生效；组合被占用时会提示，并保留原快捷键。</p>
    <label className="flex items-center gap-2"><Checkbox checked={value.close_to_tray} onCheckedChange={(close_to_tray) => onChange({ ...value, close_to_tray: close_to_tray === true })} />关闭主窗口时隐藏到托盘，继续响应快捷键</label>
    <p className="text-xs text-fg-muted">右键托盘图标可以完全退出；退出前会检查正在运行的任务。完全退出后不再响应快捷键。</p>
    {status && <p role="status" className={`text-xs ${status.error ? "text-danger" : "text-fg-muted"}`}>{launcherStatusMessage(status, status.registered)}{!status.trayAvailable && " · 托盘不可用"}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <Button variant="secondary" size="sm" onClick={() => { void tauri.launcherToggle().catch((failure) => setError(String(failure))); }}>打开快捷面板</Button>
  </div>;
}
