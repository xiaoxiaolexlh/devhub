import { useState } from "react";
import { ActionBar } from "@/components/ActionBar";
import { CopyDialog } from "@/components/CopyDialog";
import { DeleteDialog } from "@/components/DeleteDialog";
import { DiffDrawer } from "@/components/DiffDrawer";
import { EditorBar } from "@/components/EditorBar";
import { ExtensionTable } from "@/components/ExtensionTable";
import { Button } from "@/components/ui/Button";
import { useApp } from "@/stores/app";
import { FolderSync } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";

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
      <AppHeader
        title="扩展同步"
        subtitle="在 VS Code、Windsurf、Cursor、Trae 等编辑器间对比与同步扩展"
        onOpenSettings={onOpenSettings}
        rightActions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAppMode("project-configs")}
          >
            <FolderSync className="h-3.5 w-3.5" />
            项目配置同步
          </Button>
        }
      />
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
