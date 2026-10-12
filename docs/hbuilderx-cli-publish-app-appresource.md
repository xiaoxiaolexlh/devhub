# HBuilderX CLI App 生成本地打包资源命令说明

来源：

- <https://hx.dcloud.net.cn/cli/publish-app-appResource>
- <https://raw.githubusercontent.com/dcloudio/hbuilderx-extension-docs/master/zh-cn/cli/publish-app-appResource.md>

## 概述

`publish appResource` 用于通过 HBuilderX CLI 生成 App 本地打包资源。

该能力适用于：

- `uni-app`
- `uni-app x`
- Wap2App
- 5+App

其中 `uni-app x` 的 App 平台对应 `app-android` 和 `app-ios`。完整平台支持关系可参考 HBuilderX CLI 概述文档。

## 命令

基础命令形式：

```shell
cli publish --platform APP --type appResource --project 项目名称
```

HBuilderX 4.67-alpha 及以上版本开始，`--platform` 支持进一步指定原生平台：

```shell
cli publish app-ios --type appResource --project 项目名称
cli publish app-android --type appResource --project 项目名称
```

## 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--platform` | 是 | 发布平台。通用 App 资源使用 `APP`；HBuilderX 4.67-alpha+ 可使用 `app-ios` 或 `app-android`。 |
| `--type` | 是 | 发布类型。生成本地打包资源时固定为 `appResource`。 |
| `--project` | 是 | 项目名称。结合本工具实现时建议传项目绝对路径，避免同名项目或未导入项目导致歧义。 |

## 示例

生成通用 App 本地打包资源：

```shell
cli publish --platform APP --type appResource --project 项目名称
```

生成 iOS 本地打包资源：

```shell
cli publish app-ios --type appResource --project 项目名称
```

生成 Android 本地打包资源：

```shell
cli publish app-android --type appResource --project 项目名称
```

## 在本工具中的配置建议

发行配置可以独立于运行配置保存，建议字段包括：

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| `platform` | `APP` / `app-ios` / `app-android` | 生成资源的平台。第一版可默认 `APP`，后续再开放 Android/iOS 精确平台。 |
| `type` | `appResource` | 固定值，不需要用户编辑。 |
| `project` | 项目绝对路径 | 与已有 HBuilderX CLI 运行能力保持一致，统一使用项目文件夹全路径。 |

命令预览建议按当前系统解析 CLI 可执行文件：

- Windows：`<cli_dir>\cli.exe`
- macOS / Linux：`<cli_dir>/cli`

最终命令示例：

```shell
cli publish --platform APP --type appResource --project <项目全路径>
```

如果用户选择 HBuilderX 4.67-alpha+ 的细分平台：

```shell
cli publish app-android --type appResource --project <项目全路径>
cli publish app-ios --type appResource --project <项目全路径>
```

## 注意事项

- 该命令生成的是 App 本地打包资源，不是云打包安装包。
- `--type` 需要固定传 `appResource`。
- `--platform APP` 是通用写法；`app-ios`、`app-android` 需要 HBuilderX 4.67-alpha 及以上版本支持。
- 官方示例使用项目名称；本工具若执行命令，建议使用项目绝对路径。
- 执行前仍需要校验 HBuilderX CLI 路径是否存在，并展示 stdout、stderr、退出码和错误信息。
