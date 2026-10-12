# DevHub 改名与目录统一方案

## 1. 背景

项目原名 **Extension Sync**，最初只做 VSCode 系编辑器扩展同步。现已发展为综合开发者工具箱（扩展同步、AI 配置管理、AI 终端管理、Node 服务管理、目录清理、系统设置、工具管理、HBuilderX CLI），原名已名不副实。

同时，应用数据散落在 `%APPDATA%` 下 3 个互不相关的目录中，且与 Tauri 的 identifier 不匹配，导致卸载器无法清理用户数据。

本方案将项目更名为 **DevHub**，统一数据目录，并修复卸载清理问题。

---

## 2. 新名称与 identifier

| 项目 | 旧值 | 新值 |
|------|------|------|
| 产品名 (productName) | Extension Sync | DevHub |
| 二进制名 (Cargo name) | extension-sync | devhub |
| exe 文件名 | extension-sync.exe | devhub.exe |
| identifier | com.dev40.extensionsync | com.xiaoxiaol123456.devhub |
| 窗口标题 | Extension Sync | DevHub |
| 安装包名 | Extension Sync_0.1.0_x64-setup.exe | DevHub_0.1.0_x64-setup.exe |
| 开始菜单/桌面快捷方式 | Extension Sync | DevHub |
| 控制面板条目 | Extension Sync | DevHub |

---

## 3. 旧目录 → 新目录映射

### 3.1 用户数据目录（%APPDATA%）

统一到**一个根目录** `%APPDATA%\com.xiaoxiaol123456.devhub\`，内分子目录：

| 数据 | 旧路径 | 新路径 |
|------|--------|--------|
| 设置 | `%APPDATA%\extension-sync\settings.json` | `%APPDATA%\com.xiaoxiaol123456.devhub\settings.json` |
| 工具状态 | `%APPDATA%\extension-sync\tools.json` | `%APPDATA%\com.xiaoxiaol123456.devhub\tools\tools.json` |
| 已装工具 | `%APPDATA%\extension-sync\tools\<id>\` | `%APPDATA%\com.xiaoxiaol123456.devhub\tools\<id>\` |
| 清理配置 | `%APPDATA%\run-cleaner\cleaner.config.json` | `%APPDATA%\com.xiaoxiaol123456.devhub\cleaner\cleaner.config.json` |

### 3.2 临时目录（%TEMP%）

| 数据 | 旧路径 | 新路径 |
|------|--------|--------|
| 回收站 | `%TEMP%\extension-sync-trash\` | `%TEMP%\devhub-trash\` |
| 工具下载临时文件 | `%TEMP%\extension-sync-<id>.zip` | `%TEMP%\devhub-<id>.zip` |

### 3.3 新目录结构总览

```
%APPDATA%\com.xiaoxiaol123456.devhub\
├── settings.json              ← 用户设置
├── tools\
│   ├── tools.json             ← 工具下载状态
│   └── <tool_id>\             ← 各便携工具解压目录
└── cleaner\
    └── cleaner.config.json     ← 目录清理配置

%TEMP\
├── devhub-trash\               ← 扩展删除回收站（启动时自动清理过期项）
└── devhub-<tool_id>.zip        ← 工具下载临时文件（用完即删）
```

---

## 4. 为什么用 identifier 作目录名

Tauri 的 NSIS 卸载器在用户勾选「删除应用数据」时，删除的是 `%APPDATA%\<identifier>` 目录（见 `installer.nsi:833`）：

```nsis
RmDir /r "$APPDATA\${BUNDLEID}"
```

其中 `${BUNDLEID}` 就是 `tauri.conf.json` 的 `identifier`。

- **旧代码**用 `dirs::data_dir().join("extension-sync")` 硬编码了 `"extension-sync"`，与 identifier `com.dev40.extensionsync` 不匹配，所以卸载器删不到。
- **新方案**让代码中的目录名与 identifier 保持一致为 `com.xiaoxiaol123456.devhub`，卸载器勾选复选框即可自动清理全部用户数据。

---

## 5. 需要修改的文件

### 5.1 tauri.conf.json

```json
{
  "productName": "DevHub",
  "identifier": "com.xiaoxiaol123456.devhub",
  "app": {
    "windows": [
      { "title": "DevHub", ... }
    ]
  }
}
```

### 5.2 Cargo.toml

```toml
[package]
name = "devhub"          # 决定 exe 二进制名: devhub.exe
```

> `[lib] name = "extension_sync_lib"` 保持不变，`main.rs` 中的 `extension_sync_lib::run()` 引用不受影响。

### 5.3 settings.rs

```rust
// 旧
pub fn settings_path() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("extension-sync");
    ...
}

// 新
const APP_DATA_DIR: &str = "com.xiaoxiaol123456.devhub";

pub fn settings_path() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR);
    ...
}
```

### 5.4 tools.rs

```rust
// 旧
fn data_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("extension-sync")
}

// 新
fn data_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR)
}

// 旧（临时下载文件名）
let tmp = std::env::temp_dir().join(format!("extension-sync-{tool_id}.zip"));

// 新
let tmp = std::env::temp_dir().join(format!("devhub-{tool_id}.zip"));
```

### 5.5 cleaner.rs

```rust
// 旧 — 独立的 run-cleaner 目录
fn config_dir() -> PathBuf {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join("run-cleaner");
    }
    dirs::config_dir().unwrap_or_default().join("run-cleaner")
}

// 新 — 统一目录下的 cleaner 子目录
fn config_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR)
        .join("cleaner")
}
```

### 5.6 syncer.rs

```rust
// 旧
.join("extension-sync-trash")

// 新
.join("devhub-trash")
```

共两处（`move_to_trash` 构造路径 + `purge_old_trash` 读取路径）。

### 5.7 常量定义

在 `settings.rs` 顶部定义常量，供所有模块引用：

```rust
pub const APP_DATA_DIR: &str = "com.xiaoxiaol123456.devhub";
pub const APP_TRASH_DIR: &str = "devhub-trash";
```

其他模块 `use crate::settings::{APP_DATA_DIR, APP_TRASH_DIR};`。

---

## 6. 老用户数据迁移

在 `lib.rs` 的 `setup` 钩子中、`settings::load()` 之前执行迁移：

```rust
fn migrate_old_data() {
    let new_root = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_DATA_DIR);

    // 1. 迁移 extension-sync 目录
    let old_root = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("extension-sync");
    if old_root.exists() {
        let _ = fs::create_dir_all(&new_root);
        // settings.json
        let old_settings = old_root.join("settings.json");
        if old_settings.exists() && !new_root.join("settings.json").exists() {
            let _ = fs::rename(&old_settings, new_root.join("settings.json"));
        }
        // tools 子目录（含 tools.json + <tool_id>\）
        let old_tools = old_root.join("tools");
        if old_tools.exists() && !new_root.join("tools").exists() {
            let _ = fs::rename(&old_tools, new_root.join("tools"));
        }
        // 旧目录已空则删除
        let _ = fs::remove_dir(&old_root);
    }

    // 2. 迁移 run-cleaner 目录
    let old_cleaner = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("run-cleaner");
    if old_cleaner.exists() {
        let new_cleaner = new_root.join("cleaner");
        let _ = fs::create_dir_all(&new_cleaner);
        let old_config = old_cleaner.join("cleaner.config.json");
        if old_config.exists() && !new_cleaner.join("cleaner.config.json").exists() {
            let _ = fs::rename(&old_config, new_cleaner.join("cleaner.config.json"));
        }
        let _ = fs::remove_dir(&old_cleaner);
    }

    // 3. 旧回收站 %TEMP%\extension-sync-trash 不迁移
    //    留在 TEMP 中由 Windows 磁盘清理自动回收
}
```

迁移原则：
- **只搬不丢**：旧目录有、新目录没有的文件才搬，避免覆盖新版本数据。
- **幂等**：迁移过一次后旧目录已空/已删，再次启动不会重复操作。
- **静默**：迁移失败不阻断启动，最坏情况是用户重新配置。

---

## 7. 卸载行为变化

### 7.1 改名前

```
卸载 Extension Sync
  ↓
卸载器删 %APPDATA%\com.dev40.extensionsync\  ← 不存在，白删
代码实际用的 %APPDATA%\extension-sync\       ← 卸载器不知道，残留
                %APPDATA%\run-cleaner\        ← 卸载器不知道，残留
```

### 7.2 改名后

```
卸载 DevHub
  ↓
卸载器删 %APPDATA%\com.xiaoxiaol123456.devhub\  ← 代码实际用的目录，✅ 清干净
（需用户勾选「删除应用数据」复选框）
```

不勾选时只删安装目录（exe、resources），保留用户数据。勾选时连用户数据一起删。

---

## 8. 注意事项

### 8.1 identifier 变更 = 新应用

改 `identifier` 后，Windows 把新旧版本视为**两个不同的应用**：

- 老用户装新版后，控制面板会同时出现「Extension Sync」和「DevHub」两个条目。
- 老条目需手动卸载（或在新版安装时由 NSIS 的 `PageReinstall` 逻辑提示卸载旧版）。
- 建议在发布说明中提醒用户先卸载旧版再装新版。

### 8.2 旧回收站不迁移

`%TEMP%\extension-sync-trash\` 不会迁移到 `%TEMP%\devhub-trash\`。旧回收站留在 TEMP 中，由 Windows 磁盘清理自动回收，不影响使用。

### 8.3 main.rs 不需要改

`main.rs` 中的 `extension_sync_lib::run()` 引用的是 `[lib] name`，该值在 Cargo.toml 中显式写死为 `extension_sync_lib`，改 package name 不影响。

### 8.4 README 需要更新

README.md 中所有 `extension-sync` 和 `Extension Sync` 字样需更新为 `DevHub` / `devhub`。

### 8.5 前端代码中的名称

检查 `src/` 下是否有硬编码的 "Extension Sync" 字样（标题、页头等），需要同步更新。

---

## 9. 改动清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `src-tauri/tauri.conf.json` | `productName` → `DevHub`，`identifier` → `com.xiaoxiaol123456.devhub`，窗口 `title` → `DevHub` |
| 2 | `src-tauri/Cargo.toml` | `name` → `devhub` |
| 3 | `src-tauri/src/settings.rs` | 新增 `APP_DATA_DIR` / `APP_TRASH_DIR` 常量；`settings_path()` 用新目录名 |
| 4 | `src-tauri/src/tools.rs` | `data_root()` 用 `APP_DATA_DIR`；临时文件前缀 `devhub-` |
| 5 | `src-tauri/src/cleaner.rs` | `config_dir()` 指向统一目录下 `cleaner\` 子目录 |
| 6 | `src-tauri/src/syncer.rs` | 回收站路径用 `APP_TRASH_DIR` |
| 7 | `src-tauri/src/lib.rs` | `setup` 中加迁移调用 |
| 8 | `src-tauri/src/main.rs` | 无需改动（lib 名不变） |
| 9 | `README.md` | 名称替换 |
| 10 | 前端 `src/` | 检查并替换硬编码的应用名 |
