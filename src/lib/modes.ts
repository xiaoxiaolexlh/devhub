import type { ComponentType } from "react";
import type { AppMode } from "@/stores/app";
import { Bot, BrainCircuit, FolderSync, History, MonitorCog, Package, PanelsTopLeft, Puzzle, ServerCog, TerminalSquare, Trash2 } from "lucide-react";

export interface ModeMeta {
  mode: AppMode;
  title: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  highlights: string[];
}

/** One catalog drives the home cards, mode switcher and both launchers. */
export const APP_MODES: ModeMeta[] = [
  { mode: "extensions", title: "扩展同步", desc: "在 VS Code、Windsurf、Cursor、Trae 等编辑器之间同步扩展目录。", icon: Puzzle, highlights: ["扩展对比", "复制到目标", "从目标删除"] },
  { mode: "project-configs", title: "项目配置同步", desc: "把项目中的 .vscode、.windsurf、.trae、.cursor 等配置目录同步到其它项目。", icon: FolderSync, highlights: ["项目目录记忆", "配置目录勾选", "冲突预览"] },
  { mode: "hbuilderx-cli", title: "HBuilderX CLI", desc: "管理 uni-app 项目，通过 HBuilderX CLI 快捷运行和发行。", icon: TerminalSquare, highlights: ["运行 WEB", "命令复制", "配置导入导出"] },
  { mode: "node-services", title: "Node 服务管理", desc: "添加 Node 项目文件夹，快捷执行 npm / pnpm 命令并实时查看输出，像内置终端一样管理服务。", icon: ServerCog, highlights: ["快捷命令", "实时输出", "一键停止"] },
  { mode: "directory-cleaner", title: "目录清理", desc: "按 profile 管理清理目标，预览后永久清空目录或删除目标。", icon: Trash2, highlights: ["JSON 配置", "执行预览", "永久删除"] },
  { mode: "ai-configs", title: "AI 配置管理", desc: "集中管理 Claude、Codex、OpenCode、Pi、Grok 等工具的配置目录。", icon: Bot, highlights: ["自定义工具", "双方式打开", "配置导入导出"] },
  { mode: "ai-agents", title: "AI Agent 管理", desc: "检测电脑 Node 环境，通过 npm 一键安装、更新和卸载 Claude Code、Codex、Gemini CLI 等 AI Agent。", icon: BrainCircuit, highlights: ["Node 环境检测", "npm 一键安装", "更新与卸载"] },
  { mode: "terminal-manager", title: "AI 终端管理", desc: "按项目和 AI 工具统一启动、切换与关闭独立 Windows Terminal 会话，并可注入分组临时环境变量。", icon: PanelsTopLeft, highlights: ["项目绑定", "窗口切换", "临时变量"] },
  { mode: "powershell-history", title: "PowerShell 历史", desc: "查看并管理 PSReadLine 保存的 PowerShell 命令历史，支持搜索、新增、编辑和删除。", icon: History, highlights: ["历史搜索", "增删改查", "保存前备份"] },
  { mode: "tool-manager", title: "工具管理", desc: "集中下载、更新和打开常用外部便携工具，内置 Geek、Everything、GoNavi、DBX、WizTree。", icon: Package, highlights: ["一键下载", "更新提醒", "双击打开"] },
  { mode: "system-settings", title: "系统设置", desc: "管理 Windows 用户和系统环境变量、系统文件夹位置，以及右键菜单和快捷电源操作。", icon: MonitorCog, highlights: ["环境变量", "电源与显示", "系统文件夹"] },
];
