# Windows 11「通过 DevHub 打开」

## 行为

- 「系统设置 → 资源管理器右键菜单」提供添加、重新注册、移除和状态刷新。
- 使用 `IExplorerCommand` + 带外部位置的 MSIX identity package，在 Windows 11 新版第一层菜单注册，菜单名称为「通过 DevHub 打开」。不会改变系统的文件默认打开方式。
- 对单个文件、文件夹、文件夹空白处显示。多选和没有文件系统路径的虚拟项目不显示。
- 扩展执行 `devhub.exe --open-with-default <完整路径>`，按照应用内“默认打开方式”打开；默认项不可用时，回退到第一个已启用且已配置的打开方式，与应用主打开按钮一致。普通 `devhub.exe <完整路径>` 命令行入口仍在内置工作区打开路径。
- 右键文件时，内置工作区会以单文件模式打开；右键文件夹时，内置工作区会将其作为工作区打开。每次调用启动一个独立 DevHub 进程。
- 支持 Windows 11 x64。文件夹空白处通过 Explorer 提供的 `IFolderView` 取得当前文件夹，不读取进程工作目录。

## 构建和验证

需要 Visual Studio 2022 C++ x64 工具、Windows 11 SDK（MakeAppx / SignTool）及 PowerShell 7（`pwsh.exe`，用于在内存中准备证书）。

```powershell
pnpm build:explorer
node tools/build-explorer.mjs --test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/test-explorer-management.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/test-explorer-paths.ps1
pnpm build
pnpm tauri build
```

Tauri 的开发/发布预构建钩子会生成菜单资源。纯前端 `pnpm build` 不需要 C++ SDK。所有生成物和临时文件均在项目内：

- `src-tauri/target/explorer/`：编译中间文件、测试程序、稀疏包内容。
- `src-tauri/resources/explorer/`：DLL、MSIX 和管理脚本；由 Tauri 原样带入应用资源目录。
- `src-tauri/target/explorer/signing/`：本机测试用 PFX 私钥文件，已通过 `target/` 忽略，不提交、不随应用分发。
- `src-tauri/resources/explorer/DevHub.ContextMenu.cer`：本机测试签名的公开证书，可供管理员核验后信任，不包含私钥。
- 应用的文件布局：`devhub.exe`、`resources/explorer/devhub-explorer.dll`、`resources/explorer/DevHub.ContextMenu.msix`、`resources/explorer/manage.ps1`。

`--test` 检查 Windows 参数解析往返（中文、空格、特殊字符、UNC、末尾反斜杠、盘符根目录）、COM 工厂生命周期、菜单名称和文件/文件夹可见性。测试不会安装菜单、启动 DevHub 或调用真实注册命令。

`test-explorer-management.ps1` 用模拟的 Appx 接口验证只读状态查询、签名包添加、重新注册、移除、重复移除及其他应用包不受影响，并验证未签名、未信任及签名被篡改时在移除旧菜单前拒绝安装；不会调用真实 Windows 注册接口。

`test-explorer-paths.ps1` 用真实 Windows PowerShell 5.1 子进程，以普通路径和 Tauri 返回的 `\\?\` 路径启动脚本，验证带中文、空格和方括号的目录可以查询状态。它只读取 Appx 状态，不注册菜单。`v0.4.3` 修复了这类路径触发 `Join-Path` 的 `drive` 参数为空错误，并在调用 PowerShell 路径及 Appx API 前将本地路径和 UNC 路径转换为兼容格式。

Windows 加载过 DLL 后可能仍持有文件句柄；重建前先移除菜单并关闭正在展示菜单的 Explorer 窗口。必要时注销后再重新构建，不自动终止 Explorer 或 COM 宿主。

## 本机安装与移除

推荐通过应用内按钮操作。也可以对**包含新菜单资源的应用目录**执行：

```powershell
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action install -AppDirectory "<应用目录>"
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action status -AppDirectory "<应用目录>"
powershell.exe -NoProfile -File "<应用目录>\resources\explorer\manage.ps1" -Action uninstall -AppDirectory "<应用目录>"
```

只有 `install` / `uninstall` 会改变当前用户的 `DevHub.ExplorerContextMenu` 包注册。它们不会修改其他软件的菜单、导入证书、开启开发者模式或自动提权。安装先检查包标识、签名和证书信任，通过后才移除当前用户同名旧包并注册；后续 Windows 注册失败时界面重新读取实际状态。

系统可能缓存菜单；注册成功后重新打开菜单，必要时注销再登录。注册状态不等于已经完成真实 Explorer 点击验证。

便携应用移动后需要重新注册。当前安装包不会代替各 Windows 用户移除其独立注册，卸载/删除应用前请先点「移除菜单」。

## 本地测试包与正式签名

原来的未签名包使用 unsigned OID 和 `-AllowUnsigned`。由于清单声明了 EXE / COM DLL 激活，普通用户注册会被 Windows 拒绝，报 `0x80073D2B`；微软要求此类未签名包以管理员权限安装，且不推荐用来分发。`-AllowUnsigned` 不能绕过这个要求。

默认构建现在生成 **本机测试签名包**，移除 unsigned OID，自动使用测试证书的 Subject 作为 Publisher，并用 SignTool 签名。证书生成和构建只写项目文件，不向 Windows 证书存储导入证书，不自动注册菜单。后续构建复用同一 PFX；过期后需自行更新证书。

首次在测试电脑启用前，需要管理员核验并信任公开证书。在**管理员 PowerShell**中手动执行下面的系统修改操作，然后由使用 DevHub 的普通用户通过应用按钮注册：

```powershell
Import-Certificate -FilePath '<项目目录>\src-tauri\resources\explorer\DevHub.ContextMenu.cer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

只导入 `.cer` 公开证书，不向其他电脑分发 PFX。不要将本机测试证书当作正式发行证书。

正式发行使用受目标电脑信任的代码签名证书：

1. 设置 `DEVHUB_EXPLORER_CERTIFICATE` 为 PFX 路径，`DEVHUB_EXPLORER_CERTIFICATE_PASSWORD` 为密码（如有）。构建自动读取 Subject、导出公开证书并签名。
2. 可选的 `DEVHUB_EXPLORER_PUBLISHER` 必须与证书完整 Subject 一致，不能包含 unsigned OID。
3. 如果已在外部完成签名，可设置 `DEVHUB_EXPLORER_SIGNED_PACKAGE` 指向该包；预构建核验签名、包标识和版本后复用，不覆盖签名。
4. 首次从旧未签名包切换时重新注册。安装始终使用 `Add-AppxPackage -ExternalLocation`，不使用 `AllowUnsigned`。签名或信任检查不通过时保留原有注册。

Tauri updater 的 `tauri.key` 是更新包签名密钥，不能用作 Windows MSIX 代码签名证书。

参考：

- [Microsoft：给现有桌面应用增加包标识](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
- [Microsoft：Windows 11 未签名测试包](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)
- [Microsoft：创建包签名证书](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing)
