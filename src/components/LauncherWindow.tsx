import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LauncherPanel } from "@/components/LauncherPanel";
import { tauri } from "@/lib/tauri";
import { useApp } from "@/stores/app";

export function LauncherWindow() {
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refreshTheme = useCallback(async () => {
    const settings = await tauri.getSettings();
    useApp.getState().applyTheme(settings.theme);
  }, []);
  useEffect(() => {
    document.getElementById("boot")?.remove();
    void refreshTheme().catch((failure) => setError(String(failure)));
    let disposed = false;
    const stops: (() => void)[] = [];
    const saveStop = (stop: () => void) => { if (disposed) stop(); else stops.push(stop); };
    const failure = (error: unknown) => { if (!disposed) setError(String(error)); };
    void listen("devhub:launcher-shown", () => { setSession((current) => current + 1); setVisible(true); }).then(saveStop).catch(failure);
    void listen("devhub:launcher-hidden", () => { setVisible(false); }).then(saveStop).catch(failure);
    void listen("devhub:settings-changed", () => { void refreshTheme().catch(failure); }).then(saveStop).catch(failure);
    void getCurrentWindow().isVisible().then((shown) => { if (!disposed && shown) setVisible(true); }).catch(failure);
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, [refreshTheme]);
  const hide = useCallback(() => {
    return tauri.launcherHide().then(() => setVisible(false)).catch((failure) => { setError(String(failure)); throw failure; });
  }, []);
  return <div className="flex h-full flex-col border border-border">
    {error && <div role="alert" className="bg-danger/10 p-2 text-xs text-danger">{error}</div>}
    <div className="min-h-0 flex-1"><LauncherPanel session={session} open={visible} onClose={hide} onOpenMode={tauri.launcherOpenMode} standalone /></div>
  </div>;
}
