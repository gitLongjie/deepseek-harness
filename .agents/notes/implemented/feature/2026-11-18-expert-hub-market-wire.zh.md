# Agent Note：专家中心市场 wire

Status: implemented

[English](2026-11-18-expert-hub-market-wire.md) | 中文

## 问题

专家页需要把可安装的商店条目（`category: "expert"`）做成与 agent-preset roster 分开的类型化目录。没有专用 wire 时，页面无法命名 `ExpertHubCatalog`，也无法在不触达整块市场表面的情况下调用 install/remove，LiveShare 也无法给 Client 装配已挂载的端点分类。

## 决策

交付 `@deepseek-ai/dsh-expert-hub`，作为市场 `expert` 分类在 `expertHub` 命名空间下的 Typert Remote 投影（`catalog`、`installEntry`、`remove`）。由 `dsh-api-remotes` 再导出 `./types`，在 `dsh-client-ui-expert` 中与 roster 专家合并 hub 行，在 LiveShare 中为这三个端点分类，并在 web-app patch 中与 `market-gateway` 并列挂载该网关。

## 考虑过的替代方案

**单独的专家 Service Definition 与本地提供方。** 否决：会在没有第二个需要不同契约的消费方的情况下，重复市场的 install/uninstall。

**仅扩展 `market/*` 给专家页用。** 否决：页面仍需过滤 `market/browse`，也无法拥有稳定的自有类型 `ExpertHubCatalog`。

## 验证

- `packages/market/expert-hub/tests/gateway.spec.ts` 通过 mock 的 `ctx.market` 投影 catalog/install/remove。
- Client 面 LiveShare 完整性包含 `expertHub/catalog|installEntry|remove`。
- `ui-expert` 能对 `@deepseek-ai/dsh-expert-hub/types` 的 `ExpertHubCatalog` 通过类型检查。

## 后果

专家页可以在不导入市场 wire 类型的情况下，把可安装 hub 行与 roster 合并。install 与 remove 仍由 `ctx.market` 拥有；中心只过滤 `expert` 分类，并为该 UI 重命名 wire。安装 wire 名为 `installEntry`，原因与 `market-gateway` 记录的 Remote-client `install` 助手冲突相同。
