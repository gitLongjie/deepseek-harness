# dsh-wechat — 个人微信桌面端工具插件

DeepSeek Harness 插件：把本机登录的**个人微信**（PC 客户端 4.1.12+）的能力直接注册为模型工具，不依赖 MCP。

| 工具 | 能力 | 数据来源 |
| --- | --- | --- |
| `wechat_doctor` | 健康自检（账号 / 数据库 / 发送侧窗口状态） | — |
| `wechat_contacts` | 全量通讯录（好友 / 群 / 公众号，分页 + 关键词） | 本地 contact.db 解密 |
| `wechat_group_members` | 指定群成员列表（含群主标记） | 本地 contact.db 解密 |
| `wechat_messages` | 指定会话最近消息 / `since_seq` 增量消息 | 本地 message_*.db 解密 |
| `wechat_send` | 主动发文本给联系人 / 群 | UIA + OCR 驱动微信窗口 |

## 架构

```
harness host ── ctx.tools.register ── 模型直接调用 5 个工具
   └─ dsh-wechat/index.mjs（Cordis 插件）
        └─ python service/wechat_service.py（stdio 行 JSON 协议，惰性启动）
             └─ wechatauto-replica（Apache-2.0，E:\wechatauto-replica）
                  └─ 本机微信 4.1.13.65
```

- 读侧：解密本地微信数据库，不碰界面、可后台、对微信小版本不敏感。
- 发送侧：热激活 Qt accessibility gate 后 UIA + OCR 驱动窗口，**要求交互桌面会话**
  （服务、已断开的 RDP 中必然失败），且微信窗口未最小化到托盘。
- 侧车进程按需启动、调用串行化、读侧超时 90s / 发送 300s、插件卸载时回收。

## 前置条件

1. Windows 10/11 + 微信 4.1.12+ 已登录（读侧不要求窗口可见）。
2. Python 3.10+ 在 PATH（或通过配置指定），并安装依赖：

```sh
python -m pip install wechatauto-replica
```

## 安装

```sh
dsh plugin --profile web add --save-exact E:/deepseek-harness/dsh-wechat
```

重启 `dsh web`（或 Desktop）后，模型即可看到 5 个 `wechat_*` 工具。

可选插件配置（profile 的 `cordis.patch.yml` / `cordis.yml`）：

```yaml
- id: dsh-wechat
  name: 'dsh-wechat'
  config:
    python: 'C:/Python312/python.exe'   # 缺省 'python'；也可用环境变量 DSH_WECHAT_PYTHON
    # serviceScript: <path>             # 缺省随插件目录的 service/wechat_service.py
```

## 验证

```sh
node --test test/*.test.mjs        # 协议层单测（不需要微信）
```

真机链路（需要微信在线）：

```sh
node --input-type=module -e "
import { createSidecar } from './index.mjs';
const s = createSidecar();
console.log(await s.call('wechat_doctor', {}));
await s.dispose();"
```

发送自验（在交互桌面终端里，发给"文件传输助手"自聊）：

```sh
python -m wechatauto 发 "测试" --to 文件传输助手 --verify
```

## 使用形态（模型侧）

- **成员列表**：`wechat_contacts(kind='person'|'group'|'official', keyword, page, page_size)`
- **重点关注某人/群**：`wechat_messages(chat='张三')` → 记录最大 `seq`，之后
  `wechat_messages(chat='张三', since_seq=<seq>)` 增量拉取；**轮询间隔保持数十秒以上**，
  秒级轮询会触发微信风控强制下线。
- **主动交流**：`wechat_send(to='张三', text='...')`。

## 后台 / 托盘 / 最小化场景的发送

`wechat_send` 在发送前会自动恢复微信主窗口，三种"后台"状态均已实测支持：

| 窗口状态 | 处理方式 |
| --- | --- |
| 收进系统托盘（窗口隐藏） | 直接对原窗口 `ShowWindow(SW_RESTORE)` 恢复（按类名 + 尺寸识别主窗口，排除 296×388 登录窗） |
| 最小化到任务栏 | `IsIconic` 识别（最小化时 GetWindowRect 只有 160×28 图标尺寸）后恢复 |
| 被其他窗口遮挡 | 无需处理：wechatauto 发送路径自带 `bring_to_front` 置顶抢前台 |

恢复后正常走 OCR + 模拟输入，发送瞬间（约 2-4 秒）微信窗口会出现在前台。
**不会**重新拉起 `Weixin.exe`——已验证该做法会弹出多余的新登录窗口而不是唤醒已登录实例。
真·零打扰后台发送（窗口完全不出现）需要换 hook/协议路线，有封号风险，不支持。

## 自动回复（监听 + 回复闭环）

在 profile 的 `cordis.patch.yml` 里开启（默认关闭）：

```yaml
- id: dsh-wechat
  name: 'dsh-wechat'
  config:
    autoReply:
      enabled: true
      chats: ['张三', '产品交流群']   # 要监听的会话：昵称/备注/wxid/群号
      pollIntervalMs: 30000          # 轮询间隔，最低 20000（微信风控红线）
      # groupOnlyWhenMentioned: true # 群聊只回复被 @自己昵称 的消息（默认 true；私聊不受影响）
      # agentPreset: my-preset       # 每个聊天独立 harness 会话使用的 Agent Preset
      # workspace: D:/path           # 会话工作区（默认 ~/.dsh/dsh-wechat/autoreply）
      # promptHeader: |              # 注入的回复指令（有默认值）
      #   你是……
```

工作机制：

1. 插件按 `pollIntervalMs` 轮询监听名单的**增量消息**（`since_seq` 水位，跳过自己发出的消息防回环）；
   启动后第一轮只建立基线，**不回复历史消息**。
2. 有新消息时，把消息文本（群消息的 XML/表情自动摘要为一行）注入该聊天**专属的 harness 会话**
   （经 Host 进程内的 typertGateway：`session.create` / `session.prompt` / 轮询 `session.history` 取最终回复）。
3. 模型回复正文通过 `wechat_send` 发回该聊天（发送前自动恢复微信窗口，见上文后台说明）。
4. 回复超时默认 10 分钟；单聊天回复失败只记日志，不影响其他聊天和后续轮询。

要求与注意：autoReply 需要 Host 加载 `typertGateway` 服务（dsh web / desktop profile 均满足）；
模型路由可用（无可用模型时轮询照跑、回复失败记日志）。**不要**把 `pollIntervalMs` 调到 20 秒以下。

## 编码说明

Node 宿主与 Python 侧车之间的 stdio 协议**强制 UTF-8**（双侧钉死：插件 spawn 注入
`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`，服务入口对 stdin/stdout/stderr `reconfigure`）。
Windows Python 在无 UTF-8 环境变量的宿主进程（Electron/dsh host）下管道默认 GBK，
不钉死则中文参数与结果全部 mojibake（发送乱码、读消息乱码）。

## 风险与边界

1. 读侧解密本地库属灰色地带（微信 2025-04 公告打击"违规获取终端用户数据"的工具）：
   仅读取本人账号数据、控制频率、不外传。
2. 发送侧会向 `Weixin.dll` 写一个字节打开 accessibility gate（等效无障碍开关，
   微信重启后归零），随后 OCR + 模拟输入驱动窗口；操作期间不要抢鼠标。
3. 少数账号在任何版本都不暴露 UIA 树（发送侧不可用）；读侧不受影响。
4. 微信小版本更新可能使发送侧需要 wechatauto 更新（RVA 表）；读侧对版本不敏感。

## 文件

- `index.mjs` — Cordis 插件（工具注册 + Python 侧车管理）
- `service/wechat_service.py` — stdio 行 JSON 服务（工具实现）
- `test/sidecar.test.mjs` — 协议层单测
