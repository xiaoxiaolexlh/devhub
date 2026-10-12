# 通用文件夹复制功能计划

## Summary

- 新增一个通用复制功能：用户指定“源文件夹”和“目标文件夹”，开启后可将源文件夹中的内容复制到目标文件夹。
- 第一版支持手动执行复制；后续可接入特定流程的自动触发，例如生成 `hbuilderx-cli-publish-app-appresource.md` 后自动复制到另一个文档目录。
- 该功能独立于 HBuilderX CLI，但可以被 HBuilderX CLI 文档生成、发行资源生成等流程复用。

## Use Case

典型场景：

1. 当前工具在本仓库生成文档，例如：

```text
docs/hbuilderx-cli-publish-app-appresource.md
```

2. 用户开启通用复制功能，并配置：

```text
源文件夹：D:\40\extension-sync\docs
目标文件夹：D:\somewhere\external-docs
```

3. 执行复制后，目标文件夹中得到对应文档：

```text
D:\somewhere\external-docs\hbuilderx-cli-publish-app-appresource.md
```

## Key Changes

- 新增应用能力：
  - 在设置页或独立工具页增加“通用复制”配置区。
  - 用户可以新增多个复制任务。
  - 每个复制任务包含启用状态、源文件夹、目标文件夹、复制范围和覆盖策略。

- 设置与数据结构：
  - `Settings` 增加 `copy_tasks`。
  - 每个复制任务包含：
    - `id`
    - `name`
    - `enabled`
    - `source_dir`
    - `target_dir`
    - `include_patterns`
    - `exclude_patterns`
    - `overwrite_strategy`
    - `last_run_at`
    - `last_result`

- 复制执行：
  - 源路径必须是已存在的文件夹。
  - 目标路径必须是文件夹；如果不存在，第一版建议提示用户确认后创建。
  - 默认按源文件夹内部相对路径复制到目标文件夹。
  - 默认不复制隐藏的大型构建目录，例如 `.git`、`node_modules`、`dist`、`target`。
  - 复制完成后展示成功数量、跳过数量、失败数量和失败原因。

- 触发方式：
  - 第一版：用户手动点击“执行复制”。
  - 后续：支持流程触发，例如“生成文档后复制”。
  - 自动触发必须显式开启，避免用户无感知地写入目标目录。

## Copy Modes

第一版建议只实现“覆盖复制”和“跳过已存在”两种策略：

| 策略 | 行为 |
| --- | --- |
| `overwrite` | 目标文件已存在时直接覆盖。 |
| `skip_existing` | 目标文件已存在时跳过。 |

后续可以扩展：

| 策略 | 行为 |
| --- | --- |
| `backup_then_overwrite` | 覆盖前将目标文件备份到回收目录。 |
| `mirror` | 让目标文件夹与源文件夹保持一致，会删除目标中源文件夹不存在的文件；该模式风险较高，第一版不建议实现。 |

## Include / Exclude

复制范围建议使用 glob 规则：

```json
{
  "include_patterns": ["*.md"],
  "exclude_patterns": [".git/**", "node_modules/**", "dist/**", "target/**"]
}
```

如果用户不配置 `include_patterns`，默认复制源文件夹下所有普通文件。

如果用户不配置 `exclude_patterns`，仍建议保留安全默认排除项：

```text
.git/**
node_modules/**
dist/**
target/**
```

## UI 建议

- 复制任务列表：
  - 显示任务名称、启用状态、源文件夹、目标文件夹、最近一次执行结果。
  - 提供“执行复制”“编辑”“删除”“打开源文件夹”“打开目标文件夹”按钮。

- 任务编辑：
  - 源文件夹输入框 + 选择按钮。
  - 目标文件夹输入框 + 选择按钮。
  - 启用开关。
  - 覆盖策略选择。
  - 可选的 include/exclude 文本框。

- 执行结果：
  - 成功：展示复制文件数。
  - 部分失败：展示失败文件列表和原因。
  - 失败：展示路径校验错误或权限错误。

## Backend Commands

建议新增 Tauri 命令：

| 命令 | 说明 |
| --- | --- |
| `preview_copy_task` | 预览将复制哪些文件，以及目标文件是否会覆盖。 |
| `run_copy_task` | 执行复制任务。 |
| `validate_copy_task` | 校验源/目标路径、规则和覆盖策略。 |

执行复制时返回结构：

```json
{
  "success": true,
  "copied": 3,
  "skipped": 1,
  "failed": 0,
  "items": [
    {
      "source": "D:\\40\\extension-sync\\docs\\hbuilderx-cli-publish-app-appresource.md",
      "target": "D:\\somewhere\\external-docs\\hbuilderx-cli-publish-app-appresource.md",
      "status": "copied"
    }
  ]
}
```

## 与文档生成流程的关系

文档生成流程不应该直接写死目标目录。

推荐做法：

1. 文档生成只负责把文件写入当前项目的 `docs` 目录。
2. 通用复制任务负责把 `docs` 目录中的目标文件复制到用户配置的外部目录。
3. 如果用户开启“生成后自动复制”，生成流程完成后调用对应复制任务。
4. 如果复制失败，不回滚已生成的文档，只提示复制失败原因。

## Test Plan

- 运行 `pnpm build` 做前端类型检查和构建验证。
- 运行 `cargo check` 验证 Tauri 后端编译。
- 手动验证：
  - 未配置源文件夹时不能执行，并提示原因。
  - 源文件夹不存在时不能执行。
  - 目标文件夹不存在时按设计提示创建或阻止执行。
  - 可将 `docs/*.md` 复制到另一个文件夹。
  - `skip_existing` 不覆盖已有文件。
  - `overwrite` 会覆盖已有文件。
  - 默认不会复制 `.git`、`node_modules`、`dist`、`target`。
  - 部分文件复制失败时，其余文件不受影响，并展示失败列表。
  - 生成文档后自动复制开启时，生成完成后能触发复制。

## Assumptions

- 第一版只做本机文件系统复制，不处理远程路径、网络盘同步或压缩包。
- 第一版不做镜像删除，避免误删目标目录中的用户文件。
- 自动复制必须由用户显式开启。
- 用户配置的目标目录可能在当前项目外部，实际应用执行时应通过用户选择目录来获得明确授权。
