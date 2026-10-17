# Agent Note: 视频工作台侧栏行跟随当前语言

Status: implemented

[English](2026-10-07-video-workbench-panel-row-follows-locale.md) | 中文

## Problem

中文界面下侧栏依次读作：知识库、定时工作、**Video workbench**。第三行是 `sidebar.panellist` 的 `video-workbench` 条目，它注册的是 `label: en.title`——直接把英文字典值当字面量传了进去。`SlotLabel` 之所以同时接受字符串和 thunk，正是因为注册只发生一次，而语言随时可能切换；侧栏外壳每次投影都经 `resolveSlotLabel` 解析已存的 label，并在 `ctx.locale.subscribe` 时重新同步，因此字面量在加载时就被冻住。隔壁的 `ui-schedule-work` 早就传了 thunk。

这条反馈是以"字体"的形式报上来的（"字体不是一个"）：UI 字体栈里拉丁字形与中日韩字形落到不同字族，于是一行英文夹在中文行中间，看起来像换了字体，而不是像漏翻的文案。页面本身其实是对的——它的 `<h1>` 渲染的是 `t('title')`——这让那一行更像是样式缺陷而非缺失的翻译。

## Decision

该行改为注册读取当前字典的 thunk，即 `ui-schedule-work` 的模式：

```ts ignore-check
const navLabel = (): string => {
  const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh
  return dictionary.title
}
```

同一个值同时供该行的可见文本、tooltip 与 `aria-label` 使用，因为外壳这三者都从解析后的 label 派生。

`tests/browser-plugin.client.spec.ts` 现在把浏览器半边挂在真实的 `SlotRegistry` 与 locale 服务上，声明外壳的 `sidebar.panellist` 与 `main` 槽，并断言解析出的 label 在 `en` 下是 `Video workbench`、在 `zh` 下是 `视频工作台`。这正是本包原先缺的那块：页面 spec 只覆盖"用注入的 props 渲染"，从不碰侧栏注册，所以没有任何测试读过注册的 label。

## Alternatives considered

- **保留字面量，由外壳来翻译。** 拒绝：`resolveSlotLabel` 是所有 list 槽（导航行、标签页、设置分节）唯一的 label 通路，而其中的字面量是一个值而不是键——让外壳去猜哪些字面量可翻译，等于发明第二套含混的契约。
- **语言切换时重新注册该行。** 拒绝：`ui-sidebar` 已经在 `ctx.locale.subscribe` 时重新投影，thunk 正是外壳提供的手段；为了改一段文字而重新注册会搅动槽账本与主面板选中状态。

## Consequences

- 侧栏图标行、其 tooltip 与无障碍名都跟随当前语言；两种语言下侧栏读起来一致。
- 侧栏里再出现"中文旁边一行英文"，现在是测试失败，而不再依赖肉眼判断。
- 该行的图标仍按外壳的 panellist 尺寸 16px 渲染，而相邻的 `sidebar.knowledge` 行自绘 14px 图标。那是另一个几何问题，保持原样。
