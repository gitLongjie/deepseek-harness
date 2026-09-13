---
name: geo-brand-pricing
description: GEO（生成式引擎优化）品牌客户报价与结算方法论。串联 AIVO 可见度诊断、发文成本模型与 AI 搜索可见度系数折算，输出品牌客户 GEO 结算报价速查表。Use when 用户提到 GEO 报价、GEO 结算报价、AI 搜索可见度报价、品牌 GEO 服务定价、AIVO 诊断、可见度系数、发文成本、报价速查表、生成式引擎优化收费、AI 可见度优化报价 — even if they only say "帮这个品牌报个价" or "GEO 收多少钱".
---

# GEO 品牌客户报价技能

把「品牌当前在 AI 搜索里的可见度」和「要达到的目标可见度」之间的差距，折算成一份可结算的报价速查表。三个输入决定价格：AIVO 诊断出的当前可见度、客户的发文成本表（rate card）、可见度提升目标。

## 核心公式

```
月度报价 = N篇 × 单篇成本 C_post × 可见度系数 k_vis × 行业难度系数 k_comp
          + 月度 AIVO 监测费 C_monitor
k_vis = 1 + α × (V_target − V0) / 100        # α 默认 0.8，来自 rate card
V     = Σ_e w_e × 100 × 引擎e被引样本数 / 引擎e探测样本数   # 0–100
```

所有默认数字都是**可改假设**，操作者的 rate card 永远优先。输出报价时必须附「报价假设」区块列出实际采用的每个参数值。

## 工作流程

### Step 0 — 收集输入，先找 rate card

必需要素：品牌名、行业、目标关键词/品类问题、目标 AI 引擎清单、服务周期、目标可见度（客户没给就按行业分档建议）。
先问一句（或查工作目录）是否已有本操作者的 rate card（含写作单价、渠道价、监测费）。有就用它；没有才落到 `assets/rate-card.template.yaml` 的默认值，并在报价中声明。

### Step 1 — AIVO 可见度诊断

读 [references/aivo-diagnostic.md](references/aivo-diagnostic.md) 后执行：按引擎 × 品类问题集探测品牌被引用情况，算出当前可见度 V0（0–100）与分档等级。工具受限无法直连某引擎时，标注「抽样受限」并用可得证据估计，不许静默编造探测结果。

### Step 2 — 发文成本核算

读 [references/pricing-model.md](references/pricing-model.md)。单篇成本 = 写作 + GEO 优化 + 发布分发 + 复稿维护，按客户选的篇幅/渠道档位从 rate card 取值。

### Step 3 — 可见度系数折算

`k_vis` 把可见度差距变成价格乘数：起点越低、目标越高，单价越高。`k_comp` 按行业竞争强度取 0.9–1.5。两档系数的取值表和完整算例都在 pricing-model.md。

### Step 4 — 输出结算报价速查表

按 [references/quote-table.md](references/quote-table.md) 的模板输出：套餐档位（基础/进阶/领先）× 月发文量 × 目标可见度 × 系数 × 单价 × 月度报价 × 结算方式，末尾固定跟「报价假设」区块（列全 V0、V_target、k_vis、k_comp、各成本科目取值及其来源）。

## 硬性要求

- 报价表里的每一个数字都要能溯源到 rate card 条目或诊断证据；两者都没有的数字不得出现。
- 探测不到的引擎单独标注，不混入 V 值加权。
- 报价假设区块不可省略——这是报价可结算（对账、退费争议）的依据。
