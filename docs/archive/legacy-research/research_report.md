# Clawdbot (Moltbot) 深度调研报告

## 1. 核心定义与演进
- **Clawdbot (现更名为 Moltbot)**：这是一个近期（2026年初）在开源码界爆火的**主动式个人 AI 助手**。
- **改名原因**：由于商标原因（推测与 Anthropic 的 Claude 或其他品牌冲突），原名 **Clawdbot** 改为了 **Moltbot**。
- **Clawdbolt/Molbot**：通常是用户对上述项目的拼写变体或简称。目前社区公认的主流名称是 **Moltbot**。

## 2. 核心功能与亮点
Moltbot 被定位为“你的个人 AI 管家”或“AI 雇员”，与 ChatGPT 等对话式 AI 的核心区别在于其**主动性**和**执行力**：

- **主动式工作流**：它不仅是等待指令，还可以设置定时任务。例如，每天早上为你准备一份“晨间简报”（包含时政、推特趋势、待办事项），或者在你睡觉时自主进行深度调研。
- **多平台集成**：你可以通过 WhatsApp、Telegram、Discord、iMessage、Slack 等常用的即时通讯软件与它聊天。
- **落地执行能力**：它运行在你的本地机器或服务器上，可以执行真实指令、读写文件、甚至直接向 GitHub 提交 Pull Request。
- **持久化记忆**：具备跨天、跨月的长期记忆能力，能记住你的偏好、业务背景和个人琐事。
- **扩展性 (Skills & MCP)**：支持通过简单的 Markdown 文件自定义“技能”，并兼容 MCP (Model Context Protocol) 协议，可以轻松接入各种外部工具。

## 3. 技术架构
- **大脑 (Brain)**：默认推荐使用 Anthropic 的 **Claude 3.5/4.0** (Opus/Sonnet) 作为核心推理引擎，但也支持 OpenAI 等其他模型。
- **运行环境**：基于 **Node.js 22+**，支持自托管（Self-hosted），可以运行在 Mac Mini、小型 VPS 或家庭服务器上。
- **数据隐私**：核心数据存储在用户自己的基础设施中，具有极高的隐私安全性。
- **开源情况**：GitHub 关注度极高，短时间内收获了超过 6-8 万个 Star (仓库：`moltbot/moltbot` 或 `openclaw/openclaw`)。

## 4. 常见误区澄清
- **它是 Claude 的官方产品吗？** 不是。它是第三方开发者 (如 Alex Finn 等) 基于 Claude API 开发的开源框架。
- **它与 Siri 有什么区别？** 它是高度可编程的，具备复杂的逻辑推理能力，能处理如“帮我写一个新功能的 PR 并部署到测试环境”这样复杂的任务，而不仅仅是设闹钟或查天气。

## 5. 资源链接
- **GitHub 仓库**：[moltbot/moltbot](https://github.com/moltbot/moltbot)
- **官方文档**：[docs.clawd.bot](https://docs.clawd.bot) 或 [molt.bot](https://molt.bot)
- **社区交流**：Discord 社区非常活跃，用户常分享自定义的 "Skills"。

---
> [!TIP]
> 如果您想开始使用，推荐使用官方的单行安装命令：
> `curl -fsSL https://molt.bot/install | bash`
