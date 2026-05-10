# Genable 定价与商业模式方案

> 基于 2026-04-07 竞品研究

## 一、竞品定价图谱

| 模式 | 代表 | 月费 | 我们的位置 |
|------|------|------|-----------|
| 内置免费 | Figma Make | $0 (含在订阅) | 无法竞争 |
| 完全免费 BYOK | **Genable (当前)** | $0 | ← 在这里 |
| 低价 BYOK | ai.to.design | EUR 12/月 | 唯一直接可比对象 |
| 低价 Freemium | UX Pilot Standard | $14/月 | 70 屏幕/月 |
| 中价 Freemium | UX Pilot Pro / UXMagic | $22-29/月 | 200-480 额度 |
| 高价 Teams | UX Pilot Teams / Motiff | $31-40/seat | 团队功能 |

## 二、当前 "完全免费 BYOK" 的战略分析

### 优势
- **零获客摩擦** — 不需要信用卡、不需要注册、没有额度焦虑
- **BYOK 去除推理成本** — 我们不承担 LLM API 费用，边际成本≈0
- **vs ai.to.design 的唯一优势** — 他们收 EUR 12/月，我们免费
- **vs 所有 Freemium 竞品** — "no subscription, no credits, no limits" 是极强的差异化信息

### 劣势
- **无收入** — 无法支撑持续开发和推广
- **免费 = 不值钱的心理暗示** — 部分用户会质疑质量
- **无法投放广告获客** — 没有 LTV 支撑 CAC

### 结论
**短期保持免费是正确的。** 21 个用户时讨论定价为时过早。当前瓶颈不是变现，是获客。

## 三、分阶段商业化路线

### Phase 0: 冲量 (当前 → 1000 用户)
**策略：完全免费 BYOK，All-in 增长**

- 价格: 完全免费
- 目标: 从 21 → 1000 users
- 动作:
  - 社区页 SEO 优化（标题关键词 + 描述重写 + 素材更新）✅ 已完成
  - 在 "free" 上做强差异化 — 标题/描述显著标注 "Free, no credits"
  - 发布使用案例到 Twitter/X、Figma Community 讨论区
  - 考虑 Product Hunt / HackerNews launch

### Phase 1: 建立 Premium 层 (1000 → 10K 用户)
**策略：Free Core + Premium 增值**

免费层保持不变（BYOK，无限生成），Premium 增加：

| Premium 功能 | 价值 | 定价参考 |
|-------------|------|---------|
| 托管 API（无需自备 Key） | 降低使用门槛 | ai.to.design EUR 12/月 |
| 高级模型路由（自动选最优模型） | 省 API 费用 + 更好质量 | - |
| 设计系统绑定（组件库 + 变量同步） | 企业级需求 | Ugic 差异化卖点 |
| 批量生成（一句话 prompt → N 个变体） | 效率提升 | UXMagic Pro |
| 团队共享上下文 / 品牌预设 | 团队协作 | UX Pilot Teams $31/seat |

**建议价格**: $12-15/月（对标 ai.to.design 的 EUR 12，但包含托管 API 额度）

### Phase 2: 企业层 (10K+ 用户)
**策略：Self-serve Pro + Enterprise**

- Pro: $25/月 — 托管 API + 高级功能 + 优先支持
- Enterprise: $40/seat/月 — SSO、审计日志、自定义模型、SLA
- 参考: UX Pilot Teams ($31/seat)、Motiff Org ($40/seat)

## 四、变现时机的 3 个信号

不要在以下信号出现之前开始收费：

1. **用户自发传播** — 看到 organic 口碑分享（Twitter、Figma Community 评论）
2. **回头率 > 30%** — 有稳定的重复使用人群（不只是试用一次）
3. **功能差距感知** — 用户开始要求更多（"能不能加组件库支持？"、"能不能团队共享？"）

## 五、核心差异化定位

基于竞品分析，我们的独特定位是：

> **"The quality-first AI design generator. Free."**

理由：
- **"Quality-first"** — 所有竞品都在卷速度，没人谈质量。我们有 benchmark 数据证明质量优势（JSX 格式、多维度设计覆盖、inspect→edit 迭代模式）
- **"Free"** — 从竞品的 $12-50/月 中脱颖而出
- 不和 Figma Make 正面竞争原型能力，而是聚焦"高质量 UI 组件生成"

### 不追的方向
- ❌ 不做 Image-to-Design / Screenshot-to-UI（Codia 已占坑）
- ❌ 不做 代码导出（UXMagic 已占坑，且偏离核心价值）
- ❌ 不做 热力图/设计审查（UX Pilot 特色，非核心）
- ❌ 不和 Figma Make 比原型交互能力

### 要做的差异化
- ✅ 生成质量（我们的核心优势）
- ✅ 对话式迭代（多轮 refine，不是 one-shot）
- ✅ 多模型 BYOK（用户选择权）
- ✅ 免费无限制
