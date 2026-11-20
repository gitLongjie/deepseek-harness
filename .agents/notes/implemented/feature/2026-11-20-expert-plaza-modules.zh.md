# Agent Note: Expert plaza modules

Status: implemented

[English](2026-11-20-expert-plaza-modules.md) | 中文

## Problem

可聘用的专家可以打包和跟进，但写它的人不能把它发布出去或更新。专家页因此只有名单和 npm 目录，没有一个已登录账号可以把人设放到线上、让别人下载的地方。

## Decision

任何已登录的 token-api 用户把模块发布到 `/api/expert-hub`。服务器根据会话盖上作者，并把 zip 存在该条目上。公开 id 是 `u{userId}-{localId}`，只含小写字母、数字和短横线，最长 64 个字符。同一版本而字节不同会被拒绝；更高的 `x.y.z` 替换该条目并立即发布。当前版本的相同字节按已是当前版本成功。owner id 为 0 的条目和别人的 slug 不能被替换。

专家页有两个模块。我的专家上传本账号保存在本机的卡片（`origin` 缺省或为 `mine`）。专家广场下载或更新公开模块，安装之后才能聘用。下载经与 `publish_expert` 相同的 `ctx.expertPublisher` 注册，名单 id 等于公开 slug，`origin` 为 `plaza`。从广场安装的专家不能再上传。宿主保存人设、技能和卡片字段，不执行包里的脚本。工具名仍是本机已经安装的宿主包。

上传使用 `DEEPAGENS_API_KEY`。origin 默认是 `https://claw.deepagens.com`，可以用插件的 `origin` 字段改掉。npm 的 `catalog`、`installEntry` 和 `uninstall` 仍是商店路径。

## Alternatives considered

**把专家放进任务插件沙箱。** 被拒绝：那个沙箱只有 root 能用，而且不能 fetch、不能碰文件系统、不能 require，因此带不了宿主必须登记的人设。

**让包自己声明作者和公开 id。** 被拒绝：自报的作者可以冒充别人，斜杠或大小写混用的 id 也做不了名单 id。作者来自会话，slug 由服务器分配。

**为下载再做一个内存中的 publisher。** 被拒绝：重启之后 `loadPublishedExperts` 会把原来的 publisher 填回去。第二张表会把更新看成部署已经拥有的 id 并拒绝。

## Consequences

每个已登录账号都能上传，下载的专家不必重启就能聘用。敏感内容扫描仍会拒绝包含 `password` 这类词的人设。广场一页最多列出 100 个已发布专家。npm 目录不变。
