# Agent Note: Desktop 一等公民 Office 创建工具

Status: implemented

[English](2026-11-06-desktop-office-create-tools.md) | 中文

## 问题

Desktop 已具备 Office skills、含 `python-pptx` / `python-docx` / `openpyxl` 的内置 Python 载荷、shell 工具与 `present`。新建 PPTX/DOCX/XLSX 仍依赖模型编写并运行脚本。会话常以「只能写文本文件」拒绝，或编造 `pip install`，用户无法在聊天中零操作拿到 Office 文件。

## 决策

Desktop 与 `load_workspace_dependencies`、Office skills 一并挂载 `@deepseek-ai/dsh-tool-office-create`。Electron shell **进程内**启动 profile，并在 `runDesktopBoot` 之后调用 `mountDesktopOffice`（子进程 `dsh-desktop-host` 仍保留相同插件组合，供 smoke/runtime 路径使用）。模型用结构化 JSON 参数调用 `create_pptx`、`create_docx`、`create_xlsx` **新建**文件。Host 准备同一离线 primary-runtime 并运行固定生成脚本；用户无需安装任何包。创建成功会写入 `deliverables/presented` 交付卡片，Desktop 还会用系统默认应用打开文件（Office 二进制无法用文本 diff 展示）。编辑、渲染、重算与 PDF 导出仍由 Office skills 与普通 shell 执行（[渐进式 Office skills](../architecture/2026-09-27-progressive-office-skills.zh.md)）。

## 考虑过的替代方案

**仅加强提示词可靠性。** 无法去掉模型拒写的脚本化二进制路径。

**单一 `create_office` 工具。** 臃肿 schema 比按格式拆分更难填对。

**在 create 工具内自动 `present`。** 交付仍由 `present` 显式声明并归属 Session。

**第一期挂到普通 Web。** Web 没有 Desktop primary-runtime 载体；SDK 之后可用相同载荷配置复用本包。

## 影响

新增面向模型的工具与 Desktop 组合接线。技能中的新建指引在工具可用时指向 `create_*`。Schema 表达力有上限；复杂幻灯片仍走 skills。第一期不加专用 PDF 创建/导出工具。
