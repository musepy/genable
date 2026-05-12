/**
 * @file i18n.ts
 * @description Internationalization system with Preact Context for reactive locale switching.
 *
 * Usage in components:
 *   const t = useTranslations();
 *   return <span>{t.newDesign}</span>;
 *
 * Provider setup (in ui.tsx):
 *   <LocaleContext.Provider value={locale}>
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

// ── Types ──

export type Locale = 'en' | 'zh' | 'fr';
export type LocalePreference = 'auto' | Locale;
export const LOCALES: Locale[] = ['en', 'zh', 'fr'];
export const LOCALE_PREFS: LocalePreference[] = ['auto', 'en', 'zh', 'fr'];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'EN', zh: '中文', fr: 'FR' };
export const LOCALE_PREF_LABELS: Record<LocalePreference, string> = { auto: 'Auto', en: 'English', zh: '中文', fr: 'Français' };
export const LOCALE_FULL_NAMES: Record<Locale, string> = { en: 'English', zh: '中文 (Chinese)', fr: 'Français (French)' };

/** Resolve a preference to an actual locale */
export function resolveLocale(pref: LocalePreference): Locale {
  return pref === 'auto' ? detectLocale() : pref;
}

// ── Preact Context ──

export const LocaleContext = createContext<Locale>('en');

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useTranslations() {
  return translations[useLocale()];
}

// ── Detection ──

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('fr')) return 'fr';
  return 'en';
}

// ── Static access (non-component contexts, tests) ──
// Forward-declared; assigned after `translations` is defined (bottom of file).

export let t: Translations;
export let getTranslations: (locale: Locale) => Translations;

// ── Translations ──

type SuggestionItem = { icon: string; title: string; description: string };
type ErrorItem = { title: string; message: string; action: string };

const en = {
  // Theme
  light: 'Light',
  dark: 'Dark',

  // Header / Navigation
  newDesign: 'New Design',
  settings: 'Settings',
  closeSettings: 'Close Settings',

  // Input
  placeholder: 'Describe your design, or click + to add context.',
  emptyStateHint: 'Pick a suggestion below or describe your design',

  // Onboarding
  buildSomething: 'Build something',
  great: 'great.',
  pasteApiKeyToConnect: 'Paste your API key to connect.',
  getOneFree: 'Get one free',
  connecting: 'Connecting...',
  invalidKey: 'Invalid key.',
  getNewOne: 'Get a new one',
  pasteApiKey: 'Paste API key...',
  storedLocally: 'Stored locally in Figma.',
  detecting: 'Detecting...',
  failed: 'Failed',

  // Settings Panel
  apiKey: 'API Key',
  getFrom: (label: string) => `Get from ${label}`,
  enterApiKey: (provider: string) => `Enter your ${provider} API key`,
  availableModels: 'available models',
  free: 'Free',
  account: 'Account',
  signOut: 'Sign out',
  signOutConfirm: 'Sign out and clear all API keys?',
  language: 'Language',

  // Chat Status
  statusThought: 'Thought',
  statusError: 'Error',
  statusStopped: 'Stopped',
  statusThinking: 'Thinking',
  statusEmptyResponse: 'Empty response',
  emptyResponseHint: 'Model returned an empty response. Try rephrasing your request or switching models.',
  stopAction: 'stop',
  continueAction: 'continue',
  retryAction: 'retry',
  clickToInterrupt: 'click to interrupt',

  // Model Popover
  selectModel: 'Select Model',
  apiKeySettings: 'API Key Settings',
  enterApiKeyToStart: 'Enter API Key to start',
  save: 'Save',

  // Actions
  moreActions: 'More actions',
  copySelectionJson: 'Add current selection',

  close: 'Close',

  // Errors
  errors: {
    unauthorized: {
      title: 'Invalid API Key',
      message: 'Please check your API key in Settings.',
      action: 'Open Settings',
    } as ErrorItem,
    rateLimited: {
      title: 'Rate Limited',
      message: 'The API is temporarily busy. You can retry or wait a moment.',
      action: 'Retry',
    } as ErrorItem,
    quotaExceeded: {
      title: 'Quota Exceeded',
      message: 'Your API quota has been exhausted. Check your billing or wait for reset.',
      action: 'Open Settings',
    } as ErrorItem,
    unknown: {
      title: 'Configuration Error',
      message: 'Please check your settings.',
      action: 'Dismiss',
    } as ErrorItem,
  },

  // Prompt Suggestions
  promptSuggestions: [
    { icon: 'LayoutDashboard', title: 'Dashboard', description: 'A metrics scorecard showing 5 row items with columns: "Card Name", "Month", "Quarter", "Year", "Growth" and a trend indicator.' },
    { icon: 'LogIn', title: 'Login Screen', description: 'A clean login form with email and password fields, "Sign In" button, and social login options for Google and Apple.' },
    { icon: 'Settings', title: 'Settings Panel', description: 'A settings panel with toggle switches for notifications, dark mode, and auto-save, plus a color picker for accent color.' },
    { icon: 'User', title: 'Profile Card', description: 'A user profile card with avatar, name, bio, and action buttons for follow and message.' },
    { icon: 'FileText', title: 'Form Layout', description: 'A multi-field form with labels, text inputs, dropdown, and a submit button with validation states.' },
    { icon: 'ShoppingCart', title: 'Product Card', description: 'An e-commerce product card with image, price, rating stars, and add to cart button.' },
    { icon: 'CheckSquare', title: 'Task List', description: 'A to-do list with checkboxes, task names, due dates, and priority indicators.' },
  ] as SuggestionItem[],
};

type Translations = typeof en;

const zh: Translations = {
  // Theme
  light: '亮色',
  dark: '暗色',

  // Header / Navigation
  newDesign: '新设计',
  settings: '设置',
  closeSettings: '关闭设置',

  // Input
  placeholder: '描述你想要的设计，或点 + 添加上下文。',
  emptyStateHint: '选择下方建议或描述你的设计',

  // Onboarding
  buildSomething: '创造点',
  great: '好东西。',
  pasteApiKeyToConnect: '粘贴你的 API Key 来连接。',
  getOneFree: '免费获取',
  connecting: '连接中...',
  invalidKey: 'Key 无效。',
  getNewOne: '获取新的',
  pasteApiKey: '粘贴 API Key...',
  storedLocally: '安全存储在 Figma 本地。',
  detecting: '识别中...',
  failed: '失败',

  // Settings Panel
  apiKey: 'API Key',
  getFrom: (label: string) => `从 ${label} 获取`,
  enterApiKey: (provider: string) => `输入你的 ${provider} API Key`,
  availableModels: '可用模型',
  free: '免费',
  account: '账户',
  signOut: '登出',
  signOutConfirm: '登出并清除所有 API Key？',
  language: '语言',

  // Chat Status
  statusThought: '思考',
  statusError: '错误',
  statusStopped: '已停止',
  statusThinking: '思考中',
  statusEmptyResponse: '空响应',
  emptyResponseHint: '模型返回了空响应。请尝试换一种表述，或切换到其他模型。',
  stopAction: '停止',
  continueAction: '继续',
  retryAction: '重试',
  clickToInterrupt: '点击中断',

  // Model Popover
  selectModel: '选择模型',
  apiKeySettings: 'API Key 设置',
  enterApiKeyToStart: '输入 API Key 开始',
  save: '保存',

  // Actions
  moreActions: '更多操作',
  copySelectionJson: '添加当前选区',

  close: '关闭',

  // Errors
  errors: {
    unauthorized: {
      title: 'API Key 无效',
      message: '请在设置中检查您的 API Key。',
      action: '打开设置',
    },
    rateLimited: {
      title: '服务暂时繁忙',
      message: 'API 暂时限流，可以重试或稍等片刻。',
      action: '重试',
    },
    quotaExceeded: {
      title: '配额已用完',
      message: 'API 配额已耗尽，请检查账单或等待重置。',
      action: '打开设置',
    },
    unknown: {
      title: '配置错误',
      message: '请检查您的设置。',
      action: '关闭',
    },
  },

  // Prompt Suggestions
  promptSuggestions: [
    { icon: 'LayoutDashboard', title: '仪表盘', description: '包含 "卡片名称"、"月份"、"季度"、"年份"、"增长" 列及趋势指示器的5行指标记分卡。' },
    { icon: 'LogIn', title: '登录页', description: '简洁的登录表单，包含邮箱和密码字段，"登录" 按钮以及 Google 和 Apple 的社交登录选项。' },
    { icon: 'Settings', title: '设置面板', description: '包含通知、暗色模式和自动保存开关的设置面板，以及强调色选择器。' },
    { icon: 'User', title: '个人资料卡', description: '包含头像、姓名、简介以及关注和发消息操作按钮的用户资料卡。' },
    { icon: 'FileText', title: '表单布局', description: '包含标签、文本输入框、下拉菜单以及带验证状态的提交按钮的多字段表单。' },
    { icon: 'ShoppingCart', title: '商品卡片', description: '电商商品卡片，包含图片、价格、评分星级和加入购物车按钮。' },
    { icon: 'CheckSquare', title: '任务列表', description: '包含复选框、任务名称、截止日期和优先级指示器的待办事项列表。' },
  ],
};

const fr: Translations = {
  // Theme
  light: 'Clair',
  dark: 'Sombre',

  // Header / Navigation
  newDesign: 'Nouveau design',
  settings: 'Parametres',
  closeSettings: 'Fermer',

  // Input
  placeholder: 'Decrivez votre design, ou cliquez sur + pour ajouter du contexte.',
  emptyStateHint: 'Choisissez une suggestion ou decrivez votre design',

  // Onboarding
  buildSomething: 'Creez quelque chose',
  great: 'de genial.',
  pasteApiKeyToConnect: 'Collez votre cle API pour demarrer.',
  getOneFree: 'En obtenir une gratuite',
  connecting: 'Connexion...',
  invalidKey: 'Cle invalide.',
  getNewOne: 'En obtenir une nouvelle',
  pasteApiKey: 'Coller la cle API...',
  storedLocally: 'Stockee localement dans Figma.',
  detecting: 'Detection...',
  failed: 'Echoue',

  // Settings Panel
  apiKey: 'Cle API',
  getFrom: (label: string) => `Obtenir depuis ${label}`,
  enterApiKey: (provider: string) => `Entrez votre cle API ${provider}`,
  availableModels: 'modeles disponibles',
  free: 'Gratuit',
  account: 'Compte',
  signOut: 'Deconnexion',
  signOutConfirm: 'Se deconnecter et effacer toutes les cles API ?',
  language: 'Langue',

  // Chat Status
  statusThought: 'Reflexion',
  statusError: 'Erreur',
  statusStopped: 'Arrete',
  statusThinking: 'Reflexion',
  statusEmptyResponse: 'Reponse vide',
  emptyResponseHint: 'Le modele a renvoye une reponse vide. Essayez de reformuler ou de changer de modele.',
  stopAction: 'arreter',
  continueAction: 'continuer',
  retryAction: 'reessayer',
  clickToInterrupt: 'cliquer pour interrompre',

  // Model Popover
  selectModel: 'Choisir le modele',
  apiKeySettings: 'Parametres de cle API',
  enterApiKeyToStart: 'Entrez une cle API pour commencer',
  save: 'Enregistrer',

  // Actions
  moreActions: 'Plus d\'actions',
  copySelectionJson: 'Ajouter la selection actuelle',

  close: 'Fermer',

  // Errors
  errors: {
    unauthorized: {
      title: 'Cle API invalide',
      message: 'Verifiez votre cle API dans les parametres.',
      action: 'Parametres',
    },
    rateLimited: {
      title: 'Debit limite',
      message: 'L\'API est temporairement surchargee. Reessayez ou patientez.',
      action: 'Reessayer',
    },
    quotaExceeded: {
      title: 'Quota depasse',
      message: 'Votre quota API est epuise. Verifiez votre facturation.',
      action: 'Parametres',
    },
    unknown: {
      title: 'Erreur de configuration',
      message: 'Verifiez vos parametres.',
      action: 'Fermer',
    },
  },

  // Prompt Suggestions
  promptSuggestions: [
    { icon: 'LayoutDashboard', title: 'Tableau de bord', description: 'Un tableau de bord avec 5 lignes de metriques : "Nom", "Mois", "Trimestre", "Annee", "Croissance" et indicateur de tendance.' },
    { icon: 'LogIn', title: 'Ecran de connexion', description: 'Un formulaire de connexion epure avec champs email et mot de passe, bouton "Se connecter" et options Google/Apple.' },
    { icon: 'Settings', title: 'Panneau de parametres', description: 'Un panneau de parametres avec toggles pour notifications, mode sombre et sauvegarde auto, plus un selecteur de couleur.' },
    { icon: 'User', title: 'Carte de profil', description: 'Une carte de profil utilisateur avec avatar, nom, bio et boutons d\'action suivre et envoyer un message.' },
    { icon: 'FileText', title: 'Formulaire', description: 'Un formulaire multi-champs avec labels, champs texte, menu deroulant et bouton de soumission avec etats de validation.' },
    { icon: 'ShoppingCart', title: 'Fiche produit', description: 'Une fiche produit e-commerce avec image, prix, etoiles de notation et bouton ajouter au panier.' },
    { icon: 'CheckSquare', title: 'Liste de taches', description: 'Une liste de taches avec cases a cocher, noms, dates d\'echeance et indicateurs de priorite.' },
  ],
};

const translations = { en, zh, fr };

// ── Deferred initialization ──

t = translations[detectLocale()];
getTranslations = (locale: Locale) => translations[locale];
