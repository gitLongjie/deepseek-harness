# @deepseek-ai/dsh-client-ui-settings-general

[English](README.md) | 中文

设置外壳、无特定功能归属文案与遗留持久化 namespace。它以触发控件和模态设置面板占用 `sidebar.settings`，把 `settings.section` 账本投影成导航，并在设置页面上注册所有不属于单一功能的内容：触发器、标题栏与关闭控件内容、本地配置文件操作，「通用」分区及其 `settings.general.item` slot，以及 `settings` 字典。它渲染进的那些 slot 类型归 ui-settings——设置领域底座——所有；只有外壳自身的契约类型放在这里，因为它们引用 ui-sidebar 的 slot 类型，而底座不得依赖任何 `ui-*` 包。归具体功能所有的行（「权限」、「语言」、「外观」）与分区（「模型」）仍由各自的功能包提供。

外壳不自带引导文案：所有文本都来自注册方。导航 label 可以是跟随语言的 thunk，因此导航投影经 `resolveSlotLabel` 解析，并在分区账本更新或 locale revision 变化时重新渲染（`ctx.get('locale')` 可选读取，无硬 locale 依赖）。

回环浏览器通过 `settings.describe` 加载提供方的 `hasDocument` 能力，且只有在 Host 确认可准备好一份由提供方持有的本地文档时才渲染**打开配置文件**。该操作发送无路径参数且仅限回环访问的 `settings.openDocument` 请求；Host 会再次解析提供方路径、在文档缺失时将其创建出来，并交给原生文本编辑器（macOS 上使用 `open -t`，绕过浏览器文件关联；Linux 和 Windows 上使用桌面文件关联；WSL 上经 `wslpath -w` 转换后使用 Windows 文件关联）。打开失败时该操作仍可使用，并渲染本地化错误。临时读取失败或 Host 拓扑变化后，重新打开对话框或重新连接会刷新可用性。远程浏览器从不注册该操作，也从不发起这项特权设置读取。

宿主端在用户设置 seam 中注册 `ui-onboarding`；该注册让仍携带已停用 `welcomeNoticeVersion` 字段的已存文档保持有效。当前没有任何读取方写入该字段，外壳本身仍不持有产品策略。

## 模型体验

无。该插件渲染浏览器设置 UI；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 「通用」分区没有内置行；每一行仅在其所属功能插件挂载时出现。
