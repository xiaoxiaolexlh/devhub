# Windows 11「通过 DevHub 打开」

## 行为

- 「系统设置 → 资源管理器右键菜单」提供添加、重新注册、移除和状态刷新。
- 使用 `IExplorerCommand` + 带外部位置的 MSIX identity package，在 Windows 11 新版第一层菜单注册，菜单名称为「通过 DevHub 打开」。不会改变系统的文件默认打开方式。
- 对单个文件、文件夹、文件夹空白处显示。多选和没有文件系统路径的虚拟项目不显示。
- 扩展直接执行 `devhub.exe <完整路径>`，复用 `commands::open_path_window`。文件以单文件模式打开，文件夹以工作区模式打开。每次调用启动一个独立 DevHub 进程，与原有命令行入口一致。
- 支持 Windows 11 x64。文件夹空白处通过 Explorer 提供的 `IFolderView` 取得当前文件夹，不读取进程工作目录。

## 构建和验证

需要 Visual Studio 2022 C++ x64 工具及 Windows 11 SDK（MakeAppx）。

```powershell
pnpm build:explorer
node tools/build-explorer.mjs --test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/test-explorer-management.ps1
pnpm build
pnpm tauri build
```

Tauri 的开发/发布预构建钩子会生成菜单资源。纯前端 `pnpm build` 不需要 C++ SDK。所有生成物和临时文件均在项目内：

- `src-tauri/target/explorer/`：编译中间文件、测试程序、稀疏包内容。
- `src-tauri/resources/explorer/`：DLL、MSIX 和管理脚本；由 Tauri 原样带入应用资源目录。
- 应用的文件布局：`devhub.exe`、`resources/explorer/devhub-explorer.dll`、`resources/explorer/DevHub.ContextMenu.msix`、`resources/explorer/manage.ps1`。

`--test` 检查 Windows 参数解析往返（中文、空格、特殊字符、UNC、末尾反斜杠、盘符根目录）、COM 工厂生命周期、菜单名称和文件/文件夹可见性。测试不会安装菜单、启动 DevHub 或调用真实注册命令。

`test-explorer-management.ps1` 用模拟的 Appx 接口验证只读状态查询、添加、重新注册、移除、重复移除及其他应用包不受影响；不会调用真实 Windows 注册接口。

Windows 加载过 DLL 后可能仍持有文件句柄；重建前先移除菜单并关闭正在展示菜单的 Explorer 窗口。必要时注销后再重新构建，不自动终止 Explorer 或 COM 宿主。

## 本机安装与移除

推荐通过应用内按钮操作。也可以对**包含新菜单资源的应用目录**执行：

```powershell
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action install -AppDirectory "<应用目录>"
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action status -AppDirectory "<应用目录>"
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action uninstall -AppDirectory "<应用目录>"
```

只有 `install` / `uninstall` 会改变当前用户的 `DevHub.ExplorerContextMenu` 包注册。它们不会修改其他软件的菜单、导入证书、开启开发者模式或自动提权。重新注册先移除当前用户同名旧包；失败时界面重新读取实际状态，不把已移除的旧包显示为仍然启用。

系统可能缓存菜单；注册成功后重新打开菜单，必要时注销再登录。注册状态不等于已经完成真实 Explorer 点击验证。

便携应用移动后需要重新注册。当前安装包不会代替各 Windows 用户移除其独立注册，卸载/删除应用前请先点「移除菜单」。

## 本地测试包与正式签名

默认生成的是 **Windows 11 未签名菜单包**，Publisher 包含 Microsoft 指定的 unsigned OID，管理脚本使用 `Add-AppxPackage -AllowUnsigned -ExternalLocation`。系统策略或权限不允许时会显示 Windows 原始错误，不会自动改动安全策略。`v0.4.2` 暂按此方式发布，由用户在系统设置中手动启用；不同电脑上的注册兼容性尚待验证。

后续要采用受目标电脑信任的 Windows 代码签名证书，可按以下步骤接入：

1. 设置 `DEVHUB_EXPLORER_PUBLISHER` 为签名证书的完整 Subject（不含 unsigned OID）。
2. 生成组件，并用 Windows SDK SignTool 对 `src-tauri/resources/explorer/DevHub.ContextMenu.msix` 签名。
3. 在最终打包前完成签名。可通过 `DEVHUB_EXPLORER_SIGNED_PACKAGE` 指向该签名包，使预构建步骤复用它，而不是覆盖签名。
4. 正式签名包注册时不使用 `AllowUnsigned`。首次从测试包切换到签名包时需重新注册。

Tauri updater 的 `tauri.key` 是更新包签名密钥，不能用作 Windows MSIX 代码签名证书。

参考：

- [Microsoft：给现有桌面应用增加包标识](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
- [Microsoft：Windows 11 未签名测试包](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)
