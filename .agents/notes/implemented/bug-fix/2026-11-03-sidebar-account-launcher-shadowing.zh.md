# Agent Note: 侧边栏账号行合一：slot 优先级遮蔽

Status: implemented

[English](2026-11-03-sidebar-account-launcher-shadowing.md) | 中文

## 问题

上游合并后侧边栏底部出现两个账号行并排：登录插件的会话行（claw 网关账号，此前注册在 `sidebar.footer.action`）与上游 `AccountMenu`（DeepSeek 凭据视图，注册在 settings shell 的 `settings.launcher` 座位）。两行同渲染——截图里 `brige | 已登录 DeepSeek` 挤成一行——且各带各的菜单。

## 决策

登录插件的行迁到 `settings.launcher`，并以 `priority: -1` **遮蔽**上游 launcher（升序、最低者渲染——`SlotCore.register` 的文档化遮蔽规则；同 priority 会抛错）。行继续渲染 claw 会话的头像与名字；菜单在既有登出旁新增"设置"项，接线座位自带的 `openSettings` 命令。`ui-settings-account` 零改动：不含登录插件的组合里其 `AccountMenu` 仍以默认 priority 注册、照常渲染；本组合里它保持注册但不渲染，且无副作用（被遮蔽的 single 座位 entry 的 inject face 不会实例化）。

早先草稿直接删除上游注册。否决：`apply.client.spec.ts` 装配完整 webApp roster，登录插件无论如何都占着座位，所有占用断言与 `operations()` 辅助都得感知另一个插件——而且删除会在每次上游合并时重新浮出。用遮蔽后，上游 spec 只需把占用计数改成按组件身份断言（`find(entry => entry.component === AccountMenu)`），在两种组合下都成立。

登录插件同时放弃 `sidebar.footer.action` 座位与 ui-sidebar 类型依赖（包的 inject/peer/dev 改名 `dsh-client-ui-settings`）。

## 备选方案

**删除上游注册。** 如上否决：合并摩擦最大，运行时收益不比遮蔽多。

**把 `AccountMenu` 的数据源改指 claw 会话。** 否决：它投影的是 DeepSeek 凭据/余额/资料栈（`useAccount`），另一套会话系统；改写等于 fork 一个活跃的上游组件。

**给登录行的菜单加"联系我们"。** 暂缓：上游联系流程读 DeepSeek 的 contact-config 问卷，本 OEM 部署未配置来源。设置 + 退出登录已覆盖该行需求。

## 验证

`packages/client/ui-login` 测试覆盖遮蔽注册（options 含 `priority: -1`）、设置菜单项（`openSettings` 恰好一次、菜单关闭）、会话切换的菜单重置。`apply.client.spec.ts` 按组件身份断言本插件的 launcher，带不带登录插件都成立。装配中的既有无关失败（webApp roster 无人声明 `settings.models.sign-in` hole；ui-settings-general 三例）在改动前的树上同样失败。

## 后果

只渲染一个账号行，显示网关会话；上游对 `AccountMenu` 的后续合并无冲突落地。上游未来若改 priority（任何 ≤ -1 的值）会翻转遮蔽并以同 priority 抛错的形式响亮失败，而非静默。
