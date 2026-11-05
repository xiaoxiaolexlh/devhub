# 自动更新发布指南

DevHub 使用 Tauri 2 内置的 updater 插件实现应用自动更新。客户端检查 GitHub Releases 上的 `latest.json`,对比版本后下载签名安装包并验证安装。

## 版本号命名与升级约定

本项目使用三段式发布版本号,名称和升级规则参考[语义化版本（Semantic Versioning / SemVer）2.0.0](https://semver.org/lang/zh-CN/):

```text
主版本号.次版本号.修订号
  Major . Minor . Patch
```

### 三段版本号分别叫什么

以 `1.2.3` 为例:

| 位置 | 正式名称 | 英文 | 通常的升级场景 |
|---|---|---|---|
| 第一段 `1` | 主版本号 | Major | 对公共接口引入不向后兼容的变更 |
| 第二段 `2` | 次版本号 | Minor | 新增功能,并保持向后兼容 |
| 第三段 `3` | 修订号,也称补丁版本号 | Patch | 修复问题,并保持向后兼容 |

因此,“中间那位版本号”的正式名称是**次版本号**。例如 `0.1.0` 中的 `1` 也是次版本号。

### 加一与归零规则

下面三个例子都以 `0.4.9` 为起点,分别表示不同的升级选择,不是连续升级步骤:

| 发布要求 | 计算规则 | 示例 |
|---|---|---|
| 修订号加一 / patch 版本 | 第三段加一,前两段不变 | `0.4.9 → 0.4.10` |
| 次版本号加一 / minor 版本 | 第二段加一,第三段归零 | `0.4.9 → 0.5.0` |
| 主版本号加一 / major 版本 | 第一段加一,后两段归零 | `0.4.9 → 1.0.0` |

每一段都是整数,并非只能是一位数字;修订号到 `9` 后继续增加为 `10`,不会自动进位到次版本号。

项目的 `0.4.9 → 0.5.0` 就是一次**次版本升级**。后续提出“打包发布,次版本号加一”时,含义是读取当前应用版本,增加 Minor 并将 Patch 归零,而不是把版本号固定改为某个示例值。

### `0.x.x` 与 `1.0.0`

严格按 SemVer,`0.x.x` 表示初始开发阶段,公共接口尚不能被认为稳定;`1.0.0` 用于确立稳定的公共接口,之后按接口兼容性决定升级级别。上表中的兼容性规则应结合这一前提理解,不能因为 `0.x.x` 只增加了次版本号,就承诺所有行为都向后兼容。

从 `0.x.x` 进入 `1.0.0` 是确立稳定接口的决定,不应因为修订号或次版本号“用完了”而自动升级。

### 本项目以哪个版本号为准

- **应用对外发布版本**以 `src-tauri/tauri.conf.json` 的 `version` 为准。`tools/release.mjs` 从这里读取版本,用于 Release、安装包名称和 `latest.json`。
- **Git 标签**使用 `v<应用版本>`。例如配置中是 `0.5.0`,对应标签是 `v0.5.0`;配置值本身不加 `v`。
- **内部包版本**:当前 `package.json` 和 `src-tauri/Cargo.toml` 中的 `0.1.0` 是前端包、Rust 包的内部元数据,不是本项目对外发布版本的来源。按现有流程升级应用版本时,不需要同步修改它们,也不要全局替换依赖中的版本号。
- 发布时应核对配置版本、EXE 文件版本、安装包名称、Git 标签、Release 和 `latest.json` 的版本一致。
- **发布脚本不会自动加一**。先按要求修改应用版本并提交,再构建发布;命令中的版本示例要替换成实际目标版本。

## 签名密钥

密钥对已生成,存放在 `src-tauri/tauri.key`(私钥)和 `src-tauri/tauri.key.pub`(公钥)。两个文件均已加入 `.gitignore`,不会提交到仓库。

- **公钥** 已写入 `tauri.conf.json` 的 `plugins.updater.pubkey`,客户端用它验证安装包签名。
- **私钥** 用于构建时签名,**务必保管好**。丢失后无法签发可被客户端接受的更新。

## 发布新版本

### 1. 升版本号

先根据上面的升级约定确定目标版本,再编辑 `src-tauri/tauri.conf.json` 的 `version` 字段。以下流程中的 `0.2.0` 仅为示例,不表示当前版本;实际发布时应统一替换为目标版本:

```json
"version": "0.2.0"
```

### 2. 构建签名安装包

设置环境变量后执行构建:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content src-tauri\tauri.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build
```

构建完成后,产物在 `src-tauri\target\release\bundle\` 下:

| 文件 | 用途 |
|---|---|
| `nsis\DevHub_<ver>_x64-setup.exe` | NSIS 安装包(自动更新用这个) |
| `msi\DevHub_<ver>_x64_en-US.msi` | MSI 安装包(可选) |
| `nsis\latest.json` | 更新清单(包含版本号、下载 URL、签名) |

`latest.json` 示例:

```json
{
  "version": "0.2.0",
  "notes": "更新说明",
  "pub_date": "2026-10-12T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/xiaoxiaolexlh/devhub/releases/download/v0.2.0/DevHub_0.2.0_x64-setup.exe"
    }
  }
}
```

### 3. 创建 GitHub Release

```bash
# 创建 tag
git tag v0.2.0
git push origin v0.2.0

# 创建 release 并上传产物
gh release create v0.2.0 \
  src-tauri/target/release/bundle/nsis/DevHub_0.2.0_x64-setup.exe \
  src-tauri/target/release/bundle/nsis/latest.json \
  --title "v0.2.0" \
  --notes "更新说明"
```

### 4. 客户端更新流程

1. 用户在「设置 → 检查更新」点击按钮
2. 应用请求 `https://github.com/xiaoxiaolexlh/devhub/releases/latest/download/latest.json`
3. 对比版本号,若服务端版本更高则提示更新
4. 用户点击「下载并安装」,应用下载 NSIS 安装包并用公钥验证签名
5. 验证通过后静默安装,安装完成后自动重启应用

## 注意事项

- **首次发布前**:GitHub 上还没有 Release,检查更新会返回「当前已是最新版本」或网络错误。发布第一个 Release 后才能正常工作。
- **版本号**:每次发布必须比上一次高,否则客户端不会提示更新。
- **URL 一致性**:`latest.json` 里的 `url` 必须与实际上传到 Release 的文件名一致。Tauri 构建时自动生成正确的 URL。
- **私钥安全**:不要把 `tauri.key` 提交到 Git。如果用于 CI/CD,将私钥内容存为 GitHub Secret(`TAURI_SIGNING_PRIVATE_KEY`)。

## 一键发版脚本

```bash
node tools/release.mjs               # 构建并发布当前版本
node tools/release.mjs --no-build    # 跳过构建,只发布已有产物
node tools/release.mjs --notes-only  # 只打印本次将写入 Release 的发版说明
```

发版说明每次发版都会重新生成:取上一个 `v*` tag 之后到当前 `HEAD` 的提交,去掉 `fix:`/`feat:` 之类的类型前缀与 `Co-Authored-By` 署名,按提交逐条列出,同时写入 Release 正文和 `latest.json` 的 `notes` 字段。

发版说明的提交范围以当前 `tauri.conf.json` 版本号对应的 tag 为界,所以**升版本号的提交必须包含在本次发版里**,否则说明会漏掉前面的提交。

需要手写说明时:

```bash
node tools/release.mjs --notes "本次修复了 xxx"
node tools/release.mjs --notes-file docs/release-notes-0.4.9.md
```

Release 已存在时,脚本会同步更新发版说明并覆盖上传产物,可用于修正上一次发版的说明。
