import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { OpenWithButton } from "@/components/OpenWithButton";
import { useApp } from "@/stores/app";
import { iconUrl, type Extension } from "@/lib/tauri";
import { formatBytes, compareVersions, cn } from "@/lib/utils";
import { Check, X, ChevronUp, ChevronDown } from "lucide-react";

interface Props {
  extensionId: string | null;
  onClose: () => void;
}

export function DiffDrawer({ extensionId, onClose }: Props) {
  const { scans, sourceEditorId, settings } = useApp();

  const data = useMemo(() => {
    if (!extensionId) return null;
    const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
    const sourceExt = sourceScan?.extensions.find((e) => e.id === extensionId);
    if (!sourceExt) return null;
    const targets = scans
      .filter((s) => s.editor.id !== sourceEditorId)
      .map((s) => ({
        editor: s.editor,
        exists: s.exists,
        extension: s.extensions.find((e) => e.id === extensionId),
      }));
    return { sourceExt, sourceEditor: sourceScan!.editor, targets };
  }, [extensionId, scans, sourceEditorId]);

  if (!settings) return null;

  return (
    <Dialog open={!!extensionId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent width="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {data && (
              <>
                <ExtensionIconLarge ext={data.sourceExt} />
                <div className="flex flex-col">
                  <span className="text-base font-semibold">
                    {data.sourceExt.display_name || data.sourceExt.name}
                  </span>
                  <span className="text-xs font-mono text-fg-subtle">
                    {data.sourceExt.id}
                  </span>
                </div>
              </>
            )}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {data && (
            <div className="flex flex-col gap-4">
              {data.sourceExt.description && (
                <p className="text-sm text-fg-muted">
                  {data.sourceExt.description}
                </p>
              )}
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-bg-muted text-xs text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">
                        编辑器
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        状态
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        版本
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        大小
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        目录
                      </th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <Row
                      editorName={data.sourceEditor.name}
                      ext={data.sourceExt}
                      exists={true}
                      isSource
                      compareTo={null}
                    />
                    {data.targets.map((t) => (
                      <Row
                        key={t.editor.id}
                        editorName={t.editor.name}
                        ext={t.extension ?? null}
                        exists={t.exists}
                        isSource={false}
                        compareTo={data.sourceExt.version}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {data.sourceExt.engines_vscode && (
                <div className="text-xs text-fg-muted">
                  <span className="font-medium">引擎要求:</span>{" "}
                  <code className="font-mono">
                    {data.sourceExt.engines_vscode}
                  </code>
                </div>
              )}
              {data.sourceExt.is_ms_proprietary && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-fg">
                  ⚠ 该扩展属于微软专有 (
                  <code className="font-mono">{data.sourceExt.publisher}</code>
                  ),在非 VSCode 中使用可能违反许可证。
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="primary">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  editorName,
  ext,
  exists,
  isSource,
  compareTo,
}: {
  editorName: string;
  ext: Extension | null;
  exists: boolean;
  isSource: boolean;
  compareTo: string | null;
}) {
  let statusEl: React.ReactNode;
  if (!exists) {
    statusEl = <span className="text-fg-subtle italic">目录缺失</span>;
  } else if (!ext) {
    statusEl = (
      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <X className="h-3 w-3" /> 未装
      </span>
    );
  } else if (isSource) {
    statusEl = (
      <span className="text-accent font-medium">
        主源{!ext.registered && <span className="ml-1 text-fg-subtle italic">(孤儿)</span>}
      </span>
    );
  } else if (!ext.registered) {
    statusEl = (
      <span className="inline-flex items-center gap-1 text-fg-muted italic">
        孤儿(未注册)
      </span>
    );
  } else if (!compareTo) {
    statusEl = <span className="text-fg-muted">—</span>;
  } else {
    const c = compareVersions(compareTo, ext.version);
    if (c === 0) {
      statusEl = (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="h-3 w-3" /> 同版
        </span>
      );
    } else if (c > 0) {
      statusEl = (
        <span className="inline-flex items-center gap-1 text-warning">
          <ChevronDown className="h-3 w-3" /> 旧版
        </span>
      );
    } else {
      statusEl = (
        <span className="inline-flex items-center gap-1 text-accent">
          <ChevronUp className="h-3 w-3" /> 新版
        </span>
      );
    }
  }

  return (
    <tr className={cn("border-t border-border", isSource && "bg-accent/5")}>
      <td className="px-3 py-2 font-medium text-fg">{editorName}</td>
      <td className="px-3 py-2">{statusEl}</td>
      <td className="px-3 py-2 font-mono text-xs">
        {ext ? ext.version : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-fg-muted">
        {ext ? formatBytes(ext.size_bytes) : "—"}
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-fg-subtle truncate max-w-[16rem]">
        {ext?.folder_path ?? "—"}
      </td>
      <td className="px-3 py-2">
        {ext && (
          <OpenWithButton
            path={ext.folder_path}
            showLabel={false}
            variant="ghost"
            size="sm"
            title="打开扩展目录"
          />
        )}
      </td>
    </tr>
  );
}

function ExtensionIconLarge({ ext }: { ext: Extension }) {
  const url = iconUrl(ext.icon_path);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-10 w-10 rounded-lg object-cover bg-bg-muted"
      />
    );
  }
  const initial = (ext.display_name || ext.name).charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-muted text-base font-semibold text-fg-muted">
      {initial}
    </div>
  );
}
