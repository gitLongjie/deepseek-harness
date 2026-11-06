---
description: "用于新建 Office 文件的一等公民工具 create_pptx、create_docx 与 create_xlsx。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office-create

[English](README.md) | 中文

## 概述

注册 `create_pptx`、`create_docx` 与 `create_xlsx`，让模型通过内置 primary-runtime 新建 Office Open XML 文件。Desktop 与 Office skills 一并挂载本插件；工具会自动准备离线载荷，从不要求用户安装软件包。

## 使用本包

与 `@deepseek-ai/dsh-tool-workspace-dependencies` 使用相同的 `source` / `root` 载荷配置一并挂载：

```yaml
- name: '@deepseek-ai/dsh-tool-office-create'
  config:
    source: /absolute/primary-runtime
    root: /absolute/dsh-home/dsh-runtimes/dsh-primary-runtime
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `source` | 必填 | 含 `runtime.json` 的 primary-runtime 绝对目录。 |
| `root` | 未设置 | 可选的 Harness-home 安装目录；设置后首次 create 会离线安装。 |

创建成功后，模型应调用 `present` 并传入路径。编辑、渲染、重算与 PDF 导出仍由 Office skills 负责。

## 理解实现

Host 校验结构化参数、解析 Session 工作目录路径、准备 primary-runtime，并以 JSON stdin 运行 `assets/generate_office.py`。失败时删除不完整输出。系统提示引导模型新建文件时优先使用这些工具。

## 模型体验

### 请求上下文与条件

#### 模型可见内容

在注册了 `create_pptx` 时提供三个工具以及一段简短系统提示。生成 schema 见[工具目录](../../../docs/tool-catalog.zh.md)。

#### Token 影响

条件性：工具不在 Agent 作用域时，引导段落为空。

#### KV Cache 影响

工具声明参与该组合的普通工具 schema 缓存键。

## 已知限制与后续工作

- 正式演示走随包提供的 `dashi-ppt` skill。`create_pptx` 只负责纯 Office 文件。编辑已有文件仍走 `office-pptx`。
- PDF 导出仍由 `office-export-pdf` 负责。
- 第一期普通 Web 与共享 base 不挂载这些工具。
