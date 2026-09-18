# Agent Note: 无更新源的 OEM 桌面构建完全关闭自动更新

Status: implemented

[English](2026-09-18-oem-desktop-without-update-feed.md) | 中文

## 问题

`updateUrl` 在 OEM 链路的每一层都是必填:配置解析器、桌面打包投影、打包后的运行时解析器都拒绝缺失,而且运行时的模块级解析在桌面窗口打开之前就抛错。一个不允许自动更新的 OEM 部署——例如与外网隔离的校园网——没有任何诚实的方式声明这一点:想构建出可用的安装包,只能编造一个必然让每次检查失败的更新源 URL。

## 决策

`updateUrl` 全链路改为可选。无更新源的部署在 `oem.config.json` 中直接省略它;解析器与桌面打包投影仍然拒绝"存在但非法"的值。没有更新源时,electron-builder overlay 省略 `dsh.updateUrl` 与 `publish` 块。运行时 `resolveDesktopUpdateUrl` 返回 undefined,`initUpdater` 完全不装配 electron-updater:不设源、不做启动检查、不做周期复查。`requestUpdateCheck` 与徽章的 IPC 动作保持惰性,帮助菜单省略"检查更新"入口(`updateChecksEnabled`)。应用内徽章永远不会出现,因为状态事件从不发送。

## 备选方案

**保留必填,发一个占位 URL。** 否决:每次检查都会对不可达主机失败,帮助菜单检查会报出一个部署方永远无法修复的错误。

**必填 URL 之外再加一个独立开关。** 否决:开关与 URL 可能互相矛盾,"是否存在更新源"本身就是完整事实,第二个字段只会多出一种说谎的状态。

**空字符串哨兵值。** 否决:它本来就通不过 URL 校验,要么为此再开特例,要么被当成畸形值,可读性更差。

## 后果

校园等封闭部署构建和运行时零更新流量,[复查机制](2026-09-14-periodic-desktop-update-recheck.zh.md)只在存在更新源时生效。为这类部署重新启用更新只需把 `updateUrl` 加回来并发一个版本——没有迁移,没有存储状态。代价是每个消费解析结果的调用点多一个分支;对声明了更新源的构建,HTTPS-only 规则与本地演练例外保持不变。

## 验证

`scripts/oem-config.client.spec.ts` 钉住省略 `updateUrl` 的解析;`apps/desktop/tests/builder-identity.spec.ts` 钉住 overlay 不含更新元数据;`apps/desktop/tests/update-url.spec.ts` 钉住缺失解析为 undefined;`apps/desktop/tests/updater.spec.ts` 钉住不装配的更新器与惰性手动检查;`apps/desktop/tests/menu.spec.ts` 钉住帮助菜单入口缺失。
