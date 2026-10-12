import { create } from "zustand";
import { tauri, type EditorScan, type Settings, type Theme } from "@/lib/tauri";

export type AppMode =
  | "home"
  | "extensions"
  | "project-configs"
  | "hbuilderx-cli"
  | "node-services"
  | "directory-cleaner"
  | "ai-configs"
  | "ai-agents"
  | "terminal-manager"
  | "tool-manager"
  | "system-settings";
export type SortKey = "name" | "version" | "publisher" | "size";
export type FilterMode = "all" | "missing" | "outdated";

const LAST_MODE_KEY = "devhub:last-mode";
const RECENT_PROJECT_ROOTS_KEY = "devhub:recent-project-roots";
const MAX_RECENT_PROJECT_ROOTS = 20;

interface AppState {
  ready: boolean;
  loading: boolean;
  scans: EditorScan[];
  settings: Settings | null;
  appMode: AppMode;
  recentProjectRoots: string[];

  sourceEditorId: string;
  targetEditorIds: Set<string>;
  /** Set of source extension folder names (NOT ext.id) — folders are the unit of operation,
   *  because the same extension id can have multiple version folders coexisting in one editor. */
  selectedFolders: Set<string>;

  search: string;
  filterMode: FilterMode;
  /** Hide extension folders that aren't listed in `extensions.json` (orphans). */
  hideOrphans: boolean;
  sortKey: SortKey;
  sortAsc: boolean;

  runningEditors: Set<string>;

  init: () => Promise<void>;
  /** Load settings only (e.g. workspace secondary windows). */
  ensureSettings: () => Promise<void>;
  refresh: () => Promise<void>;
  setAppMode: (mode: AppMode) => void;
  addRecentProjectRoot: (path: string) => void;
  removeRecentProjectRoot: (path: string) => void;
  setSource: (id: string) => void;
  toggleTarget: (id: string) => void;
  toggleSelected: (folderName: string) => void;
  setSelectedFolders: (names: Set<string>) => void;
  clearSelection: () => void;
  setSearch: (s: string) => void;
  setFilterMode: (m: FilterMode) => void;
  setHideOrphans: (v: boolean) => void;
  setSort: (key: SortKey) => void;
  saveSettings: (next: Settings) => Promise<void>;
  applyTheme: (t: Theme) => void;
  refreshRunning: () => Promise<void>;
}

function applyThemeToDom(t: Theme) {
  const isDark =
    t === "dark" ||
    (t === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function loadAppMode(): AppMode {
  const mode = localStorage.getItem(LAST_MODE_KEY);
  return mode === "extensions" || mode === "project-configs" || mode === "hbuilderx-cli" || mode === "node-services" || mode === "directory-cleaner" || mode === "ai-configs" || mode === "ai-agents" || mode === "terminal-manager" || mode === "tool-manager" || mode === "system-settings"
    ? mode
    : "home";
}

function loadRecentProjectRoots(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECT_ROOTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecentProjectRoots(paths: string[]) {
  localStorage.setItem(RECENT_PROJECT_ROOTS_KEY, JSON.stringify(paths));
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  loading: false,
  scans: [],
  settings: null,
  appMode: "home",
  recentProjectRoots: [],

  sourceEditorId: "vscode",
  targetEditorIds: new Set(),
  selectedFolders: new Set(),

  search: "",
  filterMode: "all",
  hideOrphans: false,
  sortKey: "name",
  sortAsc: true,

  runningEditors: new Set(),

  async init() {
    const settings = await tauri.getSettings();
    applyThemeToDom(settings.theme);
    const ids = new Set(
      settings.editors
        .filter((e) => e.id !== settings.source_editor)
        .map((e) => e.id),
    );
    set({
      settings,
      appMode: loadAppMode(),
      recentProjectRoots: loadRecentProjectRoots(),
      sourceEditorId: settings.source_editor,
      targetEditorIds: ids,
    });
    await get().refresh();
    await get().refreshRunning();
    set({ ready: true });
  },

  async ensureSettings() {
    if (get().settings) return;
    const settings = await tauri.getSettings();
    applyThemeToDom(settings.theme);
    set({ settings });
  },

  async refresh() {
    set({ loading: true });
    try {
      const scans = await tauri.scanAll();
      set({ scans });
    } finally {
      set({ loading: false });
    }
  },

  setAppMode(mode) {
    if (mode === "extensions" || mode === "project-configs" || mode === "hbuilderx-cli" || mode === "node-services" || mode === "directory-cleaner" || mode === "ai-configs" || mode === "ai-agents" || mode === "terminal-manager" || mode === "tool-manager" || mode === "system-settings") {
      localStorage.setItem(LAST_MODE_KEY, mode);
    }
    set({ appMode: mode });
  },

  addRecentProjectRoot(path) {
    const trimmed = path.trim();
    if (!trimmed) return;
    set((s) => {
      const next = [
        trimmed,
        ...s.recentProjectRoots.filter((p) => p.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, MAX_RECENT_PROJECT_ROOTS);
      saveRecentProjectRoots(next);
      return { recentProjectRoots: next };
    });
  },

  removeRecentProjectRoot(path) {
    set((s) => {
      const next = s.recentProjectRoots.filter(
        (p) => p.toLowerCase() !== path.toLowerCase(),
      );
      saveRecentProjectRoots(next);
      return { recentProjectRoots: next };
    });
  },

  setSource(id) {
    set((s) => {
      const targets = new Set(s.targetEditorIds);
      targets.delete(id);
      const settings = s.settings
        ? { ...s.settings, source_editor: id }
        : s.settings;
      if (settings) {
        // fire & forget — best effort
        tauri.saveSettings(settings).catch(() => {});
      }
      return {
        sourceEditorId: id,
        targetEditorIds: targets,
        selectedFolders: new Set(),
        settings,
      };
    });
  },

  toggleTarget(id) {
    set((s) => {
      if (id === s.sourceEditorId) return s;
      const next = new Set(s.targetEditorIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { targetEditorIds: next };
    });
  },

  toggleSelected(folderName) {
    set((s) => {
      const next = new Set(s.selectedFolders);
      next.has(folderName) ? next.delete(folderName) : next.add(folderName);
      return { selectedFolders: next };
    });
  },

  setSelectedFolders(names) {
    set({ selectedFolders: names });
  },

  clearSelection() {
    set({ selectedFolders: new Set() });
  },

  setSearch(s) {
    set({ search: s });
  },

  setFilterMode(m) {
    set({ filterMode: m });
  },

  setHideOrphans(v) {
    set({ hideOrphans: v });
  },

  setSort(key) {
    set((s) => ({
      sortKey: key,
      sortAsc: s.sortKey === key ? !s.sortAsc : true,
    }));
  },

  async saveSettings(next) {
    await tauri.saveSettings(next);
    applyThemeToDom(next.theme);
    const ids = new Set(
      next.editors
        .filter((e) => e.id !== next.source_editor)
        .map((e) => e.id),
    );
    set({
      settings: next,
      sourceEditorId: next.source_editor,
      targetEditorIds: ids,
    });
    await get().refresh();
  },

  applyTheme(t) {
    applyThemeToDom(t);
  },

  async refreshRunning() {
    const settings = get().settings;
    if (!settings) return;
    const ids = settings.editors.map((e) => e.id);
    const running = await tauri.checkRunningProcesses(ids);
    set({ runningEditors: new Set(running) });
  },
}));
