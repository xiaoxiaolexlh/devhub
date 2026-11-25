import type { ReactNode } from "react";
import { APP_MODES } from "@/lib/modes";
import { useApp } from "@/stores/app";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import {
  ArrowLeft,
  ChevronDown,
  Layers,
  Settings,
} from "lucide-react";

export { APP_MODES, type ModeMeta } from "@/lib/modes";

interface AppHeaderProps {
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  rightActions?: ReactNode;
  onOpenSettings?: () => void;
  showModeNav?: boolean;
}

export function AppHeader({
  title,
  subtitle,
  badge,
  rightActions,
  onOpenSettings,
  showModeNav = true,
}: AppHeaderProps) {
  const { appMode, setAppMode } = useApp();
  const currentModeInfo = APP_MODES.find((m) => m.mode === appMode);
  const CurrentIcon = currentModeInfo?.icon ?? Layers;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur-sm">
      {showModeNav && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAppMode("home")}
            className="text-fg-muted hover:text-fg"
            title="返回主页 (Esc)"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">主页</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="快速切换工作台"
              >
                <CurrentIcon className="h-3.5 w-3.5 text-accent" />
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>切换工作台</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {APP_MODES.map((item) => {
                const Icon = item.icon;
                const isActive = item.mode === appMode;
                return (
                  <DropdownMenuItem
                    key={item.mode}
                    onClick={() => setAppMode(item.mode)}
                    className={isActive ? "bg-accent/10 font-medium text-accent" : ""}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-accent/80" />
                    <span className="truncate">{item.title}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
          {badge}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-fg-muted">{subtitle}</div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {rightActions}
        {onOpenSettings && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="text-fg-muted hover:text-fg"
            title="应用设置"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">设置</span>
          </Button>
        )}
      </div>
    </header>
  );
}
