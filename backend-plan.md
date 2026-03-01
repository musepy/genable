# Figma AI Generator — 后端商业化方案

## 1. 整体架构

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────┐
│  Figma 插件      │────→│  Cloudflare Worker        │────→│  Gemini API  │
│  (用户客户端)     │←────│  (你的后端服务)             │←────│             │
└─────────────────┘     └──────────────────────────┘     └─────────────┘
                              │
                        ┌─────┴──────┐
                        │  KV 存储    │  用户数据、用量记录
                        └────────────┘
```

### 当前流程（不安全）
- 插件直接调用 Gemini API
- API Key 暴露在客户端
- 无法控制用量、无法收费

### 目标流程
- 插件 → Worker（验证身份 + 转发请求）→ Gemini API
- API Key 安全存储在 Worker 环境变量中
- 用户通过订阅 Token 访问

---

## 2. 第一步：Cloudflare Worker（API 代理）

### Worker 功能
1. **接收插件请求** — 接收 Gemini 格式的请求
2. **验证用户身份** — 检查 Authorization header 中的 token
3. **转发到 Gemini** — 使用服务端 API Key 调用 Gemini API
4. **流式响应** — 支持 SSE 流式传输（你的插件使用 streaming）
5. **记录用量** — 写入 KV，按用户统计调用次数

### 需要的 Cloudflare 资源
| 资源 | 用途 |
|------|------|
| Worker | API 代理服务 |
| KV Namespace | 存储用户 token、用量记录 |
| 环境变量 (Secrets) | 存储 Gemini API Key |

### Worker 端点设计
```
POST /api/generate          — 流式生成（对应 generateContentStream）
POST /api/generate-sync     — 非流式生成（对应 generateContent）
GET  /api/models            — 获取可用模型列表
POST /api/validate-token    — 验证用户 token 是否有效
GET  /api/usage             — 查询当前用量
```

### 插件端改动
- 新增一个 `ProxyProvider`，与 `GeminiProvider` 接口一致
- 设置界面增加"使用云端服务"选项
- 用户输入订阅 Token（替代 API Key）

---

## 3. 第二步：用户认证

### 方案：简单 Token 认证
- 用户付费后，生成一个唯一 Token（UUID 格式）
- Token 存储在 KV 中，关联用户信息和订阅状态
- 每次请求在 Header 中携带：`Authorization: Bearer <token>`

### KV 数据结构
```json
// Key: "user:<token>"
{
  "email": "user@example.com",
  "plan": "pro",
  "status": "active",
  "created_at": "2026-03-01",
  "expires_at": "2026-04-01"
}

// Key: "usage:<token>:2026-03"
{
  "calls": 150,
  "tokens_used": 500000,
  "last_call": "2026-03-01T10:30:00Z"
}
```

---

## 4. 第三步：支付系统（Stripe）

### 流程
```
用户访问你的网站 → 选择套餐 → Stripe 支付 → Webhook 通知 Worker → 生成 Token → 用户拿到 Token → 在插件中输入
```

### 需要额外搭建
1. **落地页/官网** — 展示产品、定价，引导付费（可以用 Cloudflare Pages）
2. **Stripe 集成** — 处理支付和订阅
3. **Webhook Handler** — Worker 接收 Stripe 回调，自动创建/续费用户

---

## 5. 第四步：定价策略

### 成本估算（Gemini 2.5 Flash）
| 项目 | 价格 |
|------|------|
| 输入 Token | $0.15 / 100万 tokens |
| 输出 Token | $0.60 / 100万 tokens |
| 单次设计生成（约5轮对话） | 约 $0.01 - $0.05 |

### 建议定价（参考）
| 套餐 | 月费 | 包含 | 适合 |
|------|------|------|------|
| Free | $0 | 10次/月 | 试用 |
| Pro | $9.99/月 | 200次/月 | 个人设计师 |
| Team | $29.99/月 | 1000次/月 | 团队 |
| Unlimited | $49.99/月 | 无限次 | 重度用户 |

> 注意：以上价格仅为参考，需要根据实际 API 成本和市场调研调整。

### 用量控制逻辑
- Worker 每次请求前检查 KV 中的月度用量
- 超额后返回 429 错误，提示升级
- 月初自动重置计数

---

## 6. 实施路线图

### Phase 1 — 基础代理（1-2天）✅ 可以立即开始
- [ ] 创建 Cloudflare Worker
- [ ] 实现 Gemini API 代理（含流式）
- [ ] 用环境变量存储 API Key
- [ ] 创建 KV Namespace
- [ ] 简单 Token 验证
- [ ] 插件端添加 ProxyProvider

### Phase 2 — 用量控制（1天）
- [ ] KV 记录每次调用
- [ ] 按月统计用量
- [ ] 超额限流
- [ ] 用量查询接口

### Phase 3 — 支付集成（3-5天）
- [ ] 搭建官网/落地页
- [ ] 集成 Stripe
- [ ] Webhook 自动开通
- [ ] Token 管理后台

### Phase 4 — 上线运营
- [ ] 域名和 SSL
- [ ] 监控和告警
- [ ] 用户反馈渠道
- [ ] 迭代定价

---

## 7. 技术选型总结

| 组件 | 技术 | 原因 |
|------|------|------|
| API 代理 | Cloudflare Worker | 全球加速、按量计费、免运维 |
| 数据存储 | Cloudflare KV | 与 Worker 无缝集成、低延迟 |
| 支付 | Stripe | 行业标准、支持订阅 |
| 官网 | Cloudflare Pages | 免费、与 Worker 同账户 |
| 域名 | Cloudflare DNS | 统一管理 |
