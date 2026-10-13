import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { TooltipProvider } from "@/components/ui/Tooltip";
import {
  workspaceFileFromUrl,
  workspaceRootFromUrl,
  workspaceSingleFileFromUrl,
} from "@/lib/workspace";
import { tauri } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import { Loader2 } from "lucide-react";

import { CommandPalette } from "@/components/CommandPalette";

const SettingsDialog = lazy(() =>
  import("@/components/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
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

function App() {
  const { ready, init, refreshRunning, appMode } = useApp();
  const [openSettings, setOpenSettings] = useState(false);
  const [openPalette, setOpenPalette] = useState(false);
  const workspaceRoot = workspaceRootFromUrl();
  const workspaceFile = workspaceFileFromUrl();
  const workspaceSingleFile = workspaceSingleFileFromUrl();
  const closeConfirmedRef = useRef(false);
  const closePromptActiveRef = useRef(false);

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

    // Always preventDefault first (async work needed), then force-close with
    // destroy(). Calling close() from inside this handler deadlocks: close()
    // waits for the handler to finish, while the handler awaits close().
    void appWindow.onCloseRequested(async (event) => {
      if (closeConfirmedRef.current) return;
      event.preventDefault();
      if (closePromptActiveRef.current) return;
      closePromptActiveRef.current = true;

      try {
        const [hbxRuns, nodeTasks] = await Promise.all([
          tauri.getHBuilderXWebRuns(),
          tauri.nodeServiceListTasks(),
        ]);
        const hbxRunning = hbxRuns.filter((run) => run.running).length;
        const nodeRunning = nodeTasks.filter((task) => task.running).length;
        if (hbxRunning === 0 && nodeRunning === 0) {
          closeConfirmedRef.current = true;
          await appWindow.destroy();
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
            `有 ${failed.length} 个 HBuilderX WEB 任务未能终止，已取消退出。`,
            { title: "退出已取消", kind: "error" },
          );
          return;
        }

        closeConfirmedRef.current = true;
        await appWindow.destroy();
      } catch (e) {
        closeConfirmedRef.current = false;
        await message(String(e), { title: "退出失败", kind: "error" });
      } finally {
        if (!closeConfirmedRef.current) {
          closePromptActiveRef.current = false;
        }
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ready, workspaceRoot]);

  if (!workspaceRoot && !ready) {
    return <LoadingScreen text="正在加载扩展信息..." />;
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
        ) : appMode === "extensions" ? (
          <ExtensionSyncPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "project-configs" ? (
          <ProjectConfigSyncPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "hbuilderx-cli" ? (
          <HBuilderXCliPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "node-services" ? (
          <NodeServicesPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "directory-cleaner" ? (
          <DirectoryCleanerPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "ai-configs" ? (
          <AiConfigPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "ai-agents" ? (
          <AiAgentManagerPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "terminal-manager" ? (
          <TerminalManagerPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "tool-manager" ? (
          <ToolManagerPage onOpenSettings={() => setOpenSettings(true)} />
        ) : appMode === "system-settings" ? (
          <SystemSettingsPage onOpenSettings={() => setOpenSettings(true)} />
        ) : (
          <ModeSelectPage onOpenSettings={() => setOpenSettings(true)} />
        )}
        {!workspaceRoot && openSettings && (
          <SettingsDialog
            open={openSettings}
            onClose={() => setOpenSettings(false)}
          />
        )}
        {!workspaceRoot && (
          <CommandPalette
            open={openPalette}
            onOpenChange={setOpenPalette}
            onOpenSettings={() => setOpenSettings(true)}
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
