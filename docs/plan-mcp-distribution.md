# Genable Figma MCP 分发计划 —— 讨论记录

**日期**：2026-05-08
**起因**：用 genable httpBridge 把 anycast iOS app 里没有 Figma 设计稿的界面（Profile sheet、Inbox empty state、Welcome、Login、Paywall、Audio Settings、Speed sheet、Transcript、Search empty、ShowDetail loading、History section、ClearAllButton）反向构建成可编辑的 Figma 节点。期间发现 genable 这套工具在「代码 → Figma」场景下比官方 Figma MCP 强很多，开始讨论能否把它做成可分发的 MCP。

---

## 一、用户需求

1. **核心定位**：genable httpBridge 实战中比 Figma 官方 MCP 更好用，至少在「写 Figma」这条路上是。希望把它打成可分发的 MCP，让其他人也能用。

2. **痛点观察**：Figma 官方 MCP 必须停留在桌面 app 当前打开的 page 上才能读节点 —— 一旦切到别的 page 之前的引用就失效。这个限制对实际工作流伤害很大。

3. **理想态**：能否做一个**不依赖 Figma 插件**的方案？让用户不用装 plugin、不用桌面 app 在前台，纯通过 MCP 就能读写 Figma 文件。

---

## 二、我的理解与判断

### 2.1 genable httpBridge vs Figma 官方 MCP（实战对比）

| 维度 | Genable httpBridge | Figma 官方 MCP |
|---|---|---|
| **写画布** | ✅ 任意 plugin API JS（createFrame / createText / setRangeFontName / createInstance...） | ❌ 几乎没有写工具，read-only 为主 |
| **读画布结构** | ✅ `inspect` / `find_nodes`，支持模糊查 name/type | ✅ `get_metadata` / `get_design_context`，输出更结构化 |
| **代码生成** | ⚠️ 需自行解析 | ✅ `get_design_context` 直接返 React/Vue/Swift 代码 |
| **截图** | ✅ 通过 plugin export | ✅ `get_screenshot`（但有 render 缓存问题） |
| **跨 page 操作** | ✅ `figma.getNodeByIdAsync` 跨 page 取节点（dynamic-page 已开） | ⚠️ 默认绑定 active page，没暴露 `setCurrentPageAsync` 工具 |
| **依赖** | Figma desktop + 自家 plugin | Figma desktop（plugin 形式，但官方维护） |

**结论**：两者其实**互补**，不该当替代品看。

- 官方 MCP 解决「Figma → 代码」（设计稿生成可粘贴代码）
- genable 解决「代码 → Figma」（建节点、改节点、查节点）+ 灵活的 plugin API 调用

这次 session 实际是两个一起用的：官方 `get_screenshot` 验视觉，genable `use_figma` 写节点。

### 2.2 「active page 限制」澄清

这个限制**不是 MCP 层引入的，是 Figma plugin API 本身**：
- `figma.currentPage` 决定默认作用域
- 跨 page 访问需要 `loadAllPagesAsync()`，且要 plugin manifest 开 `"documentAccess": "dynamic-page"`
- Genable plugin 默认开了 dynamic-page，所以 `getNodeByIdAsync` 能跨 page。官方 MCP 也支持，但没暴露 `setCurrentPageAsync` 工具，所以**用户感知**是"必须停在当前页"。

修这个**不需要换架构**，只要在 MCP 暴露一个 `switch_page(pageId)` 工具就行。

### 2.3 「不依赖插件」的可行性

| 路径 | 读 | 写 | 评价 |
|---|---|---|---|
| **Figma REST API**（`api.figma.com`） | ✅ | ❌ | 没有写画布的 endpoint。Figma 把画布写操作完全留给 plugin runtime，REST 只开放 comments / library / variables / webhooks 这些边角。这是**故意的设计**——画布写要走 multiplayer CRDT，REST 一致性模型搞不定。 |
| **反向工程 multiplayer 协议** | ✅ | ✅（理论上） | Figma 客户端之间用 WebSocket + CRDT 同步 op，理论上能伪造 client 推 op。**不建议**：协议未公开、ToS 灰区、Figma 一升级就废、客户用着一旦封号难收场。 |
| **服务端 headless Figma + plugin**（Puppeteer 跑 web 版 Figma） | ✅ | ✅ | 用户端确实不用装 plugin 了，但：(a) 你接管了用户的 Figma 会话，安全/合规风险大；(b) 单 session 同时只能停一个文件，多用户并发要开多个 headless 实例，云成本起飞；(c) plugin 没消失，只是从用户机器挪到你机器，复杂度反而升高。 |

**结论**：**「写 + 不要插件」这两个属性 Figma 平台层面就互斥**，等于跟平台对着干。代价不值得。

### 2.4 务实建议

**不要试图消除 plugin 依赖，把它做到无痛即可**：

1. **plugin 上 Figma Community**，让用户一键 Install
2. **plugin 启动时自动开本地 server**（就是现在 httpBridge 干的事），把端口暴露给 MCP
3. **MCP 包发到 npm**（如 `@genable/figma-mcp`），用户在 `.mcp.json` 加一行就用上
4. **体验上等价于"零依赖"**——用户感知就是装个 MCP，自动配好了

这条路也是 Figma 官方 MCP / Code Connect Companion 走的路。**他们也没消除插件，只是让用户察觉不到**。

**纯 read MCP 倒是可以彻底去插件**：包一层 REST API + 语义化的 `get_design_context`，差不多就是 Figma 官方 MCP 的早期版本。但 genable 的核心价值（**写 Figma**）做不了，跟官方功能就重叠了，意义不大。

---

## 三、若要往 distributable MCP 推进，剩下的事

按现状（`tools/mcp-server/index.ts` 已经是 STDIO MCP，plugin 默认连 3458 WS）评估，离公开发布还差：

1. **拆包 + 发 npm**
   - 把 `tools/mcp-server/` 拆成独立 package（`@genable/figma-mcp` 或类似）
   - 入口提供 `npx` 启动方式

2. **plugin 上 Figma Community**
   - 现在是 dogfood 状态，需要打磨 PUBLISH_METADATA.md 里写的发布材料
   - plugin 启动时自动握手，告诉 MCP 哪个端口可用

3. **稳定 tool schema**
   - 现在 `js` / `inspect` / `find_nodes` / `jsx` 是内部 API，对外要冻结接口和参数
   - 加 `switch_page(pageId)` 修官方 MCP 的痛点
   - 给 `js` 加更严格的 sandbox 说明（`figma.root` 被禁等限制写到工具描述里）

4. **写"读 vs 写"清晰边界文档**
   - 让用户知道：装 genable MCP = 写 Figma，装官方 MCP = 读 Figma 生代码
   - 两者**推荐成对装**，不是替代关系

5. **品牌定位**
   - tagline 候选：「The write-side complement to Figma's official MCP」
   - 主战场：「从代码反推 Figma 设计」、「把已实现的 UI 回灌到设计稿」、「批量改 Figma 节点」

---

## 四、用户决策（2026-05-08 已定）

- [x] **启动 distribution 路线**（dogfood 继续，distribution 并行推进）
- [x] **包名定调**：
  - npm 主包：`genable-mcp`（已 verify 可用）
  - npm scope 防御占用：`@genable`（已 verify 可用，留作未来矩阵 `@genable/sketch-mcp` 等）
  - Figma plugin 名：沿用 **Genable**（已上 community 多次更新，不改名）
- [x] **聚焦「写」—— Complement 定位**：搭档 Figma 官方 MCP，不替代。读功能保留（agent-friendly），但不与官方 code-gen 竞争。Tagline 候选 "the write-side complement to Figma's official MCP"。
- [x] **Sandbox 暴露：Tier C 双层**：
  - 默认推荐 36 个高阶工具（`jsx`、`set_text`、`bind_variable`...）
  - `js` 工具标 `[advanced]` + 描述显式列沙箱限制（`figma.root` 禁用、跨 page 需 `loadAllPagesAsync`、SF Pro 零宽 etc）
  - 高阶工具内部主动包字体回退、`loadAllPagesAsync` 等 sharp edges

---

## 五、追加决策（2026-05-08 讨论中产生）

- [x] **同一 plugin 双模式**（非 fork）—— UI 加 mode toggle，bridge 模式下显示最小连接指示器 "Connected · file: X"。理由：plugin 已上 community 有装机量，fork = 劈分用户库。
- [x] **单 GitHub repo**（非分仓）—— 当前 dogfood repo 清理后改公开，npm 包仅打包 `tools/mcp-server/` 必需文件。理由：MCP 与 plugin lockstep 演进，分仓会无意义增加协调成本。

## 六、Punch list（按依赖顺序）

| # | 工作 | 状态 | 备注 |
|---|---|---|---|
| **P0-1** | **拆包 / decouple** —— build 时序列化 `unifiedTools` schema 为 JSON 打进 npm 包 | ✅ 完成 | `tools/mcp-server/extract-schema.ts` + 独立 `package.json`/`tsconfig.json`。npm pack 23KB / 7 files / 无 src 耦合。**踩坑**：root 下有 18 个 stale `.js`（旧 tsc 产物）shadow `.ts`，导致 module resolution 走错版本——已删，加进 .gitignore |
| **P0-2** | 加 `switch_page` 工具 | ✅ 完成 | `pageTool.ts` + `ipc/commands/index.ts` 的 inline handler。支持 `pageId` / `name`（精确→子串），返回 full pages roster + previousPage 元数据，每次调用一次即可。schema 39 个工具 |
| **P0-3a** | js 工具 [advanced] + sandbox 限制文档化 | ✅ 完成 | `[advanced]` 前缀；显式列 `figma.root` 限制、跨 page async、frozen arrays、font load、SF Pro 零宽、parser-error bisect |
| **P0-3b** | 其他工具描述补 cross-page / font caveats | ✅ 完成 | `find_nodes` 描述加"call switch_page first if elsewhere"。其他工具走 pathResolver 的 `getNodeByIdAsync` 自动跨 page，font load + Regular fallback 在 `FontBus.ts` 已包，外用户透明 |
| **P0-3c (deferred)** | SF Pro → Inter family-level auto-fallback | ⏭️ deferred to v0.2.0 | **现状**：FontBus 只 fallback failed style → Regular，**不**处理 SF Pro 这种 "load 成功但渲染零宽" 的家族级 bug。jsTool 描述里有警告，LLM 会撞但能从警告里学。**不修理由**：dogfood 没人抱怨过、修了反而引入"我要 SF Pro 怎么给我 Inter"的潜在投诉。等真有外部用户反馈再上 ToolWarning 方案 |
| **P0-4** | plugin bridge mode UI | ⏭️ 撤销 | `useMcpBridge` 一直在后台跑（计划里"mode toggle"是错觉，无需切换）。曾尝试加 Header MCP badge，review 时判定边际价值不抵 UI 复杂度——**撤回**。`useMcpBridge` 调用从 useChat 上移到 PluginContent（小重构，避免在 hook 里调用副作用、保留为未来需求做准备） |
| **P0-5** | `npx genable-mcp` 入口 + publish 流水线 | ✅ 完成 | shebang + bin entry verified。本地 `npm pack` + `npm install <tarball>` 全链路通，npx 入口跑出 stdio + WS 3458。LICENSE 加 |
| **P1-1** | README + 边界文档 | ✅ 完成 | `tools/mcp-server/README.md` —— Complement 定位、Claude Code/Cursor 配置示例、配套官方 MCP 推荐、39 工具 one-liner index、limitations |
| **P1-2** | community page 更新文案 | 🔜 用户操作 | 待 v0.1.0 真发布后，用户在 Figma Community 后台更新 description |

**推进顺序实际值**：P0-1 → P0-2 → P0-3a → P0-3b → P0-4 → P0-5 → P1-1。单线推进，每步 typecheck + check:prompts 验证。

## 七、npm 占名命令（待人类执行）

```bash
# 0. 一次性：在 npmjs.com 网页建 org "genable" —— 已完成 ✅
# https://www.npmjs.com/org/create

# 1. 登录 npm
npm whoami || npm login

# 2. 发布主包
cd tools/mcp-server
npm run build                           # 验证 dist 干净
npm pack --dry-run                      # 看 7 文件 / ~23KB
npm publish --access public             # ← 真发布

# 3.（可选）发个 placeholder 占住 @genable/figma-mcp
# 用临时目录单独 publish 一个 0.0.1 stub 即可
```

**版本策略建议**：
- `0.0.1` 现在不发——版本号一旦发出去就有信用，先内部稳定 1-2 周
- `0.1.0` 第一次公开发布，标"alpha / breaking changes possible"
- `0.x.y` 阶段允许 schema breaking，按需 minor bump
- `1.0.0` 等用户反馈进来 + schema 冻结一段时间后再发

## 七、npm 占名命令（待人类执行）

```bash
# 前置：登录 npm（如未登录）
npm whoami || npm login

# 1. 在 npmjs.com 网页建 org "genable" —— 锁定 @genable scope
# https://www.npmjs.com/org/create
# org name: genable, plan: Free

# 2. 占 genable-mcp 主名 —— 待 P0-1 完成、独立 package.json 就绪后执行
cd tools/mcp-server   # 或 P0-1 重组后的目录
npm publish --access public --dry-run   # 验证打包内容
npm publish --access public              # 0.0.1 placeholder
```

## 八、本次 session 产出（参考素材）

在 ancast-v2.0 Figma 文件「📋 Implemented Index」页 → 「Anycast v2.0 References」section 用 genable 建了 12 个可编辑节点（11 屏 + 1 子组件 + 1 按钮组件），全程没动 Figma 桌面 app（除了首次需要切到 v2.0 page）。详情见 anycast 项目 session memory。

整个流程踩到的两个工具层 issue 也记录到 anycast 的 memory：
- `feedback_figma_sfpro_zerowidth.md` —— SF Pro 在 plugin sandbox 里 loadFont 成功但渲染零宽，必须用 Inter
- `feedback_genable_http_bridge.md` —— port 3458/3461 的关系、fileKey churn、sandbox 限制

这两个坑都属于「genable 包装层应该把 sharp edges 包掉」的范畴 —— 如果做 distribution 版本，应该在工具层把字体回退、跨页加载这些自动处理掉。
