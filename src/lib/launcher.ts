import type { LauncherCatalogTool, LauncherStatus } from "@/lib/tauri";
import type { ComponentType } from "react";
import { tauri } from "@/lib/tauri";
import { APP_MODES } from "@/lib/modes";
import type { AppMode } from "@/stores/app";
import { AppWindow, Settings } from "lucide-react";

export interface LauncherEntry {
  id: string;
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  kind: "mode" | "tool" | "custom";
  status: string;
  available: boolean;
  mode?: AppMode;
  toolId?: string;
  exePath?: string;
}

export const DEFAULT_LAUNCHER_SETTINGS = { enabled: true, shortcut: "Ctrl+Alt+Space", close_to_tray: true };
export const LAUNCHER_HISTORY_KEY = "devhub:launcher-history";
export interface LauncherHistory { pinned: string[]; recent: string[] }

export function buildLauncherEntries(tools: LauncherCatalogTool[]): LauncherEntry[] {
  return [
    ...APP_MODES.map((mode): LauncherEntry => ({
      id: `mode:${mode.mode}`, title: mode.title, desc: mode.desc, icon: mode.icon,
      kind: "mode", mode: mode.mode, available: true, status: "进入模式",
    })),
    { id: "mode:settings", title: "应用设置", desc: "快捷键、后台运行、编辑器目录、打开方式与主题", icon: Settings,
      kind: "mode", mode: "settings", available: true, status: "进入设置" },
    ...tools.map((tool): LauncherEntry => ({
      id: `${tool.kind}:${tool.id}`, title: tool.name, desc: `${tool.groupName} · ${tool.description}`,
      icon: AppWindow, kind: tool.kind, toolId: tool.id, exePath: tool.exePath,
      available: tool.available, status: tool.status,
    })),
  ];
}

export function filterLauncherEntries(entries: LauncherEntry[], query: string): LauncherEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter((entry) => {
    const content = `${entry.title} ${entry.desc} ${entry.id}`.toLocaleLowerCase();
    return words.every((word) => content.includes(word));
  });
  if (!words.length) return filtered;
  const queryText = query.trim().toLocaleLowerCase();
  const rank = (entry: LauncherEntry) => {
    const title = entry.title.toLocaleLowerCase();
    if (title === queryText) return 0;
    if (title.startsWith(queryText)) return 1;
    if (words.every((word) => title.includes(word))) return 2;
    if (entry.id.toLocaleLowerCase().includes(queryText)) return 3;
    return 4;
  };
  return filtered.sort((left, right) => rank(left) - rank(right));
}

export type LauncherNavigationKey = "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
export interface LauncherNavigationItem { id: string; left: number; top: number; width: number }

/** Wrap within rows horizontally and between rows vertically, retaining the intended column. */
export function moveLauncherSelection(
  items: readonly LauncherNavigationItem[], currentId: string | undefined,
  key: LauncherNavigationKey, preferredX?: number,
): { id: string; preferredX: number } | undefined {
  const rows: LauncherNavigationItem[][] = [];
  for (const item of [...items].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows[rows.length - 1];
    // Allow subpixel rounding at different display scales.
    if (row && Math.abs(row[0].top - item.top) < 2) row.push(item);
    else rows.push([item]);
  }
  rows.forEach((row) => row.sort((a, b) => a.left - b.left));
  const ordered = rows.flat();
  const center = (item: LauncherNavigationItem) => item.left + item.width / 2;
  const select = (item: LauncherNavigationItem | undefined, x?: number) => item && ({ id: item.id, preferredX: x ?? center(item) });
  if (key === "Home") return select(ordered[0]);
  if (key === "End") return select(ordered[ordered.length - 1]);
  const rowIndex = rows.findIndex((row) => row.some((item) => item.id === currentId));
  if (rowIndex < 0) return select(ordered[0]);
  const row = rows[rowIndex];
  const column = row.findIndex((item) => item.id === currentId);
  const current = row[column];
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const nextColumn = (column + (key === "ArrowRight" ? 1 : -1) + row.length) % row.length;
    return select(row[nextColumn]);
  }
  const x = preferredX ?? center(current);
  const nextRow = rows[(rowIndex + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
  const nearest = nextRow.reduce((best, item) => Math.abs(center(item) - x) < Math.abs(center(best) - x) ? item : best);
  return select(nearest, x);
}

export function readLauncherHistory(): LauncherHistory {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAUNCHER_HISTORY_KEY) ?? "{}");
    const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
    return { pinned: ids(parsed?.pinned), recent: ids(parsed?.recent).slice(0, 12) };
  } catch { return { pinned: [], recent: [] }; }
}

export function writeLauncherHistory(history: LauncherHistory) {
  try { localStorage.setItem(LAUNCHER_HISTORY_KEY, JSON.stringify(history)); } catch { /* Keep the in-memory selection usable. */ }
}

export function rememberLauncherEntry(history: LauncherHistory, id: string): LauncherHistory {
  return { ...history, recent: [id, ...history.recent.filter((item) => item !== id)].slice(0, 12) };
}

/** Use exactly the same native entry points as ToolManagerPage. */
export async function activateLauncherEntry(entry: LauncherEntry, openMode: (mode: AppMode, toolId?: string) => Promise<void>) {
  if (entry.kind === "mode") { await openMode(entry.mode!); return; }
  if (!entry.available) { await openMode("tool-manager", entry.id); return; }
  if (entry.kind === "custom") await tauri.customToolOpen(entry.exePath!);
  else await tauri.toolLaunch(entry.toolId!);
}

export function launcherStatusMessage(status: LauncherStatus, enabled: boolean): string {
  if (status.error) return status.error;
  return enabled && status.registered ? "全局快捷键已注册" : "全局快捷键已关闭";
}
