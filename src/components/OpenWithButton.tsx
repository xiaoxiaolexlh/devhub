import { useMemo, useState } from "react";
import { Check, ChevronDown, FolderOpen, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  enabledOpenMethods,
  isOpenMethodReady,
  openMethodUnavailableReason,
  resolvePrimaryOpenMethod,
} from "@/lib/openMethod";
import { tauri, type OpenMethod } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";

type Props = {
  path: string;
  disabled?: boolean;
  label?: string;
  showLabel?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  menuAlign?: "start" | "center" | "end";
  onError?: (message: string) => void;
  onSuccess?: (path: string, method: OpenMethod) => void;
  title?: string;
};

export function OpenWithButton({
  path,
  disabled = false,
  label,
  showLabel = true,
  variant = "outline",
  size = "sm",
  className,
  menuAlign = "end",
  onError,
  onSuccess,
  title,
}: Props) {
  const settings = useApp((s) => s.settings);
  const [opening, setOpening] = useState(false);

  const methods = useMemo(() => enabledOpenMethods(settings), [settings]);
  const primary = useMemo(() => resolvePrimaryOpenMethod(settings), [settings]);
  const trimmedPath = path.trim();
  const pathOk = Boolean(trimmedPath);
  const canPrimary = pathOk && isOpenMethodReady(primary) && !disabled && !opening;

  const buttonLabel = label ?? (primary ? `打开 (${primary.name})` : "打开");
  const mainTitle =
    title ??
    (primary
      ? `使用${primary.name}打开`
      : "请先在设置中配置可用的打开方式");

  async function openWith(method: OpenMethod) {
    if (!pathOk) return;
    const reason = openMethodUnavailableReason(method);
    if (reason) {
      onError?.(reason);
      return;
    }
    setOpening(true);
    try {
      await tauri.openWithMethod(method.id, trimmedPath);
      onSuccess?.(trimmedPath, method);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setOpening(false);
    }
  }

  const mainButton = (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(showLabel ? undefined : undefined, "rounded-r-none border-r-0", className)}
      disabled={!canPrimary}
      onClick={() => primary && void openWith(primary)}
      title={mainTitle}
    >
      {opening ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FolderOpen className="h-3.5 w-3.5" />
      )}
      {showLabel && <span className="max-w-[9rem] truncate">{buttonLabel}</span>}
    </Button>
  );

  return (
    <div className="inline-flex items-center">
      {canPrimary ? (
        mainButton
      ) : (
        <Tooltip content={mainTitle}>
          <span className="inline-flex">{mainButton}</span>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size === "icon" ? "icon" : size}
            className={cn(
              "rounded-l-none px-1.5",
              size === "icon" && "w-7",
              !showLabel && size !== "icon" && "px-1.5",
            )}
            disabled={disabled || !pathOk || opening || methods.length === 0}
            title="选择打开方式"
            aria-label="选择打开方式"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} className="min-w-[12rem]">
          <DropdownMenuLabel>打开方式</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {methods.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-fg-muted">请先在设置中添加打开方式</div>
          ) : (
            methods.map((method) => {
              const ready = isOpenMethodReady(method);
              const reason = openMethodUnavailableReason(method);
              const isDefault = method.id === settings?.default_open_method_id;
              return (
                <DropdownMenuItem
                  key={method.id}
                  disabled={!ready || opening}
                  title={reason ?? undefined}
                  onSelect={() => {
                    if (ready) void openWith(method);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{method.name}</span>
                  {!ready && (
                    <span className="shrink-0 text-[10px] text-fg-muted">未配置</span>
                  )}
                  {ready && isDefault && (
                    <Check className="h-3 w-3 shrink-0 text-accent" />
                  )}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
