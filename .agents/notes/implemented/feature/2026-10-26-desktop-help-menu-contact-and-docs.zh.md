# Agent Note: 桌面帮助菜单加入联系二维码与帮助文档

Status: implemented

[English](2026-10-26-desktop-help-menu-contact-and-docs.md) | 中文

## Problem

OEM 桌面壳的帮助菜单只提供仓库链接、反馈、检查更新与关于。品牌部署的最终用户在应用内没有联系运营团队或查看产品文档的入口：GitHub 仓库与 issue 是维护者界面，不是客服界面。一个面向消费者的产品需要把「找谁」和「说明书在哪」放在原有入口旁边。

## Decision

- **联系我们**是帮助菜单的第一项。它在当前聚焦窗口上弹出一个模态小窗，以 320px 显示随包分发的 `apps/desktop/build/contact-qr.png`，并附扫码提示与关闭按钮；Escape 和按钮都能关闭。图片沿用 electron-builder 既有的 `build/**` 文件闭包进入 app.asar，因此部署方只替换这一个文件就能更换二维码。
- **帮助文档**紧随其后，通过 `shell.openExternal` 打开 `helpDocsUrl`。该 URL 是 OEM 部署事实：可选的、仅接受 HTTPS 的 `oem.config.json.helpDocsUrl` 在打包时写入 `extraMetadata.dsh.helpDocsUrl`；源码运行读取仓库文件，安装后的应用读取清单，与更新源、知识库和网关显示名走同一条双路径。
- **未配置即省略该项。** 没有 `helpDocsUrl` 的部署不渲染帮助文档项，而不是留下死链接，与检查更新项遵循同一规则。联系我们项始终存在，因为壳自带了图片。
- **文案归 locale 所有。** 两个菜单标签与弹窗文案都放在 `desktop/locales.ts`（联系我们 / 帮助文档及对应英文），既有的语言切换重建会一并刷新。

## Alternatives considered

- **用 `dialog.showMessageBox` 的图标展示二维码。** 否决：原生消息框会把图标缩得过小，屏幕上扫码不可靠。
- **运行时从 URL 生成二维码。** 否决：联系二维码是运营团队持有的图片（微信或企业联系卡），不是壳能编码的 URL；随包图片在离线时也能一致显示。
- **在 `menu.ts` 里硬编码文档地址。** 否决：文档地址与更新源一样属于部署事实。OEM 文件已经承载这类事实，写入或省略的行为可避免发布错误链接。
- **在 Web 客户端里渲染二维码。** 否决：帮助菜单属于 Electron 主进程和标题栏的原生弹出路径；为一个菜单动作新增客户端 slot 会把它与 Web 插件图耦合。

## Consequences

- 随包的 `oem.config.json` 把 `helpDocsUrl` 指向[公司服务支持页](https://www.deepagens.com/faq)；若部署方有自己的手册，只改这一个字段，打包时会烘入清单。
- 最终用户一键即可联系或查看文档，仓库、反馈、更新与关于入口仍为维护者保留。
- 更换联系二维码意味着替换 `apps/desktop/build/contact-qr.png`。文件缺失时显示本地化错误对话框而不是打开空窗口；加载失败会先销毁弹窗再报告。
- 随包的 `apps/desktop/build/contact-qr.png` 是公司官方联系二维码——发布在 deepagens.com 上的「深度云海」公众号名片。若要换成其他客服名片，只替换该文件即可，弹窗本身无需改动。
- `apps/desktop/tests/{menu,contact-qr,help-links}.spec.ts` 固定菜单项、弹窗文档与源码/清单解析；`scripts/oem-config.client.spec.ts` 与 `apps/desktop/tests/builder-identity.spec.ts` 固定 OEM 校验与打包投影。

## References

- 桌面表面：`apps/desktop/src/main/desktop/{menu,contact-qr,help-links,locales}.ts`、`apps/desktop/src/main/index.ts`
- OEM 配置：`oem.config.json`、`scripts/oem-config.ts`、`apps/desktop/scripts/{desktop-oem-config.mjs,deploy-app.mjs}`
- 随包资源：`apps/desktop/build/contact-qr.png`（来自 https://www.deepagens.com 的官方联系名片）
