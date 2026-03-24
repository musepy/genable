# gstack Skill 使用指南

> 版本: v0.9.4.0 | 共 21 个 skill | 2026-03-21

## 核心工作流

| 命令 | 用途 | 触发时机 |
|------|------|----------|
| `/ship` | 发布：合并基分支→测试→审查→CHANGELOG→推送→PR→文档同步 | 代码准备好了、要合并 |
| `/review` | PR 预合并审查：SQL 安全、信任边界、条件副作用 | 合并前最后一道关 |
| `/qa` | 系统化 QA + 自动修 bug（测试→修复→验证循环） | 功能做完想验证 |
| `/qa-only` | 仅报告问题，不改代码 | 只想看 bug 列表 |

## 规划评审（三视角）

| 命令 | 视角 | 适用场景 |
|------|------|----------|
| `/plan-ceo-review` | CEO/创始人：挑战前提、扩大范围、找 10 星产品 | 质疑方向、想更大 |
| `/plan-eng-review` | 工程负责人：架构、数据流、边界 case、测试覆盖 | 大改架构前必跑 |
| `/plan-design-review` | 设计师：评估设计维度 0-10 分，说明如何到 10 | 有 UI 的 plan 审查 |

**推荐顺序**: office-hours（构思）→ ceo-review（方向）→ eng-review（架构）→ design-review（视觉）

## 设计 & UI

| 命令 | 用途 |
|------|------|
| `/design-consultation` | 创建设计系统（美学、字体、颜色、布局、动效），输出 DESIGN.md |
| `/design-review` | 视觉 QA：找间距/层级/AI 感问题，逐个修复并截图验证 |

## 构思 & 回顾

| 命令 | 用途 |
|------|------|
| `/office-hours` | YC 式 Office Hours：验证想法、设计思维头脑风暴。新想法先跑这个 |
| `/retro` | 周回顾：commit 历史、代码质量、团队贡献、gstack 使用统计 |

## 调试 & 安全

| 命令 | 用途 |
|------|------|
| `/investigate` | 系统化调试：调查→分析→假设→实现。铁律：不找到根因不动手 |
| `/careful` | 破坏性命令警告（rm -rf、DROP TABLE、force-push） |
| `/freeze` | 限制编辑到指定目录，防止误改其他模块 |
| `/guard` | 最大安全 = /careful + /freeze |
| `/unfreeze` | 解除 /freeze 限制 |

## 浏览器测试

| 命令 | 用途 |
|------|------|
| `/browse` | 无头 Chromium：导航、截图、表单、断言、响应式。~100ms/命令 |
| `/setup-browser-cookies` | 从真实浏览器（Chrome/Arc/Brave/Edge）导入 cookies |

**常用模式**:
```bash
$B goto <url>           # 导航
$B snapshot -i          # 看所有可交互元素
$B click @e3            # 点击（用 snapshot 返回的 ref）
$B snapshot -D          # diff 看变化
$B screenshot /tmp/x.png # 截图
$B responsive /tmp/layout # 三端响应式截图
```

## 工具

| 命令 | 用途 |
|------|------|
| `/codex` | OpenAI Codex 第二意见：独立审查、对抗性挑战、咨询模式 |
| `/document-release` | 发布后文档同步（README/ARCHITECTURE/CHANGELOG） |
| `/gstack-upgrade` | 升级 gstack |

## 本项目推荐用法

| 场景 | 推荐 skill |
|------|-----------|
| 调试 agent loop / 属性遗漏 | `/investigate` |
| 改完代码验证 UI 预览 | `/qa` + `/browse` |
| 准备合 PR | `/ship`（一键完成测试→审查→PR） |
| 合并前代码审查 | `/review` |
| 大改架构（如重构 executor） | `/plan-eng-review` |
| 周末回顾进展 | `/retro` |
| 新功能构思 | `/office-hours` → `/plan-ceo-review` |
| 操作生产环境/敏感文件 | `/guard` |

## Completeness Principle（Boil the Lake）

gstack 的核心哲学：AI 让完整实现的边际成本趋近于零，所以**永远选完整方案**。

- 写测试？覆盖所有 edge case，不留"以后补"
- 实现功能？处理所有错误路径，不走捷径
- 人力 1 周的事，CC+gstack 30 分钟搞定 — 没理由偷工减料
