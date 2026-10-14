# DevHub

让 VSCode、Cursor、Windsurf、Trae 等 VSCode 系编辑器之间一键同步扩展的 Windows 桌面工具。装一次扩展,选中复制到任意目标编辑器;也能从目标编辑器批量删除多余扩展，并提供独立的目录清理工作台、AI 配置管理、AI 终端管理、Node 服务管理、系统设置和工具管理等综合开发者功能。

## 功能

- **多编辑器扫描** — 默认识别 VSCode / Cursor / Windsurf / Trae 的扩展目录,可在设置中添加自定义路径(VSCodium、Code-OSS 等)。
- **直观对比** — 表格列出源编辑器全部扩展,每个目标编辑器一列,直接显示「同版 / 旧版 / 新版 / 未装」状态。
- **多选复制** — 勾选扩展 + 勾选目标编辑器 → 一键批量复制(可选跳过 / 覆盖冲突策略)。
- **安全删除** — 目标编辑器多余扩展先移入 `%TEMP%\devhub-trash\` 回收站,默认保留 7 天,**永不删除源编辑器扩展**。
- **运行检测** — 实时检测目标编辑器进程,操作前提示先关闭。
- **MS 许可证警告** — 检测微软专有扩展(C/C++、Pylance 等),复制到非 VSCode 时弹窗提醒。
- **图标 / 描述 / 大小** — 每个扩展显示自带图标、显示名、描述、磁盘占用。
- **对比详情面板** — 双击行查看该扩展在每个编辑器中的版本、路径、大小。
- **过滤 / 搜索 / 排序** — 仅显示「目标缺失」「目标过期」、按名称 / 版本 / 大小排序。
- **明暗主题** — 跟随系统 / 强制亮 / 强制暗。
- **目录清理** — 导入或编辑 `cleaner.config.json`，按 profile 预览后执行 `clear` / `remove` 永久清理。
- **AI 配置管理** — 管理 Claude、Codex、OpenCode、Pi、Grok、ZCode 和自定义工具的配置目录，可用资源管理器或内置工作区打开，并导入导出工具清单。
- **AI 终端管理** — 按项目绑定 AI CLI，在独立 Windows Terminal 窗口中统一启动、切换、新开和精确关闭会话，并可按开关为新会话注入多组临时环境变量。
- **Node 服务管理** — 添加 Node 项目文件夹，快捷执行 npm / pnpm 等命令并实时查看输出。
- **系统设置** — 集中管理电脑常用设置与快捷电源操作，目前支持一键关闭显示器。
- **工具管理** — 内置工具注册表，一键下载官方便携版、检查更新并直接打开（Geek Uninstaller、Everything、GoNavi、DBX、WizTree、CC Switch、Notepad--），并按「系统工具 / 数据库工具 / AI 工具 / 文本编辑器」分组筛选。

## 默认扩展目录

| 编辑器 | 路径 |
|---|---|
| VSCode | `%USERPROFILE%\.vscode\extensions` |
| Cursor | `%USERPROFILE%\.cursor\extensions` |
| Windsurf | `%USERPROFILE%\.windsurf\extensions` |
| Trae | `%USERPROFILE%\.trae\extensions` |

如果你的编辑器装在自定义位置,可在「设置 → 编辑器目录」修改路径或选择目录。

## AI 配置目录

「AI 配置管理」模式首次使用时会预置以下目录，并将路径解析为当前用户的绝对路径:

| 工具 | 默认目录 |
|---|---|
| Claude | `%USERPROFILE%\.claude` |
| Codex | `%USERPROFILE%\.codex` |
| OpenCode | `%USERPROFILE%\.config\opencode` |
| Pi | `%USERPROFILE%\.pi\agent` |
| Grok | `%USERPROFILE%\.grok` |
| Antigravity CLI | `%USERPROFILE%\.gemini\antigravity-cli` |
| ZCode | `%USERPROFILE%\.zcode` |

默认条目可以修改、删除，也可以继续添加自定义工具。导入导出只包含工具名称和配置目录路径，不会复制目录内的文件、账号或密钥。导入时按条目 ID 合并，当前机器不存在的路径会保留并可重新选择。

每个工具行可以展开查看该工具的关键配置文件及其存在状态（基于各工具官方文档整理）；自定义工具则显示目录内的实际文件:

| 工具 | 关键配置文件 |
|---|---|
| Claude | `settings.json`(全局设置)、`CLAUDE.md`(用户级记忆)、`rules/`、`commands/`、`agents/`、`skills/` |
| Codex | `config.toml`(全局配置)、`AGENTS.md`(全局指令)、`auth.json`(登录凭据)、`prompts/` |
| OpenCode | `opencode.json(c)`(全局配置)、`tui.json(c)`(界面配置)、`AGENTS.md`(全局规则)、`agents/`、`commands/`、`plugins/`、`skills/` |
| Pi | `settings.json`、`keybindings.json`、`mcp.json`、`models.json`、`auth.json`、`AGENTS.md`、`SYSTEM.md`、`APPEND_SYSTEM.md`、`extensions/`、`skills/`、`prompts/`、`themes/` |
| Grok | `user-settings.json`(用户设置)、`workspace-trust.json`(工作区信任) |
| Antigravity CLI | `settings.json`(持久化设置,仅保存与默认值不同的项)、`keybindings.json`(自定义键位绑定) |
| ZCode | `v2/config.json`(全局配置)、`v2/provider_config.json`(提供商配置)、`v2/setting.json`(用户设置)、`v2/credentials.json`(凭据)、`cli/agents/`(子代理)、`cli/plugins/`(插件) |

## AI 终端管理

「AI 终端管理」模式维护独立的项目和 AI CLI 清单。新项目默认绑定添加项目时已有的全部工具；之后新增工具不会自动绑定旧项目。首次使用预置以下可编辑命令：

| 工具 | PowerShell 启动命令 |
|---|---|
| Codex | `codex --dangerously-bypass-approvals-and-sandbox` |
| Claude Code | `claude --dangerously-skip-permissions` |
| Gemini CLI | `gemini --approval-mode=yolo` |
| Qwen Code | `qwen --approval-mode=yolo` |
| OpenCode | `opencode --auto` |
| Aider | `aider --yes-always` |

这些参数会绕过对应 AI CLI 的批准或沙箱保护，可能让工具直接执行命令和修改文件；只应在可信项目和明确了解风险时使用。”最高权限”不代表 Windows UAC 管理员权限，DevHub 不会申请提权。

该模式仅支持 Windows，并依赖系统可执行的 `wt.exe`（Windows Terminal）。应用不会探测或安装 AI CLI；命令不可用时 Terminal 会保持打开，以便查看 PowerShell 错误并修改配置。普通启动会优先切回同项目、同工具最近的存活会话，只有会话卡片的”新开”操作会创建重复会话。

项目和工具配置会持久化；运行会话只保存在当前 DevHub 进程内存中。应用重启后不会恢复或接管之前的 Terminal 窗口。切换模式、关闭页面或退出 DevHub 都不会关闭已经打开的 Terminal；需要在管理页中单独或批量关闭。

临时环境变量按自定义分组保存。页头开关关闭时，新终端只继承系统环境。开关开启时，已勾选的组按列表顺序合并后注入这次 PowerShell 进程，同名变量不区分大小写，以后面的组为准。已经打开的窗口不会重新注入。变量值写在本机 `settings.json` 里，也会出现在该窗口的启动命令中，关闭窗口后即从进程环境中消失，不会写入用户或系统环境变量。

## Node 服务管理

「Node 服务管理」模式用于集中管理本机的 Node 项目（前端服务、Node 脚本服务等）：

1. 点击「添加」选择，或直接把文件夹拖入窗口（支持一次拖入多个，自动跳过重复项）；文件夹路径会持久化。
2. 应用自动读取该文件夹的 `package.json`，把 `scripts` 列成一排快捷按钮（如 `npm run dev`），并检测包管理器（pnpm-lock.yaml → pnpm、yarn.lock → yarn、bun → bun，否则 npm）。
3. 每个文件夹都有内置的「HTTP 服务」按钮：无需 package.json，一键用应用自带的零依赖静态服务脚本在该文件夹启动 Node HTTP 服务（目录浏览 + 静态文件），只监听 `127.0.0.1`，端口由系统随机分配，启动后会显示地址并可一键打开浏览器。
4. 也可以在「快捷命令」里保存常用命令（如 `npm install`），或在输入框直接输入任意命令「立即执行」——等同于在该文件夹下开了一个终端运行命令。
5. 每次执行都会生成一个任务卡片，输出实时显示在内置终端（xterm）中；可以单独停止某个任务（taskkill 进程树），也可以「全部停止」。

说明:

- 命令通过 `cmd /C` 在服务文件夹内执行，继承系统 PATH，`npm`、`pnpm`、`node`、`npx`、`git` 等均可直接使用。
- 命令的输出通过事件实时推送到界面，HBuilderX CLI 模式用的也是同一套机制。
- 应用退出时若还有运行中的任务，会先弹窗确认；确认退出会终止所有 Node 任务（HBuilderX WEB 任务同理）。
- 服务的文件夹列表和快捷命令持久化；任务的输出只保存在当前进程内存中，重启后不恢复。

## 系统设置

「系统设置」模式目前提供「电源与显示」分组下的**关闭显示器**操作：点击按钮后立即关闭显示器屏幕（等同系统电源菜单中的「关闭显示器」），不锁屏、不休眠，移动鼠标或按任意键即可重新点亮。后续常用系统设置会继续加入该模式。

## 工具管理

「工具管理」模式内置一份工具注册表，一键下载官方便携版、检查更新并直接打开。工具解压到应用数据目录 `%APPDATA%\com.xiaoxiaol123456.devhub\tools\<id>\`，不写注册表、不留安装残留；卸载时直接删除该目录即可。

| 工具 | 说明 |
|---|---|
| Geek Uninstaller | 轻量软件卸载工具，支持强制清理残留 |
| Everything | 文件名即时搜索（1.4 稳定版 x64 便携包，多语言） |
| GoNavi | 高性能多数据源数据库客户端 |
| DBX | 轻量跨平台数据库客户端（90+ 数据源，内置 AI/MCP） |
| WizTree | 极速磁盘空间分析（直接读取 NTFS 索引） |
| CC Switch | Claude Code / Codex 等 AI CLI 的供应商与配置切换 |
| Magpie | AI 代理网关，将 Claude Code、Codex、Gemini CLI 等代理路由到任意模型/供应商（协议互转、多 key 轮换、自动故障转移） |
| Notepad-- | 轻量开源文本编辑器（类 Notepad++，支持多标签、列编辑、Lua 插件） |

说明：

- 版本号来自各工具官方更新源（官网 update.txt / 版本接口 / GitHub releases），进入页面时自动在后台检查一次，也可手动「检查更新」。
- 下载为流式下载并显示进度；失败时不留半成品文件。
- 需要管理员权限的工具（如 Geek Uninstaller）启动时会触发 UAC 弹窗；使用右上角「管理员重启」后本会话内不再弹窗。

## 开发与构建

### 环境要求

- Rust 1.80+(stable-x86_64-pc-windows-msvc)
- Node.js 18+ + pnpm 9+
- Visual Studio 2022 + C++ 工作负载(MSVC 链接器)
- WebView2 Runtime(Win10/11 通常预装)

### 启动开发模式

```powershell
pnpm install
pnpm tauri dev
```

### 打包发布

```powershell
pnpm tauri build
```

产物位置:

- NSIS 安装包:`src-tauri\target\release\bundle\nsis\DevHub_<ver>_x64-setup.exe`
- MSI 安装包:`src-tauri\target\release\bundle\msi\DevHub_<ver>_x64_en-US.msi`
- 单 exe:`src-tauri\target\release\devhub.exe`

发布版本应用 `opt-level=z + LTO + strip`,产物约 **8–12 MB**。

## 工作原理

VSCode 系编辑器都从一个**固定目录**加载扩展(`<userhome>/.<editor>/extensions`),且扩展本身就是一个独立子目录(包含 `package.json` + 资源文件)。本工具:

1. 扫描每个编辑器目录下的子文件夹,读取 `package.json` 提取元数据。
2. 复制时直接拷贝整个子目录到目标编辑器的扩展目录,并在目标 `extensions.json` 中写入最小注册记录。
3. 删除时把目录移入回收站(同盘 rename / 跨盘 copy+remove),并从目标 `extensions.json` 移除对应记录。

## 注意事项

- **目标编辑器正在运行** 时复制可能因文件占用失败,工具会提示先关闭。
- **MS 自家扩展**(`ms-vscode.*` `ms-python.*` 等)在非 VSCode 中运行可能违反许可证,工具会标记并警告但不强制阻止。
- **不同 fork 的引擎版本** 略有差异,极少数扩展可能因 `engines.vscode` 校验失败,在该编辑器内禁用即可。
- 删除的扩展可在 `%TEMP%\devhub-trash\` 找到,按日期分批存放。

## 目录清理

「目录清理」模式使用独立配置文件:

```text
%APPDATA%\com.xiaoxiaol123456.devhub\cleaner\cleaner.config.json
```

如果别人发给你 `cleaner.config.json`:

1. 打开 DevHub。
2. 进入「目录清理」。
3. 点击「导入」并选择该 JSON 文件。
4. 预览确认绝对路径后再执行。

动作说明:

- `clear`: 清空目录内容，保留目录本身。
- `remove`: 删除文件或整个目录。

目录清理是永久删除，不进入回收站。执行前会显示 profile、动作和绝对路径列表，并要求二次确认。

## 项目结构

```
devhub/
├─ src/                      React + TS 前端
│  ├─ components/            UI 组件
│  ├─ stores/app.ts          Zustand 全局状态
│  └─ lib/tauri.ts           Tauri 命令封装
└─ src-tauri/                Rust 后端
   └─ src/
      ├─ editors.rs          编辑器默认配置
      ├─ scanner.rs          扩展目录扫描
      ├─ syncer.rs           复制/删除/回收站
      ├─ cleaner.rs          目录清理配置、预览和执行
      ├─ terminal.rs         Windows Terminal 会话启动、聚焦和精确关闭
      ├─ node_services.rs    Node 服务命令执行、停止与实时输出
      ├─ settings.rs         配置读写
      └─ commands.rs         tauri::command 入口
```

## 许可

MIT(代码本身);所同步的扩展遵循各扩展原本的许可证。
