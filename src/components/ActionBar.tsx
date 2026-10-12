import { useApp } from "@/stores/app";
import { Button } from "@/components/ui/Button";
import { Copy, Trash2, X, GitCompare } from "lucide-react";

interface Props {
  onCopy: () => void;
  onDelete: () => void;
  onCompare: () => void;
}

export function ActionBar({ onCopy, onDelete, onCompare }: Props) {
  const { selectedFolders, targetEditorIds, clearSelection } = useApp();
  const count = selectedFolders.size;
  const targets = targetEditorIds.size;
  const disabled = count === 0 || targets === 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-bg-subtle">
      <div className="text-sm text-fg-muted">
        {count > 0 ? (
          <span>
            已选 <span className="font-semibold text-fg">{count}</span> 个扩展
            ·{" "}
            <span className="font-semibold text-fg">{targets}</span> 个目标编辑器
          </span>
        ) : (
          <span className="text-fg-subtle">勾选扩展和目标编辑器后开始操作</span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            <X className="h-3.5 w-3.5" />
            清空选择
          </Button>
        )}
        <Button
          variant="outline"
          size="md"
          onClick={onCompare}
          disabled={count !== 1}
          title={count !== 1 ? "选中单个扩展时可对比" : undefined}
        >
          <GitCompare className="h-4 w-4" />
          对比详情
        </Button>
        <Button
          variant="danger"
          size="md"
          onClick={onDelete}
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
          从目标删除
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onCopy}
          disabled={disabled}
        >
          <Copy className="h-4 w-4" />
          复制到目标
        </Button>
      </div>
    </div>
  );
}
