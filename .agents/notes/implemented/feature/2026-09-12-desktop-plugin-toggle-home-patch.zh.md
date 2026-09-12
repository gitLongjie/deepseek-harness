# Agent Note: 桌面端插件开关走家目录补丁层

Status: implemented

[English](2026-09-12-desktop-plugin-toggle-home-patch.md) | 中文

## 问题

桌面外壳已提供插件清单界面，但启用或停用一个插件需要手工编辑 `$DSH_HOME/cordis.patch.yml`——知道文件格式、插件 id，以及应用会在配置 HMR 时重读该文件。设置里的开关需要主进程提供一种读取并翻转那一条 `disabled: true` 行的方式，且不能破坏用户可能手工编辑过的文件。

## 决策

`apps/desktop/src/main/ipc/plugin-toggle.ts` 注册两个 IPC 处理器：`dsh:plugin:isEnabled` 报告家目录补丁中某插件 id 是否带 `disabled: true`，`dsh:plugin:setEnabled` 写入或移除该行。解析器只接受模块自身写出的扁平 `- id:` / `disabled:` 形式（以及序列化的空层 `[]`）；任何无法识别的行都会退回空列表，因此带更丰富补丁行的手工文件会被报告为启用、且绝不会被改写成其他内容。序列化始终输出顶层 YAML 数组——app-boot 补丁加载器拒绝其他形状，而该拒绝会让桌面启动失败。启用时移除整个条目而不是翻转 `disabled: false`，文件因此保持最小。

## 考虑过的替代方案

**设置自有的 JSON 旁车文件。** 否决：家目录补丁层已经是启动时在配置 HMR 中读取的插件组合覆盖面；第二个文件需要自己的加载器，还会与手工补丁漂移。

**原地翻转 `disabled: false`。** 否决：每次重新启用都会永久留下一条无操作行，让最小手工可编辑形式更难辨认。

## 验证

`apps/desktop/tests/plugin-toggle.spec.ts` 在临时家目录下驱动两个处理器：无文件时默认启用、停用序列化为顶层数组、重新启用的空状态序列化为 `[]`、切换一个插件时兄弟条目保留、以及家目录缺失时创建。`pnpm --filter @deepseek-ai/dsh-desktop run test` 通过。

## 后果

这些通道已在主进程生效，但仓库内尚无渲染端消费方——调用它们的设置行单独发布，在此之前这些处理器是惰性的。只有配置 HMR 活跃时切换才会免重启生效；否则下一次启动读取文件。手工编写更丰富家目录补丁的用户会被读取为启用状态，解析器的退回保护其不被改写，代价是开关无法表达那些行。
