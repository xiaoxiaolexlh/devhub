import { useMemo, useState } from "react";
import { useApp, type SortKey } from "@/stores/app";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Search,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Package,
  Filter,
  ChevronsUpDown,
} from "lucide-react";
import { cn, compareVersions, formatBytes } from "@/lib/utils";
import { iconUrl, type Extension } from "@/lib/tauri";

type CompareState = "missing" | "same" | "older" | "newer" | "orphan";

function compareState(sourceVer: string, targetExt: Extension | undefined): CompareState {
  if (!targetExt) return "missing";
  // Folder is on disk but not registered in extensions.json — editor won't load it.
  if (!targetExt.registered) return "orphan";
  const c = compareVersions(sourceVer, targetExt.version);
  if (c === 0) return "same";
  if (c > 0) return "older"; // target older than source
  return "newer"; // target newer than source
}

const STATE_LABEL: Record<CompareState, string> = {
  missing: "未装",
  same: "同版",
  older: "旧版",
  newer: "新版",
  orphan: "孤儿",
};

const STATE_STYLE: Record<CompareState, string> = {
  missing: "text-fg-subtle",
  same: "text-success",
  older: "text-warning",
  newer: "text-accent",
  orphan: "text-fg-muted italic",
};

interface Props {
  onShowDiff: (extId: string) => void;
}

export function ExtensionTable({ onShowDiff }: Props) {
  const {
    scans,
    sourceEditorId,
    targetEditorIds,
    selectedFolders,
    toggleSelected,
    setSelectedFolders,
    search,
    setSearch,
    filterMode,
    setFilterMode,
    hideOrphans,
    setHideOrphans,
    sortKey,
    sortAsc,
    setSort,
    loading,
  } = useApp();

  const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
  const sourceExts = sourceScan?.extensions ?? [];

  const targetScans = useMemo(
    () => scans.filter((s) => targetEditorIds.has(s.editor.id)),
    [scans, targetEditorIds],
  );

  // Build per-target lookup map for fast state comparison.
  const targetMaps = useMemo(() => {
    return targetScans.map((s) => ({
      editor: s.editor,
      exists: s.exists,
      map: new Map(s.extensions.map((e) => [e.id, e])),
    }));
  }, [targetScans]);

  // Annotate each source extension with per-target state.
  const annotated = useMemo(() => {
    return sourceExts.map((ext) => {
      const states = targetMaps.map(({ editor, exists, map }) => ({
        editorId: editor.id,
        editorName: editor.name,
        editorExists: exists,
        target: map.get(ext.id),
        state: compareState(ext.version, map.get(ext.id)),
      }));
      return { ext, states };
    });
  }, [sourceExts, targetMaps]);

  // Filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotated.filter(({ ext, states }) => {
      if (hideOrphans && !ext.registered) return false;
      if (q) {
        const hay = `${ext.id} ${ext.display_name ?? ""} ${ext.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterMode === "missing") {
        return states.some((s) => s.state === "missing" || s.state === "orphan");
      }
      if (filterMode === "outdated") {
        return states.some(
          (s) => s.state === "older" || s.state === "missing" || s.state === "orphan",
        );
      }
      return true;
    });
  }, [annotated, search, filterMode, hideOrphans]);

  // Sort
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = (a.ext.display_name ?? a.ext.name).localeCompare(
            b.ext.display_name ?? b.ext.name,
          );
          break;
        case "publisher":
          cmp = a.ext.publisher.localeCompare(b.ext.publisher);
          break;
        case "version":
          cmp = compareVersions(a.ext.version, b.ext.version);
          break;
        case "size":
          cmp = a.ext.size_bytes - b.ext.size_bytes;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortAsc]);

  const allSelected =
    sorted.length > 0 &&
    sorted.every((r) => selectedFolders.has(r.ext.folder_name));
  const someSelected =
    sorted.some((r) => selectedFolders.has(r.ext.folder_name)) && !allSelected;

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selectedFolders);
      sorted.forEach((r) => next.delete(r.ext.folder_name));
      setSelectedFolders(next);
    } else {
      const next = new Set(selectedFolders);
      sorted.forEach((r) => next.add(r.ext.folder_name));
      setSelectedFolders(next);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索扩展名/描述..."
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter className="h-3.5 w-3.5 text-fg-subtle" />
          <FilterPill
            active={filterMode === "all"}
            onClick={() => setFilterMode("all")}
          >
            全部
          </FilterPill>
          <FilterPill
            active={filterMode === "missing"}
            onClick={() => setFilterMode("missing")}
          >
            目标缺失
          </FilterPill>
          <FilterPill
            active={filterMode === "outdated"}
            onClick={() => setFilterMode("outdated")}
          >
            目标过期
          </FilterPill>
          <div className="mx-1 h-4 w-px bg-border" />
          <Tooltip content="扩展文件夹存在但未在 extensions.json 注册时不会被编辑器加载,称为孤儿。">
            <FilterPill
              active={hideOrphans}
              onClick={() => setHideOrphans(!hideOrphans)}
            >
              隐藏孤儿
            </FilterPill>
          </Tooltip>
        </div>
        <div className="ml-auto text-xs text-fg-muted">
          显示 {sorted.length} / {sourceExts.length}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-bg-subtle">
            <tr className="border-b border-border text-fg-muted">
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className="w-10 px-1 py-2"></th>
              <SortableTh
                label="名称"
                k="name"
                current={sortKey}
                asc={sortAsc}
                onSort={setSort}
                className="text-left"
              />
              <SortableTh
                label="版本"
                k="version"
                current={sortKey}
                asc={sortAsc}
                onSort={setSort}
                className="w-28"
              />
              <SortableTh
                label="大小"
                k="size"
                current={sortKey}
                asc={sortAsc}
                onSort={setSort}
                className="w-24"
              />
              {targetMaps.map((t) => (
                <th
                  key={t.editor.id}
                  className="w-32 px-3 py-2 text-left font-medium"
                >
                  {t.editor.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="px-3 py-3">
                    <Skeleton className="h-4 w-4 rounded" />
                  </td>
                  <td className="px-1 py-3">
                    <Skeleton className="h-7 w-7 rounded-md" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="h-3 w-64" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Skeleton className="h-4 w-14" />
                  </td>
                  <td className="px-3 py-3">
                    <Skeleton className="h-4 w-12" />
                  </td>
                  {targetMaps.map((t) => (
                    <td key={t.editor.id} className="px-3 py-3">
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + targetMaps.length}
                  className="px-4 py-16 text-center text-fg-muted"
                >
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  {sourceExts.length === 0
                    ? "源编辑器没有扫描到扩展"
                    : "没有匹配的扩展"}
                </td>
              </tr>
            ) : null}
            {!loading && sorted.map(({ ext, states }) => {
              const checked = selectedFolders.has(ext.folder_name);
              return (
                <tr
                  key={ext.folder_name}
                  onDoubleClick={() => onShowDiff(ext.id)}
                  className={cn(
                    "border-b border-border/60 hover:bg-bg-muted cursor-default group",
                    checked && "bg-accent/5",
                  )}
                >
                  <td
                    className="px-3 py-2 align-middle"
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSelected(ext.folder_name)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <button
                      onClick={() => onShowDiff(ext.id)}
                      className="rounded-md transition-shadow hover:ring-2 hover:ring-accent/40"
                      title="查看详情"
                    >
                      <ExtensionIcon ext={ext} />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onShowDiff(ext.id)}
                        className="font-medium text-fg truncate max-w-[18rem] text-left hover:text-accent hover:underline underline-offset-2"
                        title="点击查看详情"
                      >
                        {ext.display_name || ext.name}
                      </button>
                      {ext.is_ms_proprietary && (
                        <Tooltip content="微软专有扩展,在非 VSCode 编辑器中可能违反许可证">
                          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                        </Tooltip>
                      )}
                      {!ext.registered && (
                        <Tooltip content="该文件夹未在 extensions.json 中注册,源编辑器实际不会加载它(可在文件管理器中手动删除以清理)">
                          <span className="shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
                            孤儿
                          </span>
                        </Tooltip>
                      )}
                      <button
                        onClick={() => onShowDiff(ext.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline shrink-0"
                      >
                        详情 →
                      </button>
                    </div>
                    <div className="text-xs text-fg-subtle truncate max-w-[24rem]">
                      {ext.id}
                      {ext.description && <> · {ext.description}</>}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{ext.version}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {formatBytes(ext.size_bytes)}
                  </td>
                  {states.map((s) => (
                    <td key={s.editorId} className="px-3 py-2">
                      <StateBadge
                        state={s.state}
                        version={s.target?.version}
                        editorExists={s.editorExists}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-0.5 text-xs transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "text-fg-muted hover:bg-bg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function SortableTh({
  label,
  k,
  current,
  asc,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  current: SortKey;
  asc: boolean;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === k;
  return (
    <th
      className={cn("px-3 py-2 font-medium select-none", className)}
    >
      <button
        className="inline-flex items-center gap-1 hover:text-fg"
        onClick={() => onSort(k)}
      >
        {label}
        {active ? (
          asc ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function ExtensionIcon({ ext }: { ext: Extension }) {
  const [errored, setErrored] = useState(false);
  const url = !errored ? iconUrl(ext.icon_path) : undefined;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setErrored(true)}
        className="h-7 w-7 rounded-md object-cover bg-bg-muted"
      />
    );
  }
  const initial = (ext.display_name || ext.name).charAt(0).toUpperCase();
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-muted text-xs font-semibold text-fg-muted">
      {initial}
    </div>
  );
}

function StateBadge({
  state,
  version,
  editorExists,
}: {
  state: CompareState;
  version: string | undefined;
  editorExists: boolean;
}) {
  if (!editorExists) {
    return <span className="text-xs text-fg-subtle italic">目录缺失</span>;
  }
  const cls = STATE_STYLE[state];
  const label = STATE_LABEL[state];
  const Icon =
    state === "missing"
      ? X
      : state === "same"
        ? Check
        : state === "older"
          ? ChevronDown
          : ChevronUp;
  return (
    <div className={cn("inline-flex items-center gap-1 text-xs", cls)}>
      <Icon className="h-3 w-3" />
      <span className="font-medium">{label}</span>
      {version && (
        <span className="font-mono text-[10px] text-fg-subtle">{version}</span>
      )}
    </div>
  );
}
