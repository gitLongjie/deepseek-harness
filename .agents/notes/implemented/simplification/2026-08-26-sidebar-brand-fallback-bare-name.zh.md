# Agent Note: Sidebar brand fallback is the bare product name

Status: implemented

[English](2026-08-26-sidebar-brand-fallback-bare-name.md) | 中文

## Problem

没有任何包填充 `sidebar.brand.name` 时，侧边栏外壳把回退文案渲染成 `喵喔科技 Local Build`，再带一枚显示构建期 7 位 `DSH_CLIENT_COMMIT_HASH` 的徽标。后缀与徽标重复了窗口标题已经携带的构建元数据，挤占品牌行——展开态还兼任新建会话按钮——并且在面向用户的座位上读起来像内部构建术语。

## Decision

回退文案只渲染 `喵喔科技`；commit 徽标的 span 与对应的 CSS module 类一并移除。品牌行保留两个可替换 slot，想要构建标识的部署自行注册 `sidebar.brand.name`。

## Alternatives considered

**把 hash 藏进标记的 tooltip。** 否决：这保留了没人需要的隐藏构建元数据和格式化它的代码路径；移除是更小的表面。

**把后缀做成可配置的 slot 选项。** 否决：部署本来就能通过 `sidebar.brand.name` 完全持有这段文字；为同一像素再加一个旋钮没有现实消费者。

## Verification

`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` 固定了裸名称回退，并断言即使设置了 `DSH_CLIENT_COMMIT_HASH` 也不渲染任何修订文本；组装外壳的快照只含裸标签。两份包 README 的回退描述不再提徽标。

## Consequences

品牌行呈现的是产品而非构建产物。环境变量仍由 web 构建注入给其余消费者；只是侧边栏不再展示它。
