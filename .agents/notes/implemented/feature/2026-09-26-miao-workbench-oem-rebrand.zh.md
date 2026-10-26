# Agent Note：OEM 品牌更名为喵工作台，磁盘标识统一为 ASCII 的 miaoWorker

状态：已实现

[English](2026-09-26-miao-workbench-oem-rebrand.md) | 中文

## 问题

OEM 品牌标识「miaoWork」（帆船图案、扬帆主题文案）覆盖桌面壳、客户端 UI、安装器以及 agent 自身的系统提示身份行。产品即将更名为喵工作台：显示名、通知与登录文案、问候语、所有图标面、磁盘路径需要一起迁移；同时磁盘标识必须保持 ASCII（`miaoWorker`），使安装路径与数据目录在显示名为非 ASCII 的前提下保持稳定。

## 决策

单一品牌来源 + 单一 ASCII 文件系统标识：

- `oem.config.json` 承载 `productName: "喵工作台"`、猫主题的 `loginTagline` 与 `greetings`；其余沿用现有 OEM 管线（`scripts/oem-config.ts`、`desktop-oem-config.mjs`）投影，各消费方结构不变。
- ASCII 磁盘标识统一为 `miaoWorker`，覆盖所有机器可读路径：NSIS 安装目录（`installer.nsh` 固定 `$PROGRAMFILES64\miaoWorker`）、electron-builder 覆盖层的包 `name`（APP_FILENAME）、Windows/macOS/Linux 产物名前缀、Linux 可执行文件名，以及桌面主进程显式设置的 `userData` 目录（Windows `%APPDATA%\miaoWorker`，macOS `~/Library/Application Support/miaoWorker`）。面向显示的字段（`shortcutName`、`uninstallDisplayName`、dev 启动器写入的 FileDescription）承载喵工作台。
- 所有图标面都源自 512×512 猫头图案（`apps/desktop/build/icon.old.png`）：多尺寸 ICO 走现有 OEM 图标管线（`apps/web/public/favicon.ico` → `syncDesktopOemIcons` → `build/icon.ico` + `build/tray.ico`），`build/icon.png`/`tray.png`/`tray@2x.png` 是对应 PNG，`apps/web/public/favicon.{ico,png,svg}` 更换 Web 面图标，`MewoLogo`/启动页内嵌 data URI 是同一图案的 72×72 渲染。窗口、任务栏、托盘、安装器图标全部读取这些文件。
- `system-prompt` 中模型可见的身份行（"You are an AI agent powered by …"）与桌面完成通知标题同步更名，客户端默认品牌回退值（`brand.localBuild`、登录页标题、启动页字标、`OfficialBrandName`）与内置 preset 的 persona 前缀一并更新。

`ai.deepagens.worker`（Windows AppUserModelId）与 `loginUrl`/`updateUrl` 端点保持不变：AUMID 是不可见的 Win32 标识，改名会危及 toast 激活兼容性；端点是功能性后端地址，不属于品牌文案。

## 已考虑的替代方案

**用 `productName` 生成非 ASCII 安装目录。** 拒绝：NSIS 目录、产物名与支持工具链只有依赖 ASCII 标识才保持可复现；miaoWork 已经用 `DeepagensWork` 支付过这个成本，本次只是把一个 ASCII 标识换成另一个。

**只更名安装器、保留 agent 身份行。** 拒绝：身份行是模型可见的产品文案；喵工作台的会话自称由miaoWork 驱动，会与其余所有界面矛盾。

**只手改构建产物里的图标。** 拒绝：`build/icon.ico` 是 `apps/web/public/favicon.ico` 经 `syncDesktopOemIcons` 的投影，直接改产物会在下一次 dev 或 deploy 运行时被覆盖。

## 后果

已安装的 miaoWork/DeepagensWork 保留其卸载注册表键（共享 `appId`），同键升级路径会移除它们；旧名称下的 `userData` 不做迁移，符合预发布阶段「磁盘格式不承诺兼容」的立场。下一次发布起，发布产物切换为 `miaoWorker-*` 前缀；更新器从各 release 自己的 `latest.yml` 解析资产名，无需双重命名。图标源文件的 `.old` 副本保留在 `build/` 目录以备参考。

## 验证

`apps/desktop/tests/builder-identity.spec.ts` 固定新的产物名、安装目录与覆盖层包名；`apps/desktop` 单元测试（149 个）通过，含完成通知标题与托盘图标路径；`system-prompt`、`agent-loop`、`app-boot`、`web-app` 套件（778 个）针对更名后的身份行通过；客户端与 `apps/web` 套件（690 个）在重新生成的侧边栏快照下通过。
