# HBuilderX CLI 发行支付宝小程序命令说明

来源：

- <https://hx.dcloud.net.cn/cli/publish-mp-alipay>
- <https://raw.githubusercontent.com/dcloudio/hbuilderx-extension-docs/master/zh-cn/cli/publish-mp-alipay.md>

## 概述

`publish` 配合 `--platform mp-alipay` 用于通过 HBuilderX CLI 发行支付宝小程序。

- HBuilderX 3.8.5-alpha 起支持使用 CLI 发行支付宝小程序。
- 通过该方式，可在命令行或其它 CI 工具中完成支付宝小程序代码的编译、上传、预览等操作。
- **适用项目**：仅 `uni-app`（`mp-alipay`），不支持 `uni-app x`。完整平台对照见 [CLI 概述](https://hx.dcloud.net.cn/cli/README?id=project-platform)。

## 命令

基础命令形式：

```shell
cli publish --platform mp-alipay --project 项目名称
```

编译并上传到支付宝平台：

```shell
cli publish --platform mp-alipay --project 项目名称 --upload true --appid 小程序appid --description 发布描述 --version 发布版本 --privatekey 支付宝开发工具密钥文件
```

## 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--platform` | 是 | 发行平台，固定为 `MP-ALIPAY`（示例中写作 `mp-alipay`）。 |
| `--project` | 是 | 项目名称。结合本工具实现时建议传项目绝对路径，避免同名项目或未导入项目导致歧义。 |
| `--appid` | 是 | 支付宝小程序 appid。 |
| `--subPackage` | 否 | 发行为混合包，示例：`--subPackage xxx`。 |
| `--upload` | 否 | 打包后是否上传到支付宝平台，**只有值为 `true` 时生效**。 |
| `--description` | 否 | 上传的小程序描述。 |
| `--privatekey` | 否 | 支付宝开发工具密钥文件路径。 |
| `--version` | 否 | 上传小程序的版本号。不填则读取 `manifest.json` 中的版本号。 |

## 示例

仅编译 `uni-app` 项目到支付宝小程序：

```shell
cli publish --platform mp-alipay --project 项目名称
```

编译并上传发行小程序到支付宝平台：

```shell
cli publish --platform mp-alipay --project 项目名称 --upload true --appid 小程序appid --description 发布描述 --version 发布版本 --privatekey 支付宝开发工具密钥文件
```

发行为混合包：

```shell
cli publish --platform mp-alipay --project 项目名称 --subPackage xxx
```

## 支付宝开发工具密钥文件

HBuilderX 3.8.5+ 起，`uni-app` 发行到支付宝小程序时支持自动上传代码到支付宝平台，无需再通过支付宝开发者工具上传发行。

原理：通过支付宝小程序 CLI，使用支付宝开发工具密钥上传代码，无需打开支付宝开发者工具，一键完成代码上传。

获取方式：

1. 打开支付宝开放平台「开发工具密钥」页面：<https://open.alipay.com/develop/manage/tool-key>，扫码登录。
2. 左侧菜单进入【开发工具密钥】，点击生成身份密钥。
3. 下载开发工具密钥文件，作为 `--privatekey` 参数传入。

## 在本工具中的配置建议

发行配置可以独立于运行配置保存，实际实现为 `HBuilderXPublishMpAlipayConfig`，字段如下：

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| `appid` | 支付宝小程序 appid | 上传时必填，对应 `--appid`。 |
| `upload` | `true` / `false` | 对应 `--upload`，仅在为 `true` 时追加该参数。 |
| `description` | 文本 | 对应 `--description`，留空则不追加。 |
| `version` | 文本 | 对应 `--version`，留空则回退到 `manifest.json` 的版本号。 |
| `privatekey` | 密钥文件绝对路径 | 对应 `--privatekey`，上传时必填且要求文件存在。 |
| `sub_package` | 文本 | 对应 `--subPackage`，留空则不追加。 |

`--platform mp-alipay` 与 `--project` 固定生成，不需要用户配置。

命令预览建议按当前系统解析 CLI 可执行文件：

- Windows：`<cli_dir>\cli.exe`
- macOS / Linux：`<cli_dir>/cli`

最终命令示例：

```shell
cli publish --platform mp-alipay --project <项目全路径>
cli publish --platform mp-alipay --project <项目全路径> --upload true --appid <appid> --description <描述> --version <版本号> --privatekey <密钥文件全路径>
```

实现入口：

| 位置 | 说明 |
| --- | --- |
| `src/components/HBuilderXCliPage.tsx` | 发行页签「uni-app 发行 - 支付宝小程序」卡片 |
| `src-tauri/src/commands.rs` | `preview_hbuilderx_publish_mp_alipay` / `run_hbuilderx_publish_mp_alipay` |
| `src-tauri/src/settings.rs` | `HBuilderXPublishMpAlipayConfig` |

## 注意事项

- 仅支持 `uni-app` 项目的 `mp-alipay` 平台，`uni-app x` 不适用。
- `--upload` 只有值为 `true` 时才生效，传其他值等于不上传。
- 上传到支付宝平台时必须同时提供 `--appid` 和 `--privatekey`，否则上传会失败。
- 不填 `--version` 时读取 `manifest.json` 中的版本号，容易出现版本号与预期不一致，建议显式传入。
- 官方示例使用项目名称；本工具若执行命令，建议使用项目绝对路径。
- 执行前仍需要校验 HBuilderX CLI 路径和密钥文件是否存在，并展示 stdout、stderr、退出码和错误信息。
