# 工具管理模式计划

## Summary

- 首页新增一个模式：“工具管理”，用于集中管理常见的外部可执行程序。
- 第一版只内置“Geek Uninstaller”一个工具，不探测用户本机是否已安装 geek，只管本应用是否已下载该工具。
- 如果工具未下载，页面明显提示用户下载；已下载后用户可双击卡片或点击按钮直接打开。
- 下载来源为官网固定链接，下载的是便携 zip，解压后得到 `geek.exe`，存放在应用数据目录下。
- 通过官网更新源 `update.txt` 处理版本与更新：安装时记录版本，进入页面或手动触发时拉取 `update.txt` 比对，有新版则提示用户更新。
- 工具列表为后端内置注册表（写死），第一版不做用户自定义增删工具。

## Key Changes

- 新增应用模式：
  - `AppMode` 增加 `tool-manager`，并同步更新 `loadAppMode`、`setAppMode` 的合法模式白名单。
  - 首页 `ModeSelectPage` 新增“工具管理”卡片。
  - 新增工具管理工作台页面 `ToolManagerPage`，顶部提供“模式”返回入口，主体为工具卡片列表。

- 工具注册表（内置、写死）：
  - 在 Rust 后端定义工具注册表，类似现有 `default_editors` / `default_terminal_ai_tools` 的写法。
  - 每个注册表条目包含：
    - `id`：工具标识，例如 `geek`。
    - `name`：显示名称，例如 `Geek Uninstaller`。
    - `download_url`：便携版下载链接，`https://geekuninstaller.com/geek.zip`。
    - `update_url`：更新源链接，`https://geekuninstaller.com/update.txt`。
    - `exe_entry`：zip 内目标可执行文件名，`geek.exe`。
    - `homepage`：官网地址，用于“访问主页”。
  - 第一版只注册 `geek` 一条；以后新增工具只需在注册表追加一条。

- 安装状态与持久化：
  - 新增独立状态文件 `tools.json`，存放在 `data_dir/extension-sync/`，不污染 `settings.json`。
  - 每个已下载工具记录：
    - `version`：安装时从 `update.txt` 抓取的版本号。
    - `exe_path`：解压后的 `geek.exe` 绝对路径。
    - `installed_at`：安装时间（ISO 字符串）。
    - `last_checked`：上次检查更新的时间。
  - 工具目录约定为 `data_dir/extension-sync/tools/<tool_id>/`，exe 落地为 `tools/<tool_id>/<exe_entry>`。

- 下载与解压：
  - 使用 `reqwest` 流式下载，边下载边通过 Tauri 事件 `tool-download-progress` 推送进度百分比，前端渲染进度条。
  - 下载流程：先拉取 `update.txt` 获取当前最新版本号 → 下载 zip 到临时文件 → 用 `zip` crate 解压 → 只取注册表指定的 `exe_entry` → 写入工具目录 → 落地状态文件。
  - 下载失败、解压失败、找不到目标 exe 时给出明确错误并回滚半成品文件。

- 版本与更新：
  - `update.txt` 为单行管道分隔格式：`build|version|changelog1|changelog2|...`。
  - 版本比较取第二个字段（如 `1.5.4.180`），按点分数字逐段比较。
  - 更新检查：拉取 `update.txt`，与已记录版本比较，返回是否有更新、最新版本号、changelog 列表。
  - 更新动作：对同一 `download_url` 重新执行下载+解压流程，并刷新版本号。因为 geek.zip 始终托管最新版，更新等同于重新下载。
  - 进入页面时自动触发一次后台更新检查（不阻塞列表展示），把“有更新”状态标到对应卡片。

- 打开工具：
  - 已下载工具可双击卡片或点击“打开”按钮启动，后端用 `std::process::Command::new(exe_path).spawn()`。
  - 提供“打开所在目录”按钮，复用现有 `open_in_explorer` 能力。

- 权限影响：
  - 无需改动 `capabilities/default.json` 和 `tauri.conf.json`。
  - 联网下载、解压、启动进程全部在 Rust 命令内完成，前端只通过 `invoke` 调用自定义命令。
  - CSP 已为 null，不阻断网络请求。

## Backend Commands

新增 Tauri 命令（在 `lib.rs` 的 `generate_handler!` 中注册，并在前端 `tauri.ts` 增加 invoke 封装）：

| 命令 | 说明 |
| --- | --- |
| `tool_list` | 返回所有注册工具及其安装/更新状态（未下载、已装版本、是否有更新）。 |
| `tool_download` | 异步下载+解压指定工具，通过事件 `tool-download-progress` 推送进度，返回安装结果。 |
| `tool_check_updates` | 拉取 `update.txt` 比对版本，返回 `{ has_update, latest_version, changelog }`。 |
| `tool_update` | 对指定工具重新执行下载+解压并刷新版本，等同于重新下载最新版。 |
| `tool_launch` | 启动已下载工具的 exe。 |
| `tool_open_dir` | 打开工具所在目录，复用 `open_in_explorer`。 |

下载进度事件载荷：

```json
{
  "tool_id": "geek",
  "downloaded": 1048576,
  "total": 3198063,
  "percent": 32
}
```

## Data Model

内置注册表条目（Rust，写死）：

```rust
struct ToolSpec {
    id: String,            // "geek"
    name: String,          // "Geek Uninstaller"
    download_url: String,  // "https://geekuninstaller.com/geek.zip"
    update_url: String,    // "https://geekuninstaller.com/update.txt"
    exe_entry: String,     // "geek.exe"
    homepage: String,      // "https://geekuninstaller.com"
}
```

已装工具状态（机器生成，存 `tools.json`）：

```rust
struct ToolState {
    version: String,       // 安装时记录的 update.txt 版本
    exe_path: String,      // 解压后的 geek.exe 绝对路径
    installed_at: String,  // ISO 时间
    last_checked: String,  // 上次检查更新时间
}
```

`update.txt` 格式示例：

```text
180|1.5.4.180|Microsoft Edge and its companion apps are now removed via Force Removal|Fixed crashes while scanning for leftovers|Minor improvements and fixes
```

字段含义：`build 号 | 版本号 | changelog 条目（可多条，以管道分隔）`。

## UI 建议

- 顶栏：与其它模式一致，“模式”返回按钮 + “工具管理”标题 + 设置按钮。
- 主体：工具卡片列表（第一版只有 Geek 一张卡）。每张卡显示名称、状态徽标、版本号、changelog（有更新时展开）。
- 状态分支：
  - 未下载：徽标“未下载”，按钮“下载”。点击后显示进度条，完成后变为“已安装 vX.Y.Z”。
  - 已安装：显示版本号，按钮“打开”（双击卡片亦可）、“打开目录”、“检查更新”。
  - 有更新：徽标高亮“有更新 vX.Y.Z”，按钮“更新”，展开 changelog 列表。
- 进入页面时自动调一次 `tool_check_updates`（后台），把更新状态标到卡片上；未下载工具同样在卡片上明显提示“请下载”。

## Dependencies

- 新增 `reqwest`（已是 Cargo.lock 中的传递依赖，升为正式依赖几乎零增本，使用 rustls-tls + stream 特性）。
- 新增 `zip` crate（当前依赖树中不存在，用于解压 geek.zip）。
- `tokio` 已在依赖树中，按需开启 `fs` / `io-util` 特性。

## Test Plan

- 运行 `pnpm build` 做前端类型检查和构建验证。
- 运行 `cargo check` 验证 Tauri 后端编译。
- 手动验证：
  - 首页出现“工具管理”卡片，点击进入工具管理工作台。
  - 从工作台“模式”按钮可返回首页。
  - 未下载时卡片显示“未下载”，点击“下载”后能看到进度条推进。
  - 下载完成后卡片显示“已安装 vX.Y.Z”，`tools.json` 中记录了版本和 exe 路径。
  - 双击卡片或点击“打开”能启动 `geek.exe`。
  - 点击“打开目录”在资源管理器中定位到 `geek.exe` 所在目录。
  - 进入页面自动检查更新，最新版高于已装版时卡片显示“有更新 vX.Y.Z”并展开 changelog。
  - 点击“更新”重新下载并刷新版本号，更新提示消失。
  - 无网络或下载链接不可达时给出明确错误，不留下半成品文件。
  - 解压后找不到 `geek.exe` 时给出错误提示。

## Assumptions

- 第一版只内置 Geek Uninstaller 一个工具，不做用户自定义增删工具。
- 不探测用户本机是否已单独安装 geek，只管本应用是否已下载该工具。
- 假设 `geek.zip` 为官方便携版，解压后包含 `geek.exe`；实现时以实际解压结果为准，若结构不同需调整 `exe_entry` 或解压逻辑。
- geek.zip 始终托管最新版，更新动作等同于重新下载同一链接。
- 版本号以 `update.txt` 为准，不读取 `geek.exe` 内嵌的文件版本信息。
- 进入页面自动检查更新为后台请求，不阻塞列表展示；失败时静默，不影响打开操作。
