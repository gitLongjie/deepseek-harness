# Agent Note: The opening locale is Chinese-first, not browser-derived

Status: implemented

[English](2026-09-23-chinese-first-opening-locale.md) | 中文

## 问题

客户端以浏览器语言打开：初始 locale 按完整标签、再按主语言子标签匹配 `navigator.languages`，因此在英文 locale 的系统上（桌面 webview 上报 OS locale 的常见情况）全新安装会把整个产品呈现为英文。产品是中文优先的——品牌、登录文案与受众都是中文——没有任何已存储偏好的首次读者，无论机器 locale 如何设置，都应该看到中文。

## 决策

打开语言永远是产品默认（`DEFAULT_LOCALE` = `zh`）。浏览器语言检测（`detectBrowserLocale`、`navigator` 匹配、面向非浏览器运行的 `window` 守卫）已删除；没有已存储 Host 偏好的运行时以默认打开，“设置 → 常规”仍是把其他语言变成持久选择的唯一入口。显式的已存储偏好依旧压过默认值，清除偏好回到中文。注册语言包不再因其恰好匹配浏览器而自动切换生效 locale；语言包只进入选择器，直到被选中。

`FALLBACK_LOCALE`（`en`）保留第二项职责——所有 fallback 链的字典终点——失去第一项：它不再兼任打开语言。`usePinnedBrowserLanguages` 测试辅助对 locale 选择不再生效，保留给断言 navigator 相关行为的测试套；删除它需要横扫十几个包却无任何行为变化。

## 已考虑的替代方案

**保留浏览器检测但偏向 zh。** 对已发布的 `zh`/`en` 组合（检测唯一能命中的标签）而言与删除等价，却为永远不会改变结果的场景保留匹配代码——带着误导性契约的死机器。

**仅在桌面组合中强制 zh。** 行为位于共享的 client 包中；构建期覆盖会让 web 与桌面的打开语言契约分叉，并引入一个谁都不需要的配置面。

**首次运行时询问。** 在产品首屏之前插一道语言提示是产品不需要的摩擦；设置行已经拥有切换职责，中文优先契合受众。

## 后果

全新安装无论 OS locale 如何都以中文打开；英文读者选择一次英文，已存储的偏好即生效。代价真实存在：想用英文的英文 locale 机器需要一次显式选择而不是直接继承——可接受，因为反向行为正是被报告的缺陷。语言包注册时的自动切换随之消失；pt-BR 包必须被选中才会生效。

## 测试

`packages/client/locale/tests/locale.client.spec.ts` 固定各种浏览器形态（英文、区域变体、未提供语言、缺 `languages`、非浏览器）下的中文打开、语言包注册不自动切换，以及 Host 偏好仍压过默认值。`apply.client.spec.ts` 将 Host 偏好刷新循环改为使用 `en` 作为差异偏好。`document-language.client.spec.ts` 以更新后的措辞保留 `<html lang>` 覆盖。
