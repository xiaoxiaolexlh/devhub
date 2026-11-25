import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { LauncherPanel } from "@/components/LauncherPanel";
import { useApp } from "@/stores/app";

interface Props { open: boolean; onOpenChange: (open: boolean) => void; onOpenSettings: () => void }

export function CommandPalette({ open, onOpenChange, onOpenSettings }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent width="max-w-3xl" showClose={false} className="overflow-hidden p-0" aria-describedby={undefined}>
      <LauncherPanel open={open} onClose={() => onOpenChange(false)} onOpenMode={async (mode, toolId) => {
        const store = useApp.getState();
        if (toolId) store.setToolFocusId(toolId);
        if (mode === "settings") onOpenSettings(); else store.setAppMode(mode);
      }} />
    </DialogContent>
  </Dialog>;
}
