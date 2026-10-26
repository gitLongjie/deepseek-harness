# Agent Note: 桌面 dev 也参与共享模块回退 farm 的维护

Status: implemented

[English](2026-09-29-desktop-dev-heals-shared-module-fallback.md) | 中文

## Problem

本地自建的专家预设（`~/.dsh/.agent-presets/<id>/`）引用了 checkout 刚新增的包时，桌面端所有界面都报"N rows name plugins that cannot be resolved"——专家市场的聘用按钮被禁用，模式选择器排除该行——而同一预设在新打的包和 `dsh` CLI 下扫描都是健康的。对用户的陷阱在于：修复手段（把包加进 `apps/desktop` 依赖）早已就位，而任何日志里都没有指向真实原因的一行，因为 roster 健康检查从不写日志。

桌面 dev 启动器（品牌化的 `深度Work-dev.exe`）与安装版运行同一份编译后的 main，于是 `app.isPackaged` 为 true，`runDesktopBoot` 收到指向 checkout 的 `bareModuleBaseUrl`。heal 门把 `options.bareModuleBaseUrl === undefined` 当作"开放运行时"的判据，跳过了 `healProfilesModuleFallback`——但品牌化可执行文件就是开放运行时。共享的 `~/.dsh/profiles/node_modules` farm 停留在上次 heal 时的 generation，profile resolution 从这个过期 farm 应答，任何 farm 里没有的包都会让预设健康检查失败，即便 checkout 的 `node_modules` 和重新计算的闭包里都有它。重新打包也不 heal（链接进不了 `app.asar`），于是只要没人跑一次 CLI profile 或重新打包，没有任何启动路径会刷新 farm。

## Decision

heal 门改成具名判定 `healsSharedModuleFallback(bareModuleBaseUrl)`：bare-module base 缺失、或不落在 `app.asar` 路径段内的一切运行时都 heal，只有封闭归档跳过。按路径段精确比较，`app.asar.unpacked` 孪生目录会被认作它本来的开放树。桌面 dev 由此在每次启动时 heal farm，把链接重指到运行中 checkout 的依赖闭包——与其他一切开放运行时启动（`dsh` profile、CLI）遵循同一契约。

## Alternatives considered

- **完全取消 heal 门对 `bareModuleBaseUrl` 的耦合**，让打包运行时也尝试 heal。拒绝：farm 落地的是操作系统链接，无法进入 `app.asar`；尝试要么抛错，要么静默写入一个外来 generation。
- **让预设健康检查在 generation 查询落空时退回原始文件系统向上走查。** 拒绝：resolver 的 enforce 行为是契约——generation 之外的包不应静默可解析——在一个消费方削弱它，恰好会掩盖这次修复清除的过期状态。

## Consequences

- checkout 新增插件包后，桌面 dev 重启一次即可聘用，无需先跑一次 CLI 或重新打包来刷新 farm。
- 在两个 checkout 之间交替跑 dev 会把共享 farm 的链接翻向最后一次 heal 的那一个；这是 farm 文档化的共享 generation 行为，桌面 dev 现在同样参与其中。
