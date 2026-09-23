# Agent Note: The sign-in gate reveals the password through an eye toggle

Status: implemented

[English](2026-09-23-sign-in-show-password-toggle.md) | 中文

## 问题

登录表单此前无条件遮蔽密码。密码输错只会在一次网络往返后以账号服务器的笼统失败消息出现，用户看不清自己输入的内容，无法区分输错与凭证被拒——对粘贴时带入前导空白、或当场重打的密码尤其严苛。

## 决策

密码字段拥有一个内联显隐按钮：遮蔽时是睁开的眼，可见时是带斜杠的变暗的眼，在 `password` 与 `text` 之间切换输入框。按钮文案在 ui-login 词典（`showPassword` / `hidePassword`，中英）中维护，`aria-label` 随状态切换，辅助技术读到的是动作而不是图标。

两个结构事实支撑实现。字段标题从包裹式 `label` 元素改为通过 id 指向输入框的兄弟 `label`——`label` 内不得包含按钮，旧的"字段即 label"框架放不下切换按钮；两个字段保留同一 `div.field` 框架。`Input` 的 `className` 放宽为 `string | undefined`，显隐框架得以在 `exactOptionalPropertyTypes` 下按条件传入输入框的贴合类。

两只眼睛是 `ui-primitives` 的新图标（`IconEyeOutline16`、`IconEyeOffOutline16`），以 1.3px 描边保证 16px 下可读；隐藏态用斜杠叠加变暗的眼睛，而不是另造一个轮廓。

## 已考虑的替代方案

**字段下方的复选框。** 2020 年前的常见模式；表单纵向尺寸翻倍，控件与其所控对象分离，还需要独立的标题文案。

**依赖浏览器原生密码显隐（Edge/Windows）。** 仅 Chromium 可用、无法定制样式、组件层不可测，Firefox 与所有 WebKit 构建上均不存在——桌面应用得不到任何保证。

**清空重输代替显隐。** 解决粘贴带入空白，但解决不了核对；用户依旧看不到已存储的值。

## 后果

显隐状态是组件本地状态，重挂载即重置；每次渲染的默认态都是遮蔽，登录页不会在刷新后保留暴露的密码。表单 DOM 每个密码字段多一个按钮，词典每种语言多两个键。

## 测试

`packages/client/ui-login/tests/components.client.spec.tsx` 通过本地化可访问名称驱动切换：默认遮蔽，`显示密码` 把输入框切为文本并使自身消失，`隐藏密码` 恢复遮蔽。`packages/client/ui-primitives/tests/icons.client.spec.tsx` 固定两个新图标。
