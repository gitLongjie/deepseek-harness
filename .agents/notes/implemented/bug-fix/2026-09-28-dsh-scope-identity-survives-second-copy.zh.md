# Agent Note：dsh-scope 的身份标识在同一包的第二份副本下仍然有效

状态：已实现

[English](2026-09-28-dsh-scope-identity-survives-second-copy.md) | 中文

## 问题

`tool-subagent` 的 standing `modelSelectionSettings` 路径在挂载时用 `scopeOf(ctx)` 校验组合作用域。在打包版桌面应用里，凡是 `tool-subagent` 行设了 `modelSelectionSettings: true` 的预设（随包分发的 `standard`、`cordis`、`ptc`）这一检查全部失败：点击这些专家的"新会话"得到 `SessionCreateError … preset "standard" failed to mount: tool-subagent: standing 'modelSelectionSettings' requires a scoped preset Context`，而不带该行的预设都能正常挂载——正是"有些项目"失败的现象。

挂载其实是有作用域的，盲的是**读取方**。`dsh-scope` 把标签符号（`Symbol('dsh.scope')`）和父链/载体状态（`WeakMap`）放在模块私有存储里。出问题的部署在同一进程里物化出两份包副本——安装版应用既解析自己的打包副本，也通过共享的 `~/.dsh/profiles/node_modules` junction 场解析 host 组合的行，而这台机器上的 junction 场混着两个 checkout 的包。`agent-presets` 经一份 `dsh-scope` 副本铸造 standing 作用域，`tool-subagent` 却经另一份副本探测：那份副本的私有符号对不上、`WeakMap` 是空的，什么都看不见。`scopeOf` 于是返回 `undefined`，挂载否决了它自己的组合。

## 决策

身份标识移入进程全局存储，与 vendored Cordis 对 `Context.is` 的处理（`Symbol.for('cordis.is')`）同一药方：

- `kScope` 改为 `Symbol.for('dsh.scope')`，每份副本对同一上下文属性的读写一致。
- 父链与载体两个弱映射移到带命名空间的 `globalThis` 键（`dsh.scope.state`）之下，一份副本的 `bindScopeParent` 对另一份副本的 `scopeChainOf` 保持可读，不变式配套的载体检查跨副本依旧成立。

`Symbol.for` 的全局命名空间在这里可接受：标签不携带用户数据，且字符串以包名命名。`ScopeKey` 对象本身早已与实例无关（经上下文共享的普通对象）。

## 备选方案

**只修部署（治好 junction 场，全部从 asar 解析）。** 否决作为唯一药方：混装副本的解析路径在多种布局里是承重墙（打包宿主配可写 profile、开发环境配 healed 场），junction 场是任何 checkout 都能改写的用户机状态；一个"被加载两次就出错"的库，下一台这么做的机器上还会再错。部署加固仍然值得做，但不能依赖它。

**把 standing 作用域校验从 `tool-subagent` 挪走（信任 `mountPreset` 自己的检查）。** 否决：行级检查捕获的是另一种失败——`mountPreset` 看不到的直接 `apply()` 到无作用域 standing 上下文——移除它会把响亮的加载期拒绝变成静默的进程全局工具注册。

## 后果

- 混装副本的部署能正确组合带作用域的预设：行级 `scopeOf` 探测读得到另一份副本写的标签，`belongsToComposition` 里的 `scopeChainOf` 看得见另一份副本绑定的父链接。
- 两个进程**不**共享身份——状态是每进程全局，不落盘；作用域键依旧局限于进程内。
- 新旧副本并存时，旧副本仍读不到新副本的标签（旧副本用自己的私有符号写入）；修复只有在所有加载副本都重建后（即应用重启加载新产物）才完全生效。

## 测试

`packages/core/scope/tests/scope.spec.ts` 新增跨实例身份用例：模块第二副本（query-string 导入，独立 ESM 记录）必须读到第一副本写的标签、父链接与链，且经第二副本铸造的作用域对第一副本可见。修复前还做了端到端复现——`createScope` 走一份实例、预设行的 `scopeOf` 走另一份，得到与线上完全一致的挂载错误；修复后同一装置在每个实例上都读到 `present`。
