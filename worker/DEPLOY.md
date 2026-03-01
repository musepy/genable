# Phase 1 部署指南

## 前置条件

```bash
npm install -g wrangler
wrangler login   # 用 Cloudflare 账号登录
```

## 1. 进入 worker 目录

```bash
cd worker
npm install
```

## 2. 设置 Gemini API Key（作为 Secret，不进代码库）

```bash
wrangler secret put GEMINI_API_KEY
# 粘贴你的 Gemini API Key，回车
```

## 3. 部署 Worker

```bash
npm run deploy
```

部署成功后会输出 Worker URL，例如：
```
https://figma-ai-generator.your-subdomain.workers.dev
```

## 4. 验证部署

```bash
# 应返回 401 Unauthorized（说明 Worker 正常运行）
curl -X POST https://figma-ai-generator.your-subdomain.workers.dev/api/validate-token
```

## 5. 手动创建第一个测试 Token（通过 Cloudflare Dashboard 或 CLI）

```bash
# 生成一个 UUID 作为 token（macOS/Linux）
TOKEN=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Token: $TOKEN"

# 写入 KV（替换 <KV_NAMESPACE_ID> 为实际 ID：7b1a845ee3b54021ac3804f3b20428a4）
wrangler kv key put "user:$TOKEN" \
  '{"email":"test@example.com","plan":"pro","status":"active","created_at":"2026-03-01","expires_at":"2027-03-01"}' \
  --namespace-id 7b1a845ee3b54021ac3804f3b20428a4
```

## 6. 验证 Token 有效

```bash
curl -X POST https://figma-ai-generator.your-subdomain.workers.dev/api/validate-token \
  -H "Authorization: Bearer $TOKEN"

# 期望输出：
# {"valid":true,"plan":"pro","email":"test@example.com","usage":{...}}
```

## 7. 在插件中启用 Proxy 模式

在 `AgentOrchestrator` 初始化时传入：

```ts
new AgentOrchestrator({
  providerName: 'proxy',
  workerUrl: 'https://figma-ai-generator.your-subdomain.workers.dev',
  subscriptionToken: '<用户的 Token>',
  modelName: 'gemini-2.5-flash-preview-04-17',
  // apiKey 可留空，proxy 模式不使用
  apiKey: '',
  thinkingLevel: 'low',
  // ...其他选项
});
```

---

## KV 数据结构参考

| Key | 内容 |
|-----|------|
| `user:<token>` | `{ email, plan, status, created_at, expires_at }` |
| `usage:<token>:YYYY-MM` | `{ calls, tokens_used, last_call }` (TTL 35天，月初自然过期) |

## 套餐月额度

| plan | 次数/月 |
|------|---------|
| free | 10 |
| pro | 200 |
| team | 1000 |
| unlimited | 无限 |

---

## 本地开发

```bash
# 本地模拟 Worker（使用真实 KV 绑定）
npm run dev
# Worker 监听 http://localhost:8787
```

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/generate` | 流式 SSE 代理（插件主调用） |
| POST | `/api/generate-sync` | 非流式代理 |
| POST | `/api/validate-token` | 验证 token + 返回用量 |
| GET  | `/api/usage` | 查询当前月用量 |
| GET  | `/api/models` | 获取 Gemini 可用模型列表 |
