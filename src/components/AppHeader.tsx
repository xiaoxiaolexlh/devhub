import type { ReactNode } from "react";
import { AppMode, useApp } from "@/stores/app";
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
  Bot,
  BrainCircuit,
  ChevronDown,
  FolderSync,
  Layers,
  MonitorCog,
  Package,
  PanelsTopLeft,
  Puzzle,
  ServerCog,
  Settings,
  TerminalSquare,
  Trash2,
} from "lucide-react";

export interface ModeMeta {
  mode: AppMode;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const APP_MODES: ModeMeta[] = [
  {
    mode: "extensions",
    title: "扩展同步",
    desc: "编辑器间同步扩展目录",
    icon: Puzzle,
  },
  {
    mode: "project-configs",
    title: "项目配置同步",
    desc: "同步项目内的配置目录",
    icon: FolderSync,
  },
  {
    mode: "hbuilderx-cli",
    title: "HBuilderX CLI",
    desc: "uni-app 运行与发行命令行",
    icon: TerminalSquare,
  },
  {
    mode: "node-services",
    title: "Node 服务管理",
    desc: "快捷管理本地 Node 服务与终端",
    icon: ServerCog,
  },
  {
    mode: "directory-cleaner",
    title: "目录清理",
    desc: "规则化按目录预览与清理",
    icon: Trash2,
  },
  {
    mode: "ai-configs",
    title: "AI 配置管理",
    desc: "全局管理各 AI 工具配置",
    icon: Bot,
  },
  {
    mode: "ai-agents",
    title: "AI Agent 管理",
    desc: "一键安装更新 CLI Agent",
    icon: BrainCircuit,
  },
  {
    mode: "terminal-manager",
    title: "AI 终端管理",
    desc: "项目级 Windows Terminal 会话管理",
    icon: PanelsTopLeft,
  },
  {
    mode: "tool-manager",
    title: "工具管理",
    desc: "集中下载更新常用便携工具",
    icon: Package,
  },
  {
    mode: "system-settings",
    title: "系统设置",
    desc: "系统已知文件夹与电源显示",
    icon: MonitorCog,
  },
];

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
