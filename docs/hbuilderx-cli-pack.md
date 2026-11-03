# HBuilderX CLI Android/iOS 云打包命令说明

来源：

- <https://hx.dcloud.net.cn/cli/pack>
- <https://raw.githubusercontent.com/dcloudio/hbuilderx-extension-docs/master/zh-cn/cli/pack.md>

## 概述

`cli pack` 用于通过 HBuilderX CLI 对 uni-app / uni-app x 项目进行 Android/iOS 云打包。

- 需要 HBuilderX 3.1.5 及以上版本。
- **适用项目**：`uni-app`、`uni-app x`（`app-android` / `app-ios`）。
- 打包前必须先启动 HBuilderX：进入 HBuilderX 安装目录，在终端执行 `cli open`。
- 云打包任务在 DCloud 云端排队执行；CLI 只负责提交任务并等待结果。

## 命令

基础命令形式：

```shell
cli pack --help
cli pack --config <配置文件绝对路径>
cli pack --project <项目绝对路径或目录名> --platform android ...
```

发布时可通过 `--config` 使用 JSON 配置文件，也可直接在命令行传参，**两种方式不能混用**。

## 参数

### 通用参数

| 参数 | 说明 |
| --- | --- |
| `--help` | 查看打包 CLI 命令帮助 |
| `--config` | 配置文件的绝对路径，配置项见[配置文件格式](#配置文件格式) |
| `--project` | HBuilderX 中已导入项目的绝对路径或目录名 |
| `--platform` | 打包平台，默认 `android`。可选值：`android`、`ios`；多个平台用英文逗号分隔 |
| `--iscustom` | 是否使用自定义基座，仅值为 `true` 时启用 |
| `--safemode` | 是否使用安心打包，仅值为 `true` 时启用；否则使用传统打包（**仅 uni-app**） |
| `--sourceMap` | 是否生成 SourceMap，默认 `false` |
| `--dsyms` | 是否生成 iOS 符号表（dSYM）文件，仅值为 `true` 时启用（**仅 uni-app，需 HBuilderX 5.14+**） |
| `--isconfusion` | 是否启用代码混淆，仅值为 `true` 时启用（**仅 uni-app**） |
| `--splashads` | 是否启用开屏广告，仅值为 `true` 时启用 |
| `--rpads` | 是否启用悬浮红包广告，仅值为 `true` 时启用（**仅 uni-app**） |
| `--unimpads` | 是否启用激励视频广告，仅值为 `true` 时启用 |
| `--ad.domestic` | 集成国内广告 SDK（需 HBuilderX 5.14+）。可选值：`gdt`、`gm`、`ks`、`bd`、`hw`、`sigmob`、`zy`、`bz`、`fl`、`yt`、`jt`、`wa`；多个用英文逗号分隔 |
| `--ad.international` | 集成海外广告 SDK（需 HBuilderX 5.14+）。可选值：`pg`、`gg`、`unity`、`liftoff`、`inmobi`、`ironsource`、`mintegral`、`applovin`；多个用英文逗号分隔 |
| `--ad.content` | 集成三方内容场景变现 SDK（**仅 uni-app**，需 HBuilderX 5.14+）。可选值：`ks-content`、`gm-content`；多个用英文逗号分隔 |
| `--ignoreWarnings` | 打包遇到 warning 时仅提示、不中断流程，仅值为 `true` 时生效（需 HBuilderX 5.14+） |

### Android 参数

| 参数 | 说明 |
| --- | --- |
| `--android.packagename` | Android 包名，打包 Android 时必填 |
| `--android.androidpacktype` | 证书类型，默认 `0`。`0` 自有证书、`1` 公共证书、`2` 老版证书（**仅 uni-app**）、`3` 云端证书（**仅 uni-app**） |
| `--android.certalias` | 自有证书别名 |
| `--android.certfile` | 自有证书文件路径 |
| `--android.certpassword` | 自有证书密码 |
| `--android.storepassword` | 自有证书库密码 |
| `--android.channels` | 渠道包。可选值：`google`、`yyb`、`360`、`huawei`、`xiaomi`、`oppo`、`vivo`；多个用英文逗号分隔 |
| `--android.antiResignAppid` | 防重签：绑定 appid，仅值为 `true` 时生效（**仅 uni-app，需 HBuilderX 5.14+**） |
| `--android.antiResignPackageName` | 防重签：绑定包名，仅值为 `true` 时生效（**仅 uni-app，需 HBuilderX 5.14+**） |
| `--android.antiResignCertificate` | 防重签：绑定签名，仅值为 `true` 时生效（**仅 uni-app，需 HBuilderX 5.14+**） |

### iOS 参数

| 参数 | 说明 |
| --- | --- |
| `--ios.bundle` | iOS App ID，打包 iOS 时必填 |
| `--ios.supporteddevice` | 支持的设备类型，默认 `iPhone`。可选值：`iPhone`、`iPad`；多个用英文逗号分隔 |
| `--ios.channels` | iOS 渠道。可选值：`phone`、`simulator`；多个用英文逗号分隔（仅 macOS 生效） |
| `--ios.profile` | 自定义证书打包使用的 profile 文件路径 |
| `--ios.certfile` | 自定义证书打包使用的 p12 文件路径 |
| `--ios.certpassword` | 自定义证书打包使用的证书密码 |

> 需要 HBuilderX 5.14+ 的参数：`--dsyms`、`--ad.domestic`、`--ad.international`、`--ad.content`、`--ignoreWarnings`、`--android.antiResignAppid`、`--android.antiResignPackageName`、`--android.antiResignCertificate`。

## 子命令

### pack status

查询 App 云打包状态，需 HBuilderX 5.11+。

```shell
cli pack status --help
cli pack status --project demo-app
cli pack status --project D:/HBuilderProjects/demo-app
```

| 参数 | 说明 |
| --- | --- |
| `--help` | 查看帮助 |
| `--project` | HBuilderX 中已导入项目的绝对路径或目录名 |

### pack cancel

取消 App 云打包任务，需 HBuilderX 5.14+。

```shell
cli pack cancel --help
cli pack cancel --project D:/projects/demo-app --platform app-android
cli pack cancel --project demo-app --platform app-ios
```

| 参数 | 说明 |
| --- | --- |
| `--help` | 查看帮助 |
| `--project` | HBuilderX 中已导入项目的绝对路径或目录名 |
| `--platform` | 要取消的平台，可选值：`app-ios`、`app-android`，一次仅支持一个 |

打包日志可通过 `cli logcat pack` 在另一个终端查看。

## 示例

### 配置文件与命令行

```shell
# 配置文件打包（参数均在 JSON 中，勿与命令行参数混用）
cli pack --config ./configure.json

# 命令行打包：项目目录名
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1

# 命令行打包：项目绝对路径
cli pack --project D:/HBuilderProjects/demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1
```

### Android 证书与打包方式

```shell
# 公共证书（androidpacktype 1）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1

# 自有证书（androidpacktype 0）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 0 --android.certalias myalias --android.certfile /path/to/cert.keystore --android.certpassword 123456 --android.storepassword 123456

# 老版证书（androidpacktype 2，仅 uni-app）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 2

# 云端证书（androidpacktype 3，仅 uni-app）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 3

# 安心打包（safemode，仅 uni-app）
cli pack --project demo-app --platform android --safemode true --android.packagename com.example.app --android.androidpacktype 1

# 自定义基座
cli pack --project demo-app --platform android --iscustom true --android.packagename com.example.app --android.androidpacktype 1
```

### Android 渠道与 SourceMap

```shell
# 多渠道包
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --android.channels google,huawei,xiaomi,oppo,vivo

# 生成 SourceMap
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --sourceMap true
```

### Android 防重签

```shell
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --android.antiResignAppid true
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --android.antiResignPackageName true
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --android.antiResignCertificate true
```

### iOS 证书与打包方式

```shell
# 自定义证书打包
cli pack --project demo-app --platform ios --ios.bundle com.example.app --ios.supporteddevice iPhone,iPad --ios.profile /path/to/profile.mobileprovision --ios.certfile /path/to/cert.p12 --ios.certpassword 123456

# 生成 SourceMap
cli pack --project demo-app --platform ios --ios.bundle com.example.app --sourceMap true --ios.profile /path/to/profile.mobileprovision --ios.certfile /path/to/cert.p12 --ios.certpassword 123456

# 生成 dSYM（仅 uni-app，需 HBuilderX 5.14+）
cli pack --project demo-app --platform ios --ios.bundle com.example.app --dsyms true --ios.profile /path/to/profile.mobileprovision --ios.certfile /path/to/cert.p12 --ios.certpassword 123456

# 模拟器渠道（仅 macOS）
cli pack --project demo-app --platform ios --ios.bundle com.example.app --ios.channels simulator --ios.profile /path/to/profile.mobileprovision --ios.certfile /path/to/cert.p12 --ios.certpassword 123456
```

### 广告与变现

```shell
# 开屏 + 激励视频 + 悬浮红包（rpads 仅 uni-app）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --splashads true --unimpads true --rpads true

# 国内广告 SDK
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --ad.domestic gdt,ks,bd

# 海外广告 SDK
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --ad.international gg,unity,applovin

# 内容变现 SDK（仅 uni-app）
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1 --ad.content ks-content
```

> iOS 使用广告参数时，还需要同时提供 `--ios.profile`、`--ios.certfile`、`--ios.certpassword`。

### CI 自动化

```shell
cli open
cli pack --project demo-app --platform android --android.packagename com.example.app --android.androidpacktype 1
cli logcat pack                              # 另开终端查看打包日志
cli pack status --project demo-app           # 查询状态
cli pack cancel --project demo-app --platform app-android  # 取消任务
```

## 配置文件格式

配置文件为 UTF-8 编码的 JSON，字段与命令行参数一一对应；使用 `--config` 时所有参数都写在 JSON 中，不要与 `--project`、`--platform` 等命令行参数混用。

```json
{
  "project": "test-pack",
  "platform": "ios,android",
  "iscustom": false,
  "safemode": false,
  "sourceMap": false,
  "dsyms": false,
  "isconfusion": false,
  "splashads": false,
  "rpads": false,
  "unimpads": false,
  "ad": {
    "domestic": "",
    "international": "",
    "content": ""
  },
  "ignoreWarnings": false,
  "android": {
    "packagename": "com.test.android",
    "androidpacktype": "1",
    "certalias": "",
    "certfile": "",
    "certpassword": "",
    "storePassword": "",
    "channels": "",
    "antiResignAppid": false,
    "antiResignPackageName": false,
    "antiResignCertificate": false
  },
  "ios": {
    "bundle": "com.test.ios",
    "supporteddevice": "iPhone,iPad",
    "channels": "",
    "profile": "",
    "certfile": "",
    "certpassword": ""
  }
}
```

```shell
cli pack --config ./configure.json
```

> 命令行参数是 `--android.storepassword`，JSON 字段是 `storePassword`（驼峰）；`androidpacktype` 在 JSON 中写作字符串（如 `"1"`）。

## 在本工具中的实现

「HBuilderX CLI → 发行 → Android/iOS 云打包」已接入，命令通过 `HBuilderXPublishCloudPackConfig` 保存，字段与命令参数对应：

| 字段 | 说明 |
| --- | --- |
| `platform` | 对应 `--platform`，默认 `android`；`android` / `ios` / `android,ios`。 |
| `iscustom` | 对应 `--iscustom`，仅 `true` 时追加。 |
| `safemode` | 对应 `--safemode`，仅 `true` 时追加（uni-app）。 |
| `source_map` | 对应 `--sourceMap`，默认 `false`。 |
| `dsyms` | 对应 `--dsyms`（uni-app，5.14+）。 |
| `isconfusion` | 对应 `--isconfusion`（uni-app）。 |
| `splashads` / `rpads` / `unimpads` | 对应三个广告开关。 |
| `ad_domestic` / `ad_international` / `ad_content` | 逗号分隔的 SDK 值，对应 `--ad.domestic` / `--ad.international` / `--ad.content`，留空不追加。 |
| `ignore_warnings` | 对应 `--ignoreWarnings`（5.14+）。 |
| `android.packagename` | Android 必填。 |
| `android.androidpacktype` | 对应 `--android.androidpacktype`，本工具默认 `1`（公共证书）；`0` 自有证书、`2` 老版证书（uni-app）、`3` 云端证书（uni-app）。 |
| `android.certalias` / `certfile` / `certpassword` / `storepassword` | 自有证书（`androidpacktype` 为 `0`）时填写。 |
| `android.channels` | 对应 `--android.channels`，留空不追加。 |
| `android.anti_resign_appid` / `anti_resign_package_name` / `anti_resign_certificate` | 防重签三开关（uni-app，5.14+）。 |
| `ios.bundle` | iOS 必填。 |
| `ios.supporteddevice` | 默认 `iPhone`；可选 `iPad`、`iPhone,iPad`。 |
| `ios.channels` | `phone` / `simulator`，模拟器渠道仅 macOS 生效。 |
| `ios.profile` / `certfile` / `certpassword` | iOS 自定义证书打包时填写，三项需同时填写。 |

生成命令时：

- `--platform`、`--project` 固定生成；`--project` 统一使用项目文件夹绝对路径，避免同名项目或未导入项目产生歧义。
- 布尔开关仅在值为 `true` 时追加 `--xxx true`，与 Web / App 本地打包资源 / 支付宝小程序实现保持一致。
- Android 仅在平台包含 `android` 时校验 `packagename`；iOS 仅在平台包含 `ios` 时校验 `bundle`。
- `androidpacktype` 为 `0` 时要求别名、证书文件、证书密码、证书库密码齐全，且证书文件必须存在；iOS 自定义证书要求 `profile`、`certfile` 同时填写且文件存在。
- 证书密码保存在本机 `%APPDATA%\com.xiaoxiaol123456.devhub\settings.json`，为明文，请仅在可信本机使用。
- 命令预览中的证书密码显示为 `******`；执行和复制命令时保留真实密码及首尾空格，因此复制出的完整命令含有密码。
- 发行任务状态和输出保留在应用内存中，切换到其他功能页后返回可继续查看；结果按项目和发行类型隔离，同一项目正在发行时不能重复提交。

最终命令示例：

```shell
cli pack --project <项目全路径> --platform android --android.packagename <包名> --android.androidpacktype 1
cli pack --project <项目全路径> --platform ios --ios.bundle <App ID> --ios.supporteddevice iPhone --ios.profile <profile 路径> --ios.certfile <p12 路径> --ios.certpassword <密码>
```

实现入口：

| 位置 | 说明 |
| --- | --- |
| `src/components/HBuilderXCliPage.tsx` | 发行页签「Android/iOS 云打包」卡片 `ProjectPublishCloudPackCard` 与参数表单 |
| `src/stores/hbuilderxPublish.ts` | 跨页面保留发行任务，按项目和发行类型隔离状态与结果，并阻止同一项目重复提交 |
| `src/lib/hbuilderxCloudPack.ts` | 云打包默认参数与隐藏证书密码的命令预览 |
| `src/lib/tauri.ts` | `HBuilderXPublishCloudPackConfig`、`previewHBuilderXPublishCloudPack` / `runHBuilderXPublishCloudPack` |
| `src-tauri/src/commands.rs` | `preview_hbuilderx_publish_cloud_pack` / `run_hbuilderx_publish_cloud_pack`、`build_hbuilderx_publish_cloud_pack_command` |
| `src-tauri/src/settings.rs` | `HBuilderXPublishCloudPackConfig` 及 `HBuilderXCloudPackAndroidConfig` / `HBuilderXCloudPackIosConfig` |

当前未实现 `pack status` / `pack cancel`；打包任务由 CLI 阻塞等待云端结果，成功后界面直接展示下载地址或产物路径。

## 注意事项

- 打包前必须先启动 HBuilderX（安装目录执行 `cli open`），否则 CLI 无法连接。
- `--config` 与命令行参数不能混用。
- 打包出错会输出错误信息并中断；`--ignoreWarnings true` 只让 warning 不中断（5.14+）。
- 传统打包成功后输出的是**临时下载地址，只能下载 5 次**；安心打包（`--safemode`）输出打包成功后的本地路径。
- `safemode`、`isconfusion`、`rpads`、`ad.content`、`dsyms`、`androidpacktype` 的 `2`/`3`、三个 `antiResign*` 仅适用于 uni-app；uni-app x 不可用。
- `sourceMap`、`dsyms` 会额外生成产物文件，需要在打包结果中一并下载或保存。
- `--platform` 支持逗号分隔多平台，一次提交会同时产生 Android 和 iOS 两个打包任务。
- `--ios.channels simulator`（模拟器渠道）仅 macOS 生效。
- 官方示例使用项目目录名；本工具执行时应使用项目绝对路径。
- 执行前校验 HBuilderX CLI 路径、证书/密钥文件是否存在，并展示 stdout、stderr、退出码和错误信息。
- `manifest.json` 可能带注释，若打包前需要脚本修改它，可用 `strip-json-comments`（JS）或 `commentjson`（Python）读取。
