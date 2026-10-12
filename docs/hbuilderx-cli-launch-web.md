# HBuilderX CLI 与 Web 运行命令说明

来源：

- <https://hx.dcloud.net.cn/cli/README>
- <https://hx.dcloud.net.cn/cli/launch-web>

## 概述

HBuilderX CLI 是 HBuilderX 提供的命令行工具，适用于 HBuilderX 3.1.5 及以上版本。开发者可以通过 CLI 指示 HBuilderX 执行启动、关闭、打包、登录、项目操作、uniCloud 操作等任务。

`launch web` 命令用于将 `uni-app` 或 `uni-app x` 项目运行到 Web 或手机 H5，要求 HBuilderX 5.0 及以上版本。

也可以通过 npm 包使用该能力：

```text
@dcloudio/hbuilderx-cli
```

## CLI 程序位置

| 系统 | CLI 位置 |
| --- | --- |
| Windows | HBuilderX 安装目录根目录下的 `cli.exe` |
| macOS 正式版 | `/Applications/HBuilderX.app/Contents/MacOS/cli` |
| macOS Alpha 版 | `/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli` |
| Linux | HBuilderX 安装目录根目录下的 `cli` |

官方文档示例统一使用 `cli`，Windows 下实际文件名为 `cli.exe`。如果将 CLI 加入环境变量，就可以在任意目录直接调用 `cli`。

## Linux CLI

官方在 2025 年 1 月初推出了 Linux HBuilderX CLI。它面向 Linux 服务器上的命令行调用，可用于自动化打包 App、上传 uniCloud 云函数等场景，适合持续集成、自动化发布、SaaS 类业务自动部署。

注意：Linux CLI 是 CLI 程序，不是 HBuilderX 可视化编辑器。目前官方仅说明在 Ubuntu 系统上进行了测试。

## 常用基础命令

查看帮助文档前需要先启动 HBuilderX。

```shell
cli --help
cli help
```

查看 CLI 版本：

```shell
cli ver
```

启动 HBuilderX：

```shell
cli open
```

关闭 HBuilderX：

```shell
cli app quit
```

## 项目类型与平台支持

CLI 的运行、发行等命令面向 `uni-app` 与 `uni-app x` 项目。

| 项目类型 | 支持的平台 |
| --- | --- |
| uni-app | `app-android` / `app-ios` / `app-harmony` / `web` / `mp-weixin` / `mp-alipay` / `mp-baidu` / `mp-toutiao` / `mp-qq` / `mp-360` / `mp-jd` / `mp-kuaishou` / `mp-lark` / `mp-xhs` / `mp-harmony` |
| uni-app x | `app-android` / `app-ios` / `app-harmony` / `mp-weixin` / `web` |

`launch web` 适用项目为：

- `uni-app`
- `uni-app x` 的 `web` 平台

## launch web

`launch web` 用于运行到 Web 或手机 H5。

查看命令帮助：

```shell
./cli launch web --help
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--help` | 查看 CLI 命令帮助 |
| `--project` | HBuilderX 中已导入的项目名称或项目绝对路径 |
| `--ui` | 切换为界面运行模式。要求 HBuilderX 5.11+。默认纯 CLI 运行；传 `--ui true` 后通过界面启动。取值为 `true` 或 `false`，默认 `false` |
| `--compile` | 编译模式运行，只编译代码。取值为 `true` 或 `false`，默认 `false` |
| `--browser` | 浏览器类型。取值为 `Built`、`Chrome`、`Firefox`、`Ie`、`Edge`、`Safari`，默认 `Built` |
| `--continue-on-error` | 编译错误后继续运行。取值为 `true` 或 `false`，默认 `false` |

### 运行模式

`--ui` 用于切换运行方式：

- 默认：纯 CLI 运行。
- `--ui true`：通过 HBuilderX 界面运行，效果与点击 HBuilderX 工具栏“运行”按钮相同。

该参数要求 HBuilderX 5.11 及以上版本。

### 示例

运行到 Web，使用默认浏览器：

```shell
./cli launch web --project 项目名称
```

通过界面运行：

```shell
./cli launch web --project 项目名称 --ui true
```

指定 Chrome：

```shell
./cli launch web --project 项目名称 --browser Chrome
```

指定 Firefox：

```shell
./cli launch web --project 项目名称 --browser Firefox
```

指定 Edge：

```shell
./cli launch web --project 项目名称 --browser Edge
```

指定 Safari：

```shell
./cli launch web --project 项目名称 --browser Safari
```

指定 IE：

```shell
./cli launch web --project 项目名称 --browser Ie
```

编译模式运行：

```shell
./cli launch web --project 项目名称 --compile true
```

编译错误后继续运行：

```shell
./cli launch web --project 项目名称 --continue-on-error true
```

组合参数：指定 Chrome 并使用编译模式：

```shell
./cli launch web --project 项目名称 --browser Chrome --compile true
```

组合参数：编译模式，并在编译错误后继续运行：

```shell
./cli launch web --project 项目名称 --compile true --continue-on-error true
```

## 通过 npm scripts 使用

在项目中安装 `@dcloudio/hbuilderx-cli` 后，可以通过 npm scripts 调用 HBuilderX CLI 能力。

如果项目根目录没有 `package.json`，先初始化：

```shell
npm init -y
```

安装开发依赖：

```shell
npm install @dcloudio/hbuilderx-cli --save-dev
```

官方文档展示的运行方式：

```shell
# 运行到 Web，使用默认浏览器
npm run launch:web

# 运行到 Web，指定 Chrome
npm run launch:web -- --browser Chrome

# 运行到 Web，编译模式运行
npm run launch:web -- --compile true
```

## 其他 CLI 功能入口

HBuilderX CLI 还包括以下能力：

| 功能 | 说明 |
| --- | --- |
| 用户账号操作 | 登录、退出等 |
| 文件操作 | 打开文件并跳转到指定行列 |
| 项目操作 | 导入、关闭项目 |
| App 打包 | 执行 App 打包 |
| uniCloud 操作 | 云函数上传等 |
| uniCloud 前端网页托管 | 前端网页托管相关操作 |

## 注意事项

- `launch web` 要求 HBuilderX 5.0+。
- `--ui` 要求 HBuilderX 5.11+。
- `--project` 可以传 HBuilderX 中导入的项目名称，也可以传项目绝对路径。
- Windows 下实际 CLI 文件是 `cli.exe`，文档示例中的 `./cli` 需要按本机系统调整。
- 查看帮助文档前，需要先启动 HBuilderX。
