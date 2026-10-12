import { Button } from "@/components/ui/Button";
import { useApp, type AppMode } from "@/stores/app";
import { ArrowRight, Bot, BrainCircuit, FolderSync, MonitorCog, Package, PanelsTopLeft, Puzzle, Settings, ServerCog, TerminalSquare, Trash2 } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
}

interface ModeCardProps {
  mode: AppMode;
  title: string;
  desc: string;
  icon: React.ReactNode;
  highlights: string[];
}

export function ModeSelectPage({ onOpenSettings }: Props) {
  const { setAppMode } = useApp();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-bg-subtle px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-fg">选择同步模式</h1>
          <p className="text-xs text-fg-muted">根据要同步的内容进入对应工作台</p>
        </div>
        <Button variant="ghost" size="md" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
          设置
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-8">
          <div className="grid w-full max-w-6xl grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <ModeCard
              mode="extensions"
              title="扩展同步"
              desc="在 VS Code、Windsurf、Cursor、Trae 等编辑器之间同步扩展目录。"
              icon={<Puzzle className="h-8 w-8" />}
              highlights={["扩展对比", "复制到目标", "从目标删除"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="project-configs"
              title="项目配置同步"
              desc="把项目中的 .vscode、.windsurf、.trae、.cursor 等配置目录同步到其它项目。"
              icon={<FolderSync className="h-8 w-8" />}
              highlights={["项目目录记忆", "配置目录勾选", "冲突预览"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="hbuilderx-cli"
              title="HBuilderX CLI"
              desc="管理 uni-app 项目，通过 HBuilderX CLI 快捷运行和发行。"
              icon={<TerminalSquare className="h-8 w-8" />}
              highlights={["运行 WEB", "命令复制", "配置导入导出"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="node-services"
              title="Node 服务管理"
              desc="添加 Node 项目文件夹，快捷执行 npm / pnpm 命令并实时查看输出，像内置终端一样管理服务。"
              icon={<ServerCog className="h-8 w-8" />}
              highlights={["快捷命令", "实时输出", "一键停止"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="directory-cleaner"
              title="目录清理"
              desc="按 profile 管理清理目标，预览后永久清空目录或删除目标。"
              icon={<Trash2 className="h-8 w-8" />}
              highlights={["JSON 配置", "执行预览", "永久删除"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="ai-configs"
              title="AI 配置管理"
              desc="集中管理 Claude、Codex、OpenCode、Pi、Grok 等工具的配置目录。"
              icon={<Bot className="h-8 w-8" />}
              highlights={["自定义工具", "双方式打开", "配置导入导出"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="ai-agents"
              title="AI Agent 管理"
              desc="检测电脑 Node 环境，通过 npm 一键安装、更新和卸载 Claude Code、Codex、Gemini CLI 等 AI Agent。"
              icon={<BrainCircuit className="h-8 w-8" />}
              highlights={["Node 环境检测", "npm 一键安装", "更新与卸载"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="terminal-manager"
              title="AI 终端管理"
              desc="按项目和 AI 工具统一启动、切换与关闭独立 Windows Terminal 会话，并可注入分组临时环境变量。"
              icon={<PanelsTopLeft className="h-8 w-8" />}
              highlights={["项目绑定", "窗口切换", "临时变量"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="tool-manager"
              title="工具管理"
              desc="集中下载、更新和打开常用外部便携工具,内置 Geek、Everything、GoNavi、DBX、WizTree。"
              icon={<Package className="h-8 w-8" />}
              highlights={["一键下载", "更新提醒", "双击打开"]}
              onSelect={setAppMode}
            />
            <ModeCard
              mode="system-settings"
              title="系统设置"
              desc="集中管理电脑常用设置与快捷电源操作:一键关闭显示器,查看并自定义桌面、文档、下载等 Windows 已知文件夹的位置。"
              icon={<MonitorCog className="h-8 w-8" />}
              highlights={["电源与显示", "关闭显示器", "系统文件夹"]}
              onSelect={setAppMode}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function ModeCard({ mode, title, desc, icon, highlights, onSelect }: ModeCardProps & { onSelect: (mode: AppMode) => void }) {
  return (
    <button
      onClick={() => onSelect(mode)}
      className="group flex min-h-72 flex-col rounded-2xl border border-border bg-bg-subtle p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-lg"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent">
        {icon}
      </div>
      <div className="mt-5">
        <h2 className="text-xl font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{desc}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {highlights.map((item) => (
          <span key={item} className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-end pt-8 text-sm font-medium text-accent">
        进入
        <ArrowRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
