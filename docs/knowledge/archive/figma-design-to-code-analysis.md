# Figma Design-to-Code (get_design_context) 逆向分析

> 分析日期: 2026-03-18
> 数据来源: 对测试文件 `ExvSLYAdjmpnKrmFeh5fsS` 中 Login Card (202:624) 调用 `get_design_context` 的实际返回

---

## 1. 工具概览

`get_design_context` 是 Figma MCP 的核心 design-to-code 工具。

**输入**: fileKey + nodeId
**输出**:
1. React + Tailwind 代码（函数组件）
2. 截图（节点的视觉渲染）
3. 图片资源 CDN URL（7 天有效）
4. 提示信息（要求适配目标项目技术栈）

**转换发生在 Figma 服务端**，不是客户端脚本。与 capture.js（客户端 DOM→JSON）方向相反。

---

## 2. 属性映射规则

### 2.1 布局 (Auto-layout → Flexbox)

| Figma 属性 | Tailwind 输出 | 说明 |
|------------|--------------|------|
| layoutMode: VERTICAL | `flex flex-col` | |
| layoutMode: HORIZONTAL | `flex` | 默认 row，不输出 flex-row |
| itemSpacing: N | `gap-[Npx]` | 直接映射 |
| primaryAxisAlignItems: MIN | `items-start` | |
| counterAxisAlignItems: STRETCH | `content-stretch` | |
| layoutSizingHorizontal: FILL | `w-full` | 填充父容器 |
| layoutSizingVertical: HUG | `shrink-0` | 内容自适应 |
| layoutSizingHorizontal: FILL + layoutGrow: 1 | `flex-[1_0_0]` | 弹性填充 |
| 无 auto-layout 的固定布局 | `absolute left-[X] top-[Y]` | 绝对定位 |

### 2.2 尺寸

| Figma 属性 | Tailwind 输出 | 说明 |
|------------|--------------|------|
| width == height | `size-[Npx]` | 正方形用 size 简写 |
| width + height | `w-[N] h-[N]` | 非正方形分开 |
| width: 100%, height: 100% | `size-full` | |
| height: 1 | `h-px` | 1px 分割线 |
| minWidth/minHeight | `min-w-px min-h-px` | 最小尺寸约束 |

### 2.3 间距 (Padding)

| Figma 属性 | Tailwind 输出 | 说明 |
|------------|--------------|------|
| paddingLeft == paddingRight, paddingTop == paddingBottom | `px-[N] py-[N]` | 对称时用简写 |
| 四边相同 | `p-[N]` | 统一 padding |

### 2.4 视觉样式

| Figma 属性 | Tailwind 输出 | 说明 |
|------------|--------------|------|
| fills: #FFFFFF (white) | `bg-white` | 识别命名色 |
| fills: #2563eb | `bg-[#2563eb]` | 非命名色用 hex |
| fills on text: #111827 | `text-[#111827]` | 文字颜色 |
| fills on text: white | `text-white` | |
| cornerRadius: 16 | `rounded-[16px]` | |
| cornerRadius: 8 | `rounded-[8px]` | |
| clipsContent: true | `overflow-clip` | |
| strokes: #d1d5db, 1px | `border border-[#d1d5db] border-solid` | 描边→border |

### 2.5 文字 (Typography)

| Figma 属性 | Tailwind 输出 | 说明 |
|------------|--------------|------|
| fontFamily: Inter, fontWeight: 700 | `font-['Inter:Bold',sans-serif] font-bold` | family 带 weight 变体名 |
| fontFamily: Inter, fontWeight: 500 | `font-['Inter:Medium',sans-serif] font-medium` | |
| fontFamily: Inter, fontWeight: 400 | `font-['Inter:Regular',sans-serif] font-normal` | |
| fontSize: 24 | `text-[24px]` | |
| fontSize: 14 | `text-[14px]` | |
| fontSize: 12 | `text-[12px]` | |
| lineHeight: auto | `leading-[normal]` | |
| fontStyle: normal | `not-italic` | 显式标注 |
| textAutoResize: NONE (固定宽高) | `h-[15px] w-[84px]` | 固定尺寸文本框 |
| textAutoResize: WIDTH_AND_HEIGHT | `whitespace-nowrap` | 自适应文本 |
| textAlignHorizontal: CENTER | `text-center` | |

### 2.6 图片/图标

| Figma 属性 | 输出 | 说明 |
|------------|------|------|
| 图片 fill / 矢量图标 | `const img = "https://figma.com/api/mcp/asset/{uuid}"` | 顶部声明常量 |
| 图标容器 | `<div className="size-[24px]"><img src={img} className="absolute size-full" /></div>` | 容器+绝对定位图片 |
| 资源有效期 | 7 天 | CDN 链接会过期 |

---

## 3. 代码结构模式

### 3.1 组件命名
- 取自 Figma 图层名: `Login Card` → `LoginCard()`
- 导出为 `export default function`

### 3.2 节点追溯
每个 DOM 元素带 `data-node-id="202:624"` 和可选 `data-name="Header"`
```jsx
<div data-name="Form Section" data-node-id="202:626">
```

### 3.3 嵌套结构
保留 Figma 图层层级:
```
Login Card (root)
  ├── Header (flex-col gap-8)
  │   ├── Title text
  │   └── Subtitle text
  ├── Form Section (flex-col gap-24)
  │   ├── Email Group (flex-col gap-8)
  │   │   ├── Label
  │   │   └── Input Field
  │   ├── Password Group
  │   ├── Forgot password link
  │   └── Sign In Button
  ├── Social Section (flex-col gap-24)
  │   ├── Divider Group (flex row)
  │   └── Social Buttons Group (flex row)
  └── Footer Section (flex row gap-4)
```

### 3.4 图片资源声明
```jsx
const imgFlatColorIconsGoogle = "https://www.figma.com/api/mcp/asset/2aac250a-...";
const imgRiAppleFill = "https://www.figma.com/api/mcp/asset/3cb40346-...";
```
变量名从图层名 camelCase 化: `flat-color-icons:google` → `imgFlatColorIconsGoogle`

---

## 4. 实际返回示例 (Login Card 202:624)

```jsx
const imgFlatColorIconsGoogle = "https://www.figma.com/api/mcp/asset/2aac250a-...";
const imgRiAppleFill = "https://www.figma.com/api/mcp/asset/3cb40346-...";

export default function LoginCard() {
  return (
    <div className="bg-white content-stretch flex flex-col gap-[32px] items-start
                    overflow-clip px-[32px] py-[40px] relative rounded-[16px] size-full"
         data-name="Login Card" data-node-id="202:624">

      {/* Header */}
      <div className="content-stretch flex flex-col gap-[8px] items-start
                      leading-[normal] not-italic overflow-clip relative shrink-0 w-full"
           data-name="Header" data-node-id="202:625">
        <p className="font-['Inter:Bold',sans-serif] font-bold h-[15px] relative
                      shrink-0 text-[#111827] text-[24px] w-[84px]">
          Welcome Back
        </p>
        <p className="font-['Inter:Regular',sans-serif] font-normal h-[15px] relative
                      shrink-0 text-[#6b7280] text-[14px] w-[199px]">
          Please enter your details to sign in.
        </p>
      </div>

      {/* Form Section */}
      <div className="content-stretch flex flex-col gap-[24px] items-start
                      overflow-clip relative shrink-0 w-full"
           data-name="Form Section" data-node-id="202:626">

        {/* Email Group */}
        <div data-name="Email Group">
          <p>Email Address</p>
          <div data-name="Email Input Field"
               className="bg-white border border-[#d1d5db] border-solid ...
                          px-[16px] py-[12px] rounded-[8px] w-full">
            <p className="text-[#9ca3af]">name@company.com</p>
          </div>
        </div>

        {/* Password Group - 同构 */}

        {/* Forgot password link */}
        <p className="text-[#2563eb] text-[12px]">Forgot password?</p>

        {/* Sign In Button */}
        <div className="bg-[#2563eb] ... rounded-[8px] w-full"
             data-name="Sign In Button">
          <p className="text-white text-center">Sign In</p>
        </div>
      </div>

      {/* Social Section */}
      <div data-name="Social Section">
        {/* Divider: text + two flex-1 lines */}
        {/* Google/Apple buttons: flex row, each flex-[1_0_0] */}
      </div>

      {/* Footer */}
      <div className="flex gap-[4px]" data-name="FooterSection">
        <p className="text-black">Don't have an account?</p>
        <p className="text-[#2563eb]">Sign up</p>
      </div>
    </div>
  );
}
```

---

## 5. 观察到的缺陷

### 5.1 文本固定尺寸溢出
```jsx
<p className="h-[15px] w-[84px] text-[24px]">Welcome Back</p>
```
24px 文字塞进 15px 高、84px 宽的容器 → 截图中 "Welcome Back" 被截断为 "Welc"。
原因: Figma 中该文本节点可能是 textAutoResize=NONE（固定尺寸文本框），转换器忠实还原了固定尺寸但没有处理溢出。

### 5.2 冗余类名
- 几乎所有元素都有 `relative` — 即使没有绝对定位的子元素
- `not-italic` 显式输出 — 实际是默认值，可省略
- `leading-[normal]` — 也是默认值

### 5.3 Input 不是真正的 input
```jsx
<div data-name="Email Input Field">
  <p>name@company.com</p>  <!-- 不是 <input>, 而是文本节点 -->
</div>
```
Figma 的 input 只是视觉模拟（frame + text），转换器不做语义推断。

### 5.4 分割线的两条线
```jsx
<div data-name="Left Line" className="bg-[#e5e7eb] flex-[1_0_0] h-px" />
<div data-name="Right Line" className="bg-[#e5e7eb] flex-[1_0_0] h-px" />
```
Figma 中常见的"文字两侧分割线"模式，转换器忠实还原为两个 div，而不是用 CSS `<hr>` + `::before/::after`。

---

## 6. 与 capture.js (Code→Figma) 的对比

| 维度 | capture.js (Code→Figma) | get_design_context (Figma→Code) |
|------|------------------------|-------------------------------|
| 执行位置 | 客户端 (注入网页的 JS) | Figma 服务端 |
| 源码可见 | 是 (可下载 prettify) | 否 (服务端黑盒) |
| 输入 | 渲染后的 DOM + computed styles | Figma 节点树 (结构化数据) |
| 输出 | JSON (节点树+样式+资源) → POST/剪贴板 | React+Tailwind 代码 + 截图 + CDN URL |
| 样式策略 | 差值提取 (只记非默认值) | 倾向全量输出 (包含默认值如 relative, not-italic) |
| 布局映射 | CSS flex/grid → Figma auto-layout (服务端) | Figma auto-layout → Tailwind flex |
| 语义推断 | 无 (纯视觉还原) | 无 (input 仍是 div+text) |
| 资源处理 | fetch→blob→base64 内嵌 | CDN URL 外链 (7天有效) |
| React 感知 | 有 (__reactFiber 提取组件名/props) | 无 (纯 Figma 节点, 不知道原始框架) |
| 精度 | 高 (从渲染结果捕获) | 中 (固定尺寸文本溢出等问题) |

---

## 7. 对我们插件的借鉴

### 7.1 反向验证闭环
```
我们的插件生成 Figma 设计
  → get_design_context 导出为代码
  → 对比代码中的 Tailwind 类与我们 mk 时传入的属性
  → 自动检测属性遗漏
```

### 7.2 属性映射参考
这份映射表是 **Figma 官方认为的属性→CSS 对应关系**，可以反过来校验我们 executor 的属性翻译是否正确：
- `itemSpacing` → `gap`
- `paddingLeft/Right` → `px`
- `cornerRadius` → `border-radius`
- `layoutSizingHorizontal: FILL` → `width: 100%`
- `clipsContent` → `overflow: clip`

### 7.3 质量检测信号
get_design_context 输出中的固定尺寸文本框 (`h-[15px] w-[84px]`) 暗示 Figma 中该节点 textAutoResize=NONE。
如果我们插件创建的文本本应是自适应的，但 get_design_context 输出了固定尺寸，说明我们的 create 少了 `textAutoResize` 属性。

### 7.4 缺陷即机会
Figma 官方转换器也不做语义推断（input 还是 div）。如果我们做了语义层（从视觉推断出"这是一个 input"），就是差异化优势。
