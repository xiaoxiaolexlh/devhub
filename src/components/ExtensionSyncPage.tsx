import { useState } from "react";
import { ActionBar } from "@/components/ActionBar";
import { CopyDialog } from "@/components/CopyDialog";
import { DeleteDialog } from "@/components/DeleteDialog";
import { DiffDrawer } from "@/components/DiffDrawer";
import { EditorBar } from "@/components/EditorBar";
import { ExtensionTable } from "@/components/ExtensionTable";
import { Button } from "@/components/ui/Button";
import { useApp } from "@/stores/app";
import { ArrowLeft, FolderSync } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
}

export function ExtensionSyncPage({ onOpenSettings }: Props) {
  const { selectedFolders, scans, sourceEditorId, setAppMode } = useApp();
  const [openCopy, setOpenCopy] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [diffExtId, setDiffExtId] = useState<string | null>(null);

  function onCompare() {
    const firstFolder = Array.from(selectedFolders)[0];
    if (!firstFolder) return;
    const sourceScan = scans.find((s) => s.editor.id === sourceEditorId);
    const ext = sourceScan?.extensions.find((e) => e.folder_name === firstFolder);
    if (ext) setDiffExtId(ext.id);
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <div className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setAppMode("home")}>
          <ArrowLeft className="h-3.5 w-3.5" />
          模式
        </Button>
        <div>
          <div className="text-sm font-semibold text-fg">扩展同步</div>
          <div className="text-xs text-fg-muted">同步编辑器扩展目录</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAppMode("project-configs")}
          className="ml-auto"
        >
          <FolderSync className="h-3.5 w-3.5" />
          项目配置同步
        </Button>
      </div>
      <EditorBar onOpenSettings={onOpenSettings} />
      <ExtensionTable onShowDiff={setDiffExtId} />
      <ActionBar
        onCopy={() => setOpenCopy(true)}
        onDelete={() => setOpenDelete(true)}
        onCompare={onCompare}
      />
      <CopyDialog open={openCopy} onClose={() => setOpenCopy(false)} />
      <DeleteDialog open={openDelete} onClose={() => setOpenDelete(false)} />
      <DiffDrawer extensionId={diffExtId} onClose={() => setDiffExtId(null)} />
    </div>
  );
}
