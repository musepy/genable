# Figma Variable 多维架构：笛卡尔积 + 稀疏张量

## 背景

个人网站 2.0 项目中，用 Figma Variable 系统实现了 4 角色 × 2 语言 × 2 主题 × 3 断点 = 48 种简历变体，零重复 frame。本文记录这套架构的数学本质和工作流。

## 数学关系：笛卡尔积 + 稀疏张量

每个 Variable Collection 是一个独立的维度轴：

```
最终状态 = Language × Role × Theme × Breakpoint
         = 2 × 4 × 2 × 3
         = 48 种可能的组合
```

每个变量本质上是一个函数：

```
f(language, role, theme, breakpoint) → 具体值
```

但它是**稀疏**的——不是每个维度都影响每个值：

| 变量 | 受哪些维度影响 |
|---|---|
| 姓名 | Language |
| 自我介绍 | Language × Role |
| role | Language × Role |
| visible/凯祺健康 | Role |
| surface (颜色) | Theme |
| circle Visibility | Breakpoint |

## 4 个集合 = 4 个维度轴

| 集合 | Modes | 控制 |
|---|---|---|
| **portfolio** | Chinese, English | 语言（内容数据库） |
| **职业** | 视觉设计师, 平面设计师, 摄影师, UI设计师 | 角色（控制面板） |
| **style** | dark, whit | 视觉主题 |
| **Collection** | desktop, tablet, mobile | 响应式断点 |

## Alias = 维度间的 Join

Figma 的限制：一个集合只能有一个维度的 mode。不能在一个集合里同时表达 `Language × Role`。

**Alias 解决了这个问题**——它是跨维度的外键：

```
职业集合(Role维度)              portfolio集合(Language维度)
┌──────────────────┐          ┌──────────────────────────────┐
│ role ──────────────────alias──→ roles/视觉设计师               │
│   视觉设计师 mode   │          │   Chinese: 产品设计师          │
│   摄影师 mode      │          │   English: Product Designer   │
└──────────────────┘          └──────────────────────────────┘
```

Role 维度选择**指向哪个变量**，Language 维度决定**这个变量返回什么值**。

等价的 SQL：
```sql
SELECT content 
FROM portfolio 
JOIN 职业 ON portfolio.id = 职业.alias_target
WHERE 职业.mode = '摄影师' AND portfolio.mode = 'English'
```

## 具体 Alias 链

```
Basic info/职业 → 职业/role → portfolio/roles/X → 按语言解析
职业/自我介绍 → portfolio/about me/*/自我介绍 → 按语言解析
```

## 变量架构总览

### portfolio 集合 — 内容数据库（Chinese / English）

| 分组 | 变量数 | 作用 |
|---|---|---|
| `EExperience/凯祺健康/` | 6 | 经历1：职位、公司、时间、工作重点×3 |
| `EExperience/城市芭蕾/` | 6 | 经历2 |
| `EExperience/彼客国际旅行/` | 6 | 经历3 |
| `Basic info/` | 10 | 姓名、籍贯、学历、联系方式等 |
| `Skills/` | 11 | 技能列表 |
| `about me/` | 4 | 每个角色一份自我介绍 |
| `roles/` | 4 | 角色名（中英文） |
| `labels/` | 5 | 栏目标题（工作经历/Education 等） |
| `achievements/` | 1 | 荣誉内容 |

### 职业 集合 — 控制面板（4 角色 mode）

| 变量 | 类型 | 作用 |
|---|---|---|
| `role` | alias → `portfolio/roles/*` | 角色名，按语言自动切换 |
| `自我介绍` | alias → `portfolio/about me/*` | 自我介绍，按角色+语言 |
| `visible/凯祺健康` | BOOLEAN | 该角色是否显示此经历 |
| `visible/城市芭蕾` | BOOLEAN | 同上 |
| `visible/彼客国际旅行` | BOOLEAN | 同上 |

## 面向什么问题？

**多变体产出的配置管理**。核心问题：

> 有 N 个独立维度（语言、角色、主题、设备），如何用一套设计生成所有组合的产出？

同构场景：

| 领域 | 问题 |
|---|---|
| 印刷 | 同一本画册，中英日三语 × 精装/平装 |
| SaaS | 同一界面，Light/Dark × Free/Pro × Mobile/Desktop |
| 简历 | 4 角色 × 2 语言 × 2 主题 |
| 电商 | 商品详情页 × 多 SKU × 多地区定价 |

## SOP / 工作流

```
1. 定义维度轴    → 创建 Variable Collection + Modes
2. 填内容层      → portfolio 里按分组填中英文值
3. 建控制层      → 职业集合里用 alias 指向内容 + boolean 控制显隐
4. 生成变体      → 切 mode 组合 = 一份新简历，零重复劳动
5. 扩展          → 加一个角色 = 加一个 mode + 填内容 + 调 boolean
```

## 关键设计原则

1. **维度正交**：每个集合只管一个维度，互不干扰
2. **内容与控制分离**：portfolio 填内容（what），职业 控制编排（which）
3. **Alias 做 Join**：跨维度引用用 alias，不重复数据
4. **稀疏表达**：只在需要的维度上区分值，其余维度共享
5. **零冗余**：48 种变体，0 个重复 frame，切 mode 即切变体

本质上是把 Figma Variable 系统当成一个**小型多维 CMS**——内容和布局分离，维度正交，通过 alias 做 join。
