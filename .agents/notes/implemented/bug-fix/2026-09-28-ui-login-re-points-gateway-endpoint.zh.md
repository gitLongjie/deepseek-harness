# Agent Note: 登录流程在目录读取被拒时也会重指 deepagens 端点

Status: implemented

[English](2026-09-28-ui-login-re-points-gateway-endpoint.md) | 中文

## 问题

`LoginStore.syncCatalogFromGateway` 在第一处拒绝即返回：`discoverModels` 答 `!ok` 时，整个同步在任何 settings 写入之前中止。而凭据早已迁移——`credentialAdapter.apply` 在同步运行之前就把新签发的 key 与登录网关的 origin 写入存储——于是部署在更换 `loginUrl`（oem.config.json，烤入为 `DSH_CLIENT_LOGIN_URL`）后，登录打到了新网关，`~/.dsh/settings.yaml` 里的 `llm-deepagens.baseURL` 却仍指向上一个网关。Deepagens 部署正是如此：登录端点从本机 claw 网关（`http://localhost:31000`）迁到 `https://claw.deepagens.com` 之后，Models 页仍显示环回地址，每个 deepagens 请求都会带着新网关的 key 打向旧地址。

## 决策

端点无条件跟随登录。登录成功后，`syncCatalogFromGateway` 只要发现存储值不同就写 `llm-deepagens.baseURL = <登录 origin>/v1`，与目录读取成败无关；`models` 写入仍仅在发现成功且清单变化时发生。被拒或失败的发现只记录含 message 的警告，保留已存目录。

## 备选方案

**保持被拒即中止。** 拒绝：凭据与端点描述的是同一事实（这个 key 属于哪个网关），且在同一时刻生效；让一个迁移而另一个停留，是把撕裂状态留给之后的每个请求。

**发现被拒时同时清空已存目录。** 拒绝：过时的模型行是无操作元的元数据（端点恢复应答之前没有请求使用它们），下次成功发现会整表替换；删除只会让选择器无谓变空。

## 后果

- 更换 `loginUrl` 在下次登录（含启动重放）即对路由端点生效，即使网关仍对该签发 key 拒绝 `/v1/models`。
- 对清单不可读网关的登录，现在显示正确的 base 与此前存储的目录，而不是同样的目录配上过时的 base。
- 发现被拒的警告现在在 `llm/model-discovery-rejected` 代码旁携带被包装错误的 message（HTTP 状态与 key 提示），desktop.log 能看到网关自己的裁决。

## 测试

login-models 规格的 settings mock 增加 `storedBaseURL`。"跳过写入"用例同时钉住端点（端点与目录都不变才不写）；新用例证明发现被拒时仅以一条 `set baseURL` 操作重指过时 base 且不触发默认模型采用；发现抛错的用例保持登录与存储状态不变。
