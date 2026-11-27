import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { TooltipProvider } from "@/components/ui/Tooltip";
import {
  workspaceFileFromUrl,
  workspaceRootFromUrl,
  workspaceSingleFileFromUrl,
} from "@/lib/workspace";
import { tauri } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import type { AppMode } from "@/stores/app";
import { DEFAULT_LAUNCHER_SETTINGS } from "@/lib/launcher";
import { ModeVisibility } from "@/lib/modeVisibility";
import { Loader2 } from "lucide-react";

import { CommandPalette } from "@/components/CommandPalette";

const DirectoryCleanerPage = lazy(() =>
  import("@/components/DirectoryCleanerPage").then((module) => ({
    default: module.DirectoryCleanerPage,
  })),
);
const AiConfigPage = lazy(() =>
  import("@/components/AiConfigPage").then((module) => ({
    default: module.AiConfigPage,
  })),
);
const AiAgentManagerPage = lazy(() =>
  import("@/components/AiAgentManagerPage").then((module) => ({
    default: module.AiAgentManagerPage,
  })),
);
const ExtensionSyncPage = lazy(() =>
  import("@/components/ExtensionSyncPage").then((module) => ({
    default: module.ExtensionSyncPage,
  })),
);
const HBuilderXCliPage = lazy(() =>
  import("@/components/HBuilderXCliPage").then((module) => ({
    default: module.HBuilderXCliPage,
  })),
);
const ModeSelectPage = lazy(() =>
  import("@/components/ModeSelectPage").then((module) => ({
    default: module.ModeSelectPage,
  })),
);
const NodeServicesPage = lazy(() =>
  import("@/components/NodeServicesPage").then((module) => ({
    default: module.NodeServicesPage,
  })),
);
const ProjectConfigSyncPage = lazy(() =>
  import("@/components/ProjectConfigSyncPage").then((module) => ({
    default: module.ProjectConfigSyncPage,
  })),
);
const TerminalManagerPage = lazy(() =>
  import("@/components/TerminalManagerPage").then((module) => ({
    default: module.TerminalManagerPage,
  })),
);
const PowerShellHistoryPage = lazy(() =>
  import("@/components/PowerShellHistoryPage").then((module) => ({
    default: module.PowerShellHistoryPage,
  })),
);
const ToolManagerPage = lazy(() =>
  import("@/components/ToolManagerPage").then((module) => ({
    default: module.ToolManagerPage,
  })),
);
const WorkspacePage = lazy(() =>
  import("@/components/WorkspacePage").then((module) => ({
    default: module.WorkspacePage,
  })),
);
const SystemSettingsPage = lazy(() =>
  import("@/components/SystemSettingsPage").then((module) => ({
    default: module.SystemSettingsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/components/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

function App() {
  const { ready, init, refreshRunning, appMode, setAppMode } = useApp();
  const [openPalette, setOpenPalette] = useState(false);
  const openSettings = useCallback(() => setAppMode("settings"), [setAppMode]);
  const workspaceRoot = workspaceRootFromUrl();
  const workspaceFile = workspaceFileFromUrl();
  const workspaceSingleFile = workspaceSingleFileFromUrl();
  const closeConfirmedRef = useRef(false);
  const closePromptActiveRef = useRef(false);
  const exitRequestedRef = useRef(false);
  const [closeHandlerReady, setCloseHandlerReady] = useState(false);

  useEffect(() => {
    if (workspaceRoot || !ready || !closeHandlerReady) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const navigate = async () => {
      const navigation = await tauri.launcherTakeNavigation();
      if (disposed || !navigation) return;
      if (navigation.mode === "exit") {
        exitRequestedRef.current = true;
        await getCurrentWindow().close();
      } else {
        if (navigation.toolId) useApp.getState().setToolFocusId(navigation.toolId);
        setAppMode(navigation.mode as AppMode);
      }
    };
    void listen("devhub:navigate", () => { void navigate(); }).then((unlisten) => {
      if (disposed) { unlisten(); return; }
      stop = unlisten;
      void navigate();
    });
    return () => { disposed = true; stop?.(); };
  }, [ready, closeHandlerReady, workspaceRoot, setAppMode]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenPalette((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // index.html paints a static spinner before any bundle loads; React's own
  // loading screen supersedes it once this first commit is on screen.
  useEffect(() => {
    document.getElementById("boot")?.remove();
  }, []);

  useEffect(() => {
    if (workspaceRoot) {
      void useApp.getState().ensureSettings();
      return;
    }
    void init();
  }, [init, workspaceRoot]);

  // Refresh "running editor" indicators every 5s.
  useEffect(() => {
    if (workspaceRoot) return;
    if (!ready) return;
    const id = setInterval(() => refreshRunning(), 5000);
    return () => clearInterval(id);
  }, [ready, refreshRunning, workspaceRoot]);

  useEffect(() => {
    if (workspaceRoot) return;
    if (!ready) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    // Prevent the native close while choosing background mode or checking tasks.
    // Complete exit uses the app command because the hidden launcher stays alive.
    void appWindow.onCloseRequested(async (event) => {
      if (closeConfirmedRef.current) return;
      event.preventDefault();
      if (closePromptActiveRef.current) return;
      closePromptActiveRef.current = true;

      try {
        const launcher = useApp.getState().settings?.launcher ?? DEFAULT_LAUNCHER_SETTINGS;
        if (!exitRequestedRef.current && launcher.close_to_tray && (await tauri.launcherStatus()).trayAvailable) {
          await tauri.launcherHideMain();
          return;
        }
        const [hbxRuns, nodeTasks] = await Promise.all([
          tauri.getHBuilderXWebRuns(),
          tauri.nodeServiceListTasks(),
        ]);
        const hbxRunning = hbxRuns.filter((run) => run.running).length;
        const nodeRunning = nodeTasks.filter((task) => task.running).length;
        if (hbxRunning === 0 && nodeRunning === 0) {
          closeConfirmedRef.current = true;
          await tauri.launcherExit();
          return;
        }

        const parts: string[] = [];
        if (hbxRunning > 0) parts.push(`HBuilderX WEB 任务 ${hbxRunning} 个`);
        if (nodeRunning > 0) parts.push(`Node 命令任务 ${nodeRunning} 个`);
        const ok = await confirm(
          `当前有正在运行的任务（${parts.join("、")}）。退出会终止所有正在运行的任务，是否继续？`,
          {
            title: "确认退出",
            kind: "warning",
            okLabel: "终止并退出",
            cancelLabel: "取消",
          },
        );
        if (!ok || disposed) return;

        const [hbxResults, nodeResults] = await Promise.all([
          tauri.stopAllHBuilderXWebRuns(),
          tauri.nodeServiceStopService(""),
        ]);
        const failed = [...hbxResults, ...nodeResults].filter((item) => !item.success);
        if (failed.length > 0) {
          await message(
            `有 ${failed.length} 个任务未能终止，已取消退出。`,
            { title: "退出已取消", kind: "error" },
          );
          return;
        }

        closeConfirmedRef.current = true;
        await tauri.launcherExit();
      } catch (e) {
        closeConfirmedRef.current = false;
        await message(String(e), { title: "退出失败", kind: "error" });
      } finally {
        if (!closeConfirmedRef.current) {
          closePromptActiveRef.current = false;
          exitRequestedRef.current = false;
        }
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
        setCloseHandlerReady(true);
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ready, workspaceRoot]);

  if (!workspaceRoot && !ready) {
    return <LoadingScreen text="正在加载设置..." />;
  }

  return (
    <TooltipProvider>
      <Suspense fallback={<LoadingScreen text="正在加载页面..." />}>
        {workspaceRoot ? (
          <WorkspacePage
            root={workspaceRoot}
            initialFile={workspaceFile}
            singleFile={workspaceSingleFile}
          />
        ) : <ModeWorkspaces mode={appMode} onOpenSettings={openSettings} />}

        {!workspaceRoot && (
          <CommandPalette
            open={openPalette}
            onOpenChange={setOpenPalette}
            onOpenSettings={openSettings}
          />
        )}
      </Suspense>
    </TooltipProvider>
  );
}

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-fg-muted">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      {text}
    </div>
  );
}

export default App;

function ModeWorkspaces({ mode, onOpenSettings }: { mode: AppMode; onOpenSettings: () => void }) {
  const [visited, setVisited] = useState<AppMode[]>([mode]);
  useEffect(() => { setVisited((modes) => modes.includes(mode) ? modes : [...modes, mode]); }, [mode]);
  const modes = visited.includes(mode) ? visited : [...visited, mode];
  return <>{modes.map((entry) => <ModeVisibility.Provider key={entry} value={entry === mode}>
    <div className="h-full w-full" style={{ display: entry === mode ? undefined : "none" }} inert={entry !== mode} aria-hidden={entry !== mode}>
      <Suspense fallback={<LoadingScreen text="正在加载页面..." />}>
        {entry === "settings" ? <SettingsPage /> : entry === "home" ? <ModeSelectPage onOpenSettings={onOpenSettings} /> :
          entry === "extensions" ? <ExtensionSyncPage onOpenSettings={onOpenSettings} /> :
          entry === "project-configs" ? <ProjectConfigSyncPage onOpenSettings={onOpenSettings} /> :
          entry === "hbuilderx-cli" ? <HBuilderXCliPage onOpenSettings={onOpenSettings} /> :
          entry === "node-services" ? <NodeServicesPage onOpenSettings={onOpenSettings} /> :
          entry === "directory-cleaner" ? <DirectoryCleanerPage onOpenSettings={onOpenSettings} /> :
          entry === "ai-configs" ? <AiConfigPage onOpenSettings={onOpenSettings} /> :
          entry === "ai-agents" ? <AiAgentManagerPage onOpenSettings={onOpenSettings} /> :
          entry === "terminal-manager" ? <TerminalManagerPage onOpenSettings={onOpenSettings} /> :
          entry === "powershell-history" ? <PowerShellHistoryPage onOpenSettings={onOpenSettings} /> :
          entry === "tool-manager" ? <ToolManagerPage onOpenSettings={onOpenSettings} /> :
          entry === "system-settings" ? <SystemSettingsPage onOpenSettings={onOpenSettings} /> : null}
      </Suspense>
    </div>
  </ModeVisibility.Provider>)}</>;
}
