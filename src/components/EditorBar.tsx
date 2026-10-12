import { useApp } from "@/stores/app";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Tooltip } from "@/components/ui/Tooltip";
import { OpenWithButton } from "@/components/OpenWithButton";
import {
  RefreshCcw,
  Settings as SettingsIcon,
  ArrowRight,
  AlertTriangle,
  FolderX,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onOpenSettings: () => void;
}

export function EditorBar({ onOpenSettings }: Props) {
  const {
    settings,
    sourceEditorId,
    targetEditorIds,
    setSource,
    toggleTarget,
    refresh,
    refreshRunning,
    runningEditors,
    scans,
    loading,
  } = useApp();

  if (!settings) return null;

  const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
  const sourceCount = sourceScan?.extensions.length ?? 0;
  const sourceRunning = runningEditors.has(sourceEditorId);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-subtle">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          源
        </span>
        <select
          value={sourceEditorId}
          onChange={(e) => setSource(e.target.value)}
          className="h-8 appearance-none rounded-md border border-border bg-bg pl-3 pr-8 text-sm font-medium text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-bg"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 8px center",
            backgroundSize: "14px",
          }}
        >
          {settings.editors.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-muted">
          {sourceScan?.exists ? (
            <>{sourceCount} 个扩展</>
          ) : (
            <span className="text-warning">目录不存在</span>
          )}
        </span>
        {sourceRunning && (
          <Tooltip content="该编辑器正在运行,操作时建议先关闭">
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" />
              运行中
            </span>
          </Tooltip>
        )}
      </div>

      <ArrowRight className="h-4 w-4 text-fg-subtle" />

      <div className="flex flex-wrap items-center gap-2 flex-1">
        <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
          目标
        </span>
        {settings.editors
          .filter((e) => e.id !== sourceEditorId)
          .map((e) => {
            const scan = scans.find((s) => s.editor.id === e.id);
            const exists = scan?.exists ?? false;
            const checked = targetEditorIds.has(e.id);
            const running = runningEditors.has(e.id);
            return (
              <button
                key={e.id}
                onClick={() => toggleTarget(e.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm transition-colors",
                  checked
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border bg-bg text-fg-muted hover:text-fg hover:border-border-strong",
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleTarget(e.id)} onClick={(ev) => ev.stopPropagation()} />
                <span className="font-medium">{e.name}</span>
                {!exists && (
                  <Tooltip content={`目录不存在: ${e.path}`}>
                    <FolderX className="h-3.5 w-3.5 text-warning" />
                  </Tooltip>
                )}
                {exists && scan && (
                  <span className="text-xs text-fg-subtle">
                    {scan.extensions.length}
                  </span>
                )}
                {running && (
                  <Tooltip content="正在运行">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  </Tooltip>
                )}
              </button>
            );
          })}
      </div>

      <div className="flex items-center gap-1">
        <OpenWithButton
          path={sourceScan?.editor.path ?? ""}
          disabled={!sourceScan?.exists}
          showLabel={false}
          variant="ghost"
          size="sm"
          title="打开源目录"
        />
        <Tooltip content="刷新扫描">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              refresh();
              refreshRunning();
            }}
            disabled={loading}
          >
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </Tooltip>
        <Tooltip content="设置">
          <Button variant="ghost" size="icon" onClick={onOpenSettings}>
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
