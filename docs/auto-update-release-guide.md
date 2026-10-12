# 自动更新发布指南

DevHub 使用 Tauri 2 内置的 updater 插件实现应用自动更新。客户端检查 GitHub Releases 上的 `latest.json`,对比版本后下载签名安装包并验证安装。

## 签名密钥

密钥对已生成,存放在 `src-tauri/tauri.key`(私钥)和 `src-tauri/tauri.key.pub`(公钥)。两个文件均已加入 `.gitignore`,不会提交到仓库。

- **公钥** 已写入 `tauri.conf.json` 的 `plugins.updater.pubkey`,客户端用它验证安装包签名。
- **私钥** 用于构建时签名,**务必保管好**。丢失后无法签发可被客户端接受的更新。

## 发布新版本

### 1. 升版本号

编辑 `src-tauri/tauri.conf.json`,修改 `version` 字段:

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
