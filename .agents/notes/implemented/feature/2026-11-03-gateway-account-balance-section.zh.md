# Agent Note：网关账号页与 claw 余额；导航按赢家投影

Status: implemented

[English](2026-11-03-gateway-account-balance-section.md) | 中文

## 问题

设置里的「账号与余额」页只呈现上游 DeepSeek 平台账号：`ui-settings-account` 在存有 DeepSeek 凭据时才注册该 section，余额来自 DeepSeek 平台。claw 部署的用户登录的是网关（`claw.deepagens.com`，new-api 系中转），模型请求走的也是网关密钥——除非恰好还存有 DeepSeek 凭据，设置页连账号页都没有；即便有，也从不显示网关余额。

## 决策

**账号页归登录插件所有。** `ui-login` 以上游 section 自己的 `id`（`account`）、`priority: -1` 注册一条 `settings.section`——与 `settings.launcher` 席位已有的阴影手法一致（list slot 按 id 分 cell，每 cell 只渲染优先级最低的存活者；同优先级会抛错）。该条目仅在网关会话存续期间存活：登出即撤销，上游页面（或没有 DeepSeek 凭据时的空缺）与插件出现之前完全一样地服务该 cell。组件渲染会话身份与来自登录存储的已用、剩余 token 数，会话继续作为登录门、启动器、账号页三者共享的唯一事实源。

**余额契约。** 网关 token 额度从 new-api 令牌用量端点读取，以会话密钥为 Bearer 凭据：`GET /api/usage/token/` 的 `data.total_used` 与 `data.total_available` 是 token 数，不是显示美元。`data.unlimited_quota` 为 true 时密钥不设剩余上限，页面显示不限额而不是剩余数字。读取发生在登录时、启动会话采纳时，以及每次进入设置页时；重读失败保留上一次的好值，首次失败提供重试入口，读取在途时退出登录则丢弃结果、不写进已结束的会话。

**导航投影与面板对齐。** 设置壳的导航行此前投影 `entries('settings.section')`（原始 ledger），而面板出口渲染的是 `entriesOfSlot`（cell 赢家）：一条被阴影的注册会出现在两个「账号与余额」导航行上、点击后却只有一个面板。投影改为映射 `entriesOfSlot`，导航与面板一致；这也与 `ui-sidebar` 投影 panellist 的既有做法相同。

**Models 字典恢复。** 2026-11 的上游合并把合并前未翻译的旧字典留在了 `ui-settings-models`，八种语言回退为英文文案，并让断言 `模型`/`删除 {provider}？` 的上游测试保持红灯。译文已从本次合并的上游父侧恢复；本分支较新的键（`followGatewayCatalog`、`followGatewayCatalogHint`、`inputText`、`modelInputInvalid`）补了新翻译；`advancedHint` 保留本分支的 `settings.yaml` 表述。

## 备选方案

**扩展 ui-settings-account 渲染网关会话。** 否决：那会让上游包反向依赖登录插件（跨包的接缝类型 + 可选 hook），而它本身的事实源在登录存储里；注册条件也在那边，耦合是结构性的，不是表面的。

**用新 id（如 `gateway-account`）注册。** 否决：一旦用户也存有 DeepSeek 凭据，会出现两个账号页；部署的主账号就是网关账号，同 id 阴影在两种世界里都只保留一个页面。

**在组件里读余额。** 否决：会话密钥与 origin 都在存储里，组件读会让启动器或未来表面重复实现同一条线上契约。

## 验证

`packages/client/ui-login` 测试：令牌用量读取报告已用与剩余数量（并断言 `GET /api/usage/token/` 的 Bearer 头），不限额密钥不会把零剩余当成上限，500、非 JSON 正文以及缺少数量的正文报告 `unavailable`，失败的重读保留 ready 值，读取在途登出丢弃结果，登出重置为 null，未登录刷新是空操作；组件测试覆盖身份、`12,345` / `987,655`、不限额文案、控制台/充值链接与重试入口；apply 测试断言注册选项（`id: 'account'`、`priority: -1`）、对同 id 条目的阴影赢家关系、以及登出后的撤销。`ui-settings-general` 的 apply 测试断言「仅赢家」投影（`阴影模型` 行只出现一次且按 order 排序）。字典恢复由 `tsc -b`（zh 的映射注解与其余语言的 `satisfies Record<keyof typeof en, string>` 约束强制键集）加一次八字典运行时键集比对验证。

## 影响

设置账号页从此始终呈现真正服务请求的账号。上游 `ui-settings-account` 的变更可无冲突落地；上游未来若把优先级改到 ≤ -1，会在注册时响亮抛错而不是静默翻转阴影。导航投影的变更对每个 section 生效，未来任何部署阴影其它 section id 都无需改壳。账号页展示的是网关 `GET /api/usage/token/` 返回的 token 数——已使用与剩余——而不是计费端点的显示美元。
