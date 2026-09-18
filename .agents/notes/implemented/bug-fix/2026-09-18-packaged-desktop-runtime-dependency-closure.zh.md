# Agent Note: 打包桌面的安装包必须携带完整运行时依赖闭包

Status: implemented

[English](2026-09-18-packaged-desktop-runtime-dependency-closure.md) | 中文

## 问题

minda 安装包在构建机上能启动,到目标机器上就失败:`connection` 因等待 `webRuntime` 而挂起,启动审计直接杀掉应用。打包出的 app.asar 缺了十一个 workspace 包(包括 `dsh-http-proxy`、`dsh-util-time`、`dsh-ptc-runtime`),而且 `code` 预设的 roster 行引用了 `@deepseek-ai/dsh-workflow-worker-thread`——一个仓库里根本不存在的包。两套机制把这些缺陷对每次检查都藏了起来:Node 沿目录向上的 `node_modules` 解析会逃出 `app.asar`,在仓库里跑冒烟时被 checkout 的 node_modules 静默兜底;roster 的缺包原因写进了一个窗口化进程根本读不到的 stderr。

## 决策

桌面 manifest 显式声明完整运行时闭包——打包树会 import 的、或预设行会点名的每个包,都是 `apps/desktop/package.json` 的 `dependencies` 行;未声明的 peer+dev 组合熬不过 electron-builder 的收集。冒烟门不再信任 checkout:默认把打包产物复制到一个带空格的临时路径下(模拟 `C:\Program Files\...`)并启动副本,让仓库兜底和空格敏感路径都成为一等失败;`--in-place` 可退出该行为。unpacked runner 的闭包(`dsh-lazy-require`、`dsh-subprocess` 的 `control` 子模块)与 runner 一起解包,因为纯 Node 子进程读不到归档。预设组合里幽灵的 `workflow-worker-thread` 行被移除,而不是为一个工作区没有的包继续出货。

## 备选方案

**在发起 import 的包里声明缺失依赖。** 长期更正确的形态,工作区也确实背着本次未偿还的未声明导入债;但无论哪种方式,electron-builder 都按 app manifest 的闭包收集,而且逐包声明仍然抓不住预设行点名一个任何 manifest 都没列的包这类问题。桌面级闭包加仓库外冒烟,今天就能拒绝整类失败。

**把仓库改名让冒烟被迫在仓库外跑。** 否决:每次运行都改名 checkout 比复制慢,还会打断所有并行的仓库使用。

**冒烟留在原地,另加一个包清单 lint。** 否决:lint 会用自己的一套逻辑重新推导闭包,和打包器的真实行为漂移;复制布局后的启动观察到的就是装机机器观察到的。

## 后果

通过冒烟的安装包可以在没有仓库的干净机器上从 `Program Files` 启动。新出现的未声明导入会在门上暴露,而不是在客户机器上暴露,代价是每次冒烟多一次布局复制。ripgrep 二进制在 Windows 上也从 `app.asar.unpacked` 孪生路径 spawn——原重写只匹配正斜杠,此前每个 Windows 安装都在 spawn 不可执行的归档路径。组合行点名的包一旦从工作区消失,row 必须随之移除;discovery 会在没有意外兜底的机器上标它 broken,在有兜底的机器上标它 healthy。

## 验证

`packaged-smoke.mjs`(默认路径)从仓库外带空格的路径启动复制布局;复现目标机器失败的那次运行,修复前恰好在这里失败。`rg-asar-twin-windows.spec.ts` 钉住反斜杠重写;`builder-identity.spec.ts` 与 `packaged-resources.spec.ts` 钉住 manifest 闭包与 unpack glob。
