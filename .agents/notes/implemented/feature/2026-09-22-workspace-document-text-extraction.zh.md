# Agent Note: Workspace file reads extract office-document text

Status: implemented

English | [中文](2026-09-22-workspace-document-text-extraction.md)

## 问题

Sidebar 预览里的 Office 文档只显示不支持的空态：预览 owner 把 `doc`、`docx`、`odt` 列进「字节永远不可按文本阅读」的后缀清单，因此从不发起读取，而 Host 的文本端点本来也会拒绝这些字节（`FS_NOT_TEXT` / NUL 检查）。同样这些文件对 `workspaceFiles.read` 的任何其他消费方也都是不透明的。

任何基于转换器的修复都有平台编码陷阱。macOS 的 `textutil -convert txt` 不显式给出 `-encoding UTF-8` 时输出带字节顺序标记的 UTF-16；信任默认值的预览会显示重新编码后的乱码。而且 macOS 之外没有 `textutil`，写死单一命令会在 Linux 与 Windows 上大声失败，而不是优雅退化。

## 决策

`workspaceFiles.read` 现在对 `.doc`、`.docx` 与 `.odt` 提取文本，预览端把这三个后缀视为可读，让纯文本兜底像普通文本文件一样分页读取。

转换器在任何进程启动之前显式解析（`src/document-text.ts`）。macOS 上所有受支持后缀都走 `textutil`；其他平台首选 `soffice`，`.docx`/`.odt` 由 `pandoc` 兜底，旧式 `.doc` 由 `catdoc` 兜底。每种风格拥有自己的 argv，编码写进 argv 而不是信任默认值：`textutil -convert txt -encoding UTF-8 -stdout`、`pandoc --to=plain --wrap=none`、`catdoc -d utf-8`，以及 `soffice --headless --convert-to txt:Text --outdir <tmp>` 配合私有的 `-env:UserInstallation` 配置目录，避免持有关默认配置的桌面 LibreOffice 阻塞运行。soffice 写输出文件而非 stdout，因此该风格拥有临时 outdir、期望的 `<stem>.txt` 与其清理。

输出同样不被信任。转换字节用严格（`fatal`）UTF-8 解码器解码并剥掉一个前导字节顺序标记，忽略编码参数的转换器会让读取以 `workspace-file/conversion-failed` 失败，而不是把乱码喂给预览。子进程失败与 soffice 输出文件缺失落在同一代码上；解析不到转换器是独立的 `workspace-file/no-converter`，超过 `maxFileBytes` 的转换文本像任何完整文件读取一样以 `too-large` 失败。取消时重新抛出 abort，不做包装。

预览是懒加载分页，朴素的接法会让每页都重跑一次转换器。转换文本按绝对路径缓存，以页面已携带的 stat `version` 判新，保留最近四个文档；版本变化后重新转换。每个转换器命令都是 Config 字段（`documentText.textutilPath`/`sofficePath`/`pandocPath`/`catdocPath`，另有 `enabled`），因为各主机的安装不同；解析时按 PATH（Windows 上感知 PATHEXT）或指定的绝对文件检查配置命令。internals（平台、可用性、按字节捕获的无 shell 运行器）是构造函数注入的接缝，测试无需安装任何真实转换器即可替换它们。

客户端一侧，三个后缀退出不可预览清单——提取可用之后，它们的字节不再是「永远不可按文本阅读」——两个失败代码在预览的本地化字典中获得专名文案，没有转换器的主机会显示可操作的消息，而不是通用文案。

## 已考虑的替代方案

**在客户端用 JS 解析器转换（mammoth、jszip）。** 每种格式新增一个浏览器依赖，重复平台工具已有的提取质量，而且对同一读取的其他消费方毫无帮助。

**在 `dsh-fs` 后端里提取。** 文本提取不是文件系统的职责；每个后端都要重写一遍，而且线路失败代码与上限属于本服务。

**无缓存、每页转换。** 行为正确，但阅读者翻页时每页都要付出一个子进程的代价。

**信任各工具默认编码、事后重新编码。** 这正是 UTF-16 陷阱：把 textutil 默认输出按 UTF-8 解码得到带 NUL 的乱码。在 argv 里声明编码并校验结果，让两端都诚实。

**连 `.xls`/`.ppt`/iWork 后缀一起覆盖。** 列出的转换器要么无法提取，要么把它们退化成有损的类 CSV 输出；在有转换器支持之前，客户端对这些后缀保持不可预览。

## 后果

对受支持文档的 `read` 返回与任何文本页相同的线路形态的提取文本分页；`absolutePath` 与 `version` 仍指向原始文档，变更观察与重新载入行为不变。没有转换器的主机以命名的、可本地化的代码失败，而不是笼统的 not-text；`documentText.enabled: false` 恢复的正是这个笼统拒绝。提取为每个文件版本付出一次子进程，内存中最多持有四个转换文档，各自以 `maxFileBytes` 封顶。线路新增两条 `RemoteErrorDetailsMap` 条目；端点表面其余部分不动。

## 测试

`packages/api/workspace-files/tests/document-text.spec.ts` 固定：后缀门、按平台解析顺序（macOS 用 textutil；其他平台 soffice 优先、pandoc/catdoc 兜底）、每种风格的 argv（含 textutil 显式 `-encoding UTF-8`）、soffice 的输出文件路径及其缺失失败、对带 BOM 的 UTF-16 输出的严格 UTF-8 拒绝、abort 重抛、跨页按版本只转换一次、两个线路失败代码、转换文本上限、禁用配置回落 not-text、未覆盖后缀直通，以及配置 schema 默认值。`packages/client/ui-sidebar-documentpreview/tests/document-unviewable.client.spec.ts` 把三个后缀移到可读一侧，同时保持表格、演示文稿与 iWork 文档不可预览。
