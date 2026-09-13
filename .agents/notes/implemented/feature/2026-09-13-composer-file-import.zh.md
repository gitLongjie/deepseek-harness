# Agent Note: Composer 文件导入以工作区 mention 落地

Status: implemented

[English](2026-09-13-composer-file-import.md) | 中文

## 问题

常驻输入框此前只接受图片。“+”按钮只打开指令菜单，文档级拖拽覆盖层也只邀请图片，拖入的非图片文件只会得到图片接收管的格式拒绝（“仅支持 PNG、JPG、WebP、GIF”）。用户无法从对话界面把 PDF、表格或文本文件交给 agent。`@` 文件引用管线本已让模型能读取工作区文件，但没有任何入口能把外部文件带进这条管线。

## 决策

输入框的“+”启动器现在打开一个菜单，包含指令入口与添加文件入口（后者仅在会话具备文件导入 Remote 时出现），由隐藏的多选文件选择器支撑。文档级拖拽覆盖层与粘贴路径接受任意文件批次，输入框按 MIME 边界分流：图片继续走既有草稿图片栏，其余文件导入会话工作区，并经与 `@` 菜单相同的引用管线插入 `@` mention 芯片。

导入能力挂在 file-reference seam 上：`FileReferenceService.import(agent, { name, data }, signal)` 存储一个外部来源的文件（线上为规范 base64），返回存储副本的工作区相对正斜杠路径。本地提供方写入工作区的 `importsDirectory`（默认 `uploads`，`maxImportBytes` 默认 25 MiB，均为插件配置），把名称清洗为裸文件名（拒绝路径分隔符与非法字符，Windows 保留设备名加前缀），用独占创建写直接探测文件系统——碰撞或并发导入依次得到 `-1`、`-2`… 后缀而绝不覆盖——调用方中止时清除半写副本，并使该 agent 的搜索缓存失效。Session Controller 把该动词暴露为生成的 `fileReferences/import` Remote；客户端的 `ConversationController.importFiles` 按 scope 寻址：逐文件给出结果，一个文件被拒不会吞掉其他文件的存储路径。

客户端用 `formatFileMention` 渲染导入路径（含空白的路径加引号），经 `shell.insertReference` 插入，因此提交序列化出与 `@` 菜单完全相同的 `@path` / `@"path with spaces"` 文本，作为普通提示词文本完整落日志，模型用既有文件系统工具读取文件。消息内容结构、会话事件、附件格式均未改变。

## 测试

`file-reference-local` 规格覆盖导入准入（规范 base64、大小上限、名称清洗、碰撞后缀、中止清理、配置校验），`file-reference` 固定抽象对；Session Controller adapter 规格断言委派。客户端侧，input-bar 规格覆盖启动器菜单、能力门控、MIME 分流与失败 toast；apply file-import 规格端到端驱动真实装配（芯片插入、带引号 mention、本地化失败、Remote 缺失行为）；orchestration 规格覆盖逐文件独立与 scope 寻址；ui-attachment 与 fixture 规格跟随更名的 `onAddFiles` 契约。

## 考虑过的替代方案

**像图片一样把文件挂到消息上。** 否决：durable 附件路径与所有 provider 请求编码器都是图片专属（归一化、EXIF 方向、像素上限），线上也没有文档 content block——为了模型本可用既有文件系统工具读到的内容，要在每个 provider 上新造一套请求词汇。

**原地引用拖入的文件。** 否决：浏览器 `File` 在 web 目标上没有稳定路径；绝对本地路径会把宿主目录布局泄进提示词，并破坏工作区沙箱假设；且原位置文件一移动，mention 就失效，无法随会话工作区迁移。

**把“+”的弹出项扩展进指令菜单系统。** 否决：指令菜单是带自有选中语法的 trigger-source 弹层；把非指令入口嫁接进去会让文件功能与触发器管线耦合。同一个按钮上叠加独立 `Menu`，两个入口都一次点击可达，且无需那种耦合。

## 后果

用户可以从输入框交给 agent 任意文件，导入副本就在 agent 本来就读的工作区里——可见、可被工具寻址、受 mention 语法的提示词指引覆盖。代价：导入字节会存两份（工作区副本与用户手中原件），接收导入的工作区会出现 `uploads/` 目录，25 MiB 默认上限约束了单条消息的携带量——需求更重的部署可调高 `maxImportBytes`。
