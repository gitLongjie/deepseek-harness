# Agent Note: Hero greeting, app-icon brand mark, and desktop shell identity

Status: implemented

[English](2026-08-30-hero-greeting-brand-mark-desktop-identity.md) | 中文

## Problem

桌面客户端存在三处用户可见的品牌缺陷。侧边栏与空白会话 hero 渲染的是遗留的鲸鱼标识（`MewoLogo` 内联 data URI，Web 启动页同样镜像了一份），与 `apps/desktop/build/icon.png` 里真正出厂的应用图标不一致，运行中的产品同时出现两个互相矛盾的 logo。Hero 标题是固定标语加发布阶段徽章（`探索未至之境`/`Into the Unknown` 与 `预览版`/`Preview`）——一句静态营销文案占据了本可以问候用户的位置。而在 Windows 上以开发方式启动（`pnpm dev`）时，主进程没有设置应用身份，启动器也直接运行未经修改的 `electron.exe`，因此任务栏和任务管理器显示的是 "electron" 与 Electron 原子图标。

## Decision

**唯一品牌标识：应用图标 artwork。** `packages/client/ui-primitives/src/MewoLogo.tsx` 与 `packages/client/web/src/boot-page.ts` 中的启动页副本内联 `apps/desktop/build/icon.png` 的 72px 方形渲染。标识为正方形（primitives 组件中 `MARK_SOURCE_WIDTH`/`MARK_SOURCE_HEIGHT` 均为 72），继续沿用现有品牌槽位流向 hero、侧边栏宽栏头部与折叠栏、以及启动页文字标。托盘沿用 `tray.ico`，它本来就是同一套 artwork。

**Hero 按本地时间问候。** `packages/client/ui-conversation/src/client/skeleton/hero-greeting.ts` 把本地小时数分为五档——05:00 起为早上、11:00 起为中午、14:00 起为下午、18:00 起为晚上、23:00 起为深夜，00:00–04:59 保持深夜——`heroGreetingKey` 返回对应的 `hero.greeting.<slot>` 文案键。`HeroShell` 以 `t(heroGreetingKey())` 替换旧标题与徽章；徽章元素、其 CSS 列，以及两侧字典中的 `hero.headline`/`hero.preview` 条目全部删除，`en` 字典的 `Record<ConversationKey, string>` 类型约束保证键集同步。中文各行共用标语尾句（`早上好，去探索未至之境` … `深夜好，去探索未至之境`）；英语没有正午与深夜问候的习惯说法，因此 `hero.greeting.noon` 与 `hero.greeting.night` 分别取 `Good afternoon. Explore the unexplored.` 和 `Burning the midnight oil. Explore the unexplored.`

**桌面壳与可执行文件携带同一身份。** 在 `apps/desktop/src/main/index.ts` 的模块加载期，`app.setName(DESKTOP_WINDOW_TITLE)` 以及 win32 上的 `app.setAppUserModelId('ai.deepseek.works')`——与 electron-builder.yml 的 `appId` 一致，使开发与打包共享同一任务栏身份——先于 `installSingleInstanceLock` 执行。新 id 避免继续复用此前与 Electron 开发启动器关联的 Windows 任务栏图标缓存。Harness 数据仍由 `resolveDshHome` 放在 `~/.dsh` 下，与应用名无关；迁移的只有 `desktop.log` 与更新器缓存目录。在 Windows 上，`apps/desktop/scripts/dev.ts` 把 Electron 复制到原可执行文件旁并命名为 `深度Works-dev.exe`，再在启动前把已提交的多尺寸 `build/icon.ico`、产品名、文件描述和版本写入副本的 PE 资源。builder 的全局与 Windows 图标设置把同一 artwork 写入正式打包的 `深度Works.exe`。

## Alternatives considered

**问候语旁边保留发布徽章。** 否决：徽章是发布阶段元数据而非品牌身份；版本号本已出现在侧边栏本地构建标记、关于菜单和更新器里。

**只设置 AppUserModelId。** 否决：应用名还驱动 macOS 菜单栏与关于面板，且由 userData 派生的路径不应取决于开发清单与打包清单碰巧携带的名字。

**一个带时间参数的插值标题键。** 否决：五档措辞是封闭选择，应放进字典，让每种语言各自拥有完整的问候句。

## Consequences

产品在所有界面呈现同一个标识，hero 从广告语变成问候。时段分档在渲染时读取操作系统本地时钟：没有会话事件，也没有模型可见输入，模型可见即须记录规则不受触及。开发启动与正式打包共享 Windows 任务栏身份，任务管理器的应用列表与进程视图都从可执行文件资源读取 深度Works 和小船图标。开发副本放在 Electron 可执行文件旁，使 Chromium 无需每次打包应用也能解析运行时资源。
