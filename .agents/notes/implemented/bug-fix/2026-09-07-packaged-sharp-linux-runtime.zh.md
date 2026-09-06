# Agent Note：打包后的 Linux 运行时携带 sharp 绑定、libvips 与解包的 `.so` 文件

Status: implemented

[English](2026-09-07-packaged-sharp-linux-runtime.md) | 中文

## 问题

桌面冒烟门只在 Linux 失败：打包应用启动时 `attachment-local` 挂载项报 `Could not load the "sharp" module using the linux-x64 runtime`。Windows 与 macOS 之所以正常，是因为它们的平台包是自包含的（libvips 的 DLL/dylib 随 `@img/sharp-win32-x64`、`@img/sharp-darwin-*` 一起发布）。Linux 绑定则是从独立包 dlopen `libvips-cpp.so.8.18.3`，于是三个缺口叠加：pnpm 10+ 从不安装 sharp 的跨平台可选二进制，electron-builder 的遍历根本看不到 Linux 绑定；electron-builder 收集到包时却拿不到 RUNPATH 可达的 libvips 兄弟包；而且即使收集正确，`.so` 仍在 `app.asar` 内部，`dlopen` 读不到归档内容。

## 决策

桌面清单把 `@img/sharp-linux-x64` 与 `@img/sharp-libvips-linux-x64` 声明为 `optionalDependencies`——electron-builder 自己的打包警告就指明这是让平台二进制进入其遍历路径的方式；用 `optionalDependencies`（而非 `dependencies`）才能让其他平台上的 pnpm 跳过它们而安装不失败。`ASAR_UNPACK_GLOBS` 增加 `**/*.so` 与 `**/*.so.*`，当两个包以兄弟身份落在 `node_modules/@img/` 下时，绑定内嵌的 RUNPATH `$ORIGIN/../../sharp-libvips-linux-x64/lib` 便能对准真实解包文件。第三方声明生成器为这两个包加入 `OVERRIDES`，因为 pnpm 在其他所有 OS 上都会跳过外来平台可选二进制，本地没有可读许可证的 manifest。

## 已考虑的替代方案

**在 CI 里用 apt 安装系统 libvips。** 否决：打包应用不能依赖运行机提供的系统库，而且 RUNPATH 并不保证可靠地搜索系统路径。

**让 attachment-local 弃用 sharp。** 否决：那是无关的能力重写，不该搭在打包修复上。

## 验证

`apps/desktop/tests/packaged-resources.spec.ts` 锁定 `.so` 解包通配。`desktop-publish.yml` 的 Linux 作业在 xvfb 下启动打包应用，完整走通该链路：可选二进制安装 → 兄弟包收集 → `.so` 解包 → dlopen 成功。

## 后果

三个发布平台以同一条附件管线通过打包冒烟门。解包通配从此也会解包其他原生依赖携带的 `.so`，这正是 Linux 原生模块的应有行为。
