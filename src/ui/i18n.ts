/**
 * @file i18n.ts
 * @description Simple internationalization system with browser language detection
 */

export type Locale = 'en' | 'zh';

const translations = {
  en: {
    // Theme
    followSystem: 'System',
    light: 'Light',
    dark: 'Dark',
    clickToFollowSystem: 'Click to follow system',
    themeLabel: (theme: string) => `Theme: ${theme}`,
    
    // Actions
    newDesign: 'New Design',
    
    // Placeholder
    placeholder: 'Describe your task, mention @context, or use /commands...',
    
    // Empty state
    emptyStateHint: 'Pick a suggestion below or describe your design',
    
    // Feedback messages
    createdDesign: (type: string, count: number) => `Created ${type} design (${count} elements)`,
    designCreated: (count: number) => `Design created (${count} elements)`,
    
    // UI Controls
    showRaw: 'Show Raw',
    hideRaw: 'Hide Raw',
    newMessages: 'New messages',

    // Errors - Structured Tokens
    errors: {
      unauthorized: {
        title: 'Invalid API Key',
        message: 'Please check your API key settings.',
        action: 'Check API Key',
      },
      notFound: {
        title: 'Model Not Available',
        message: 'The selected model may be offline or renamed.',
        action: 'Change Model',
      },
      rateLimit: {
        title: 'Rate Limit Exceeded',
        message: 'You are making requests too quickly.',
        action: 'Retry Later',
      },
      serverError: {
        title: 'Server Error',
        message: 'An internal error occurred on the server.',
        action: 'Retry',
      },
      network: {
        title: 'Network Error',
        message: 'Please check your internet connection.',
        action: 'Retry',
      },
      malformedFunctionCall: {
        title: 'Malformed Response',
        message: 'The AI returned an invalid response format.',
        action: 'Retry',
      },
      emptyResponse: {
        title: 'Empty Response',
        message: 'The AI returned no content.',
        action: 'Retry',
      },
      unknown: {
        title: 'Unknown Error',
        message: 'An unexpected error occurred.',
        action: 'Dismiss',
      },
    },
    
    // Prompt Suggestions (icon = Lucide icon name)
    promptSuggestions: [
      { icon: 'LayoutDashboard', title: 'Dashboard', description: 'A metrics scorecard showing 5 row items with columns: "Card Name", "Month", "Quarter", "Year", "Growth" and a trend indicator.' },
      { icon: 'LogIn', title: 'Login Screen', description: 'A clean login form with email and password fields, "Sign In" button, and social login options for Google and Apple.' },
      { icon: 'Settings', title: 'Settings Panel', description: 'A settings panel with toggle switches for notifications, dark mode, and auto-save, plus a color picker for accent color.' },
      { icon: 'User', title: 'Profile Card', description: 'A user profile card with avatar, name, bio, and action buttons for follow and message.' },
      { icon: 'FileText', title: 'Form Layout', description: 'A multi-field form with labels, text inputs, dropdown, and a submit button with validation states.' },
      { icon: 'ShoppingCart', title: 'Product Card', description: 'An e-commerce product card with image, price, rating stars, and add to cart button.' },
      { icon: 'CheckSquare', title: 'Task List', description: 'A to-do list with checkboxes, task names, due dates, and priority indicators.' },
    ],
  },
  zh: {
    // Theme
    followSystem: '跟随系统',
    light: '亮色',
    dark: '暗色',
    clickToFollowSystem: '点击跟随系统',
    themeLabel: (theme: string) => `主题: ${theme}`,
    
    // Actions
    newDesign: '新设计',
    
    // Placeholder
    placeholder: '描述你的任务，使用 @上下文 或 /命令...',
    
    // Empty state
    emptyStateHint: '选择下方建议或描述你的设计',
    
    // Feedback messages
    createdDesign: (type: string, count: number) => `已创建 ${type} 设计 (${count} 个元素)`,
    designCreated: (count: number) => `设计已创建 (${count} 个元素)`,
    
    // UI Controls
    showRaw: '显示原始数据',
    hideRaw: '隐藏原始数据',
    newMessages: '新消息',

    // Errors - Structured Tokens
    errors: {
      unauthorized: {
        title: 'API Key 无效',
        message: '请检查您的 API Key 设置。',
        action: '检查 API Key',
      },
      notFound: {
        title: '模型暂不可用',
        message: '当前模型可能已下线或名称有误。',
        action: '更换模型',
      },
      rateLimit: {
        title: '请求过于频繁',
        message: '请稍后再试。',
        action: '稍后重试',
      },
      serverError: {
        title: '服务器错误',
        message: '服务器发生内部错误。',
        action: '重试',
      },
      network: {
        title: '网络连接失败',
        message: '请检查您的网络连接。',
        action: '重试',
      },
      malformedFunctionCall: {
        title: '响应格式错误',
        message: 'AI 返回了无效的响应格式。',
        action: '重试',
      },
      emptyResponse: {
        title: '响应内容为空',
        message: 'AI 未返回任何内容。',
        action: '重试',
      },
      unknown: {
        title: '发生未知错误',
        message: '发生了意外错误。',
        action: '关闭',
      },
    },
    
    // Prompt Suggestions (icon = Lucide icon name)
    promptSuggestions: [
      { icon: 'LayoutDashboard', title: '仪表盘', description: '包含 "卡片名称"、"月份"、"季度"、"年份"、"增长" 列及趋势指示器的5行指标记分卡。' },
      { icon: 'LogIn', title: '登录页', description: '简洁的登录表单，包含邮箱和密码字段，"登录" 按钮以及 Google 和 Apple 的社交登录选项。' },
      { icon: 'Settings', title: '设置面板', description: '包含通知、暗色模式和自动保存开关的设置面板，以及强调色选择器。' },
      { icon: 'User', title: '个人资料卡', description: '包含头像、姓名、简介以及关注和发消息操作按钮的用户资料卡。' },
      { icon: 'FileText', title: '表单布局', description: '包含标签、文本输入框、下拉菜单以及带验证状态的提交按钮的多字段表单。' },
      { icon: 'ShoppingCart', title: '商品卡片', description: '电商商品卡片，包含图片、价格、评分星级和加入购物车按钮。' },
      { icon: 'CheckSquare', title: '任务列表', description: '包含复选框、任务名称、截止日期和优先级指示器的待办事项列表。' },
    ],
  }
} as const;

/**
 * Detect user's preferred locale from browser settings.
 * Figma follows system language, so this will reflect Figma's UI language.
 */
export const detectLocale = (): Locale => 
  typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en';

/** Current translations based on detected locale */
export const t = translations[detectLocale()];

/** Get translations for a specific locale */
export const getTranslations = (locale: Locale) => translations[locale];
