/**
 * @file knowledgeHub.ts
 * @description Unified knowledge retrieval service for UI Pro Max data sources
 *
 * Provides semantic search across multiple knowledge domains:
 * - reasoning: UI category patterns and decision rules
 * - styles: Visual style definitions and guidelines
 * - colors: Product-specific color palettes
 * - typography: Font pairings and configurations
 */

import MiniSearch from 'minisearch';
// [FIX] Handle environments without 'path' (Figma Sandbox)
let path: any;
try {
  path = require('path');
} catch (e) {}
import { loadAnatomyFromDirectory, getAnatomyDir } from '../../agent/skills/knowledgeLoader';
import { ComponentSchema } from '../../../knowledge/types';

// Import generated CSV knowledge bases (text strings)
import reasoningCsv from '../../../generated/reasoning.csv';
import stylesCsv from '../../../generated/styles.csv';
import colorsCsv from '../../../generated/colors.csv';
import typographyCsv from '../../../generated/typography.csv';
import landingCsv from '../../../generated/landing.csv';
import chartsCsv from '../../../generated/charts.csv';
import productsCsv from '../../../generated/products.csv';
import guidelinesCsv from '../../../generated/guidelines.csv';
import stacksCsv from '../../../generated/stacks.csv';
// figma-layout-rules stays as JSON (hand-maintained, not from CSV source)
import figmaLayoutData from '../../../generated/figma-layout-rules.json';

// ==========================================
// CSV Parser
// ==========================================

/**
 * Lightweight CSV parser that handles quoted fields, escaped quotes,
 * and multi-line values. Returns array of objects keyed by header names.
 */
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // skip carriage return; \n will handle the row break
    } else {
      field += ch;
    }
  }
  // Flush last field/row
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
}

// ==========================================
// Per-domain transform functions
// ==========================================

function transformReasoning(records: Record<string, string>[]): ReasoningRule[] {
  return records.map(r => ({
    id: r.id,
    category: r.category,
    pattern: r.pattern,
    stylePriority: r.stylePriority ? r.stylePriority.split('|') : [],
    colorMood: r.colorMood,
    typographyMood: r.typographyMood,
    keyEffects: r.keyEffects,
    decisionRules: r.decisionRules ? (() => { try { return JSON.parse(r.decisionRules); } catch { return {}; } })() : {},
    antiPatterns: r.antiPatterns,
    severity: r.severity,
  }));
}

function transformStyles(records: Record<string, string>[]): StyleDefinition[] {
  return records.map(r => ({
    id: r.id,
    category: r.category,
    type: r.type,
    keywords: r.keywords ? r.keywords.split('|') : [],
    primaryColors: r.primaryColors,
    secondaryColors: r.secondaryColors,
    effects: r.effects,
    bestFor: r.bestFor,
    doNotUseFor: r.doNotUseFor,
    lightMode: r.lightMode === 'true',
    darkMode: r.darkMode === 'true',
    performance: r.performance,
    accessibility: r.accessibility,
    complexity: r.complexity,
  }));
}

function transformColors(records: Record<string, string>[]): ColorPalette[] {
  return records.map(r => ({
    id: r.id,
    productType: r.productType,
    keywords: r.keywords ? r.keywords.split('|') : [],
    primary: r.primary,
    secondary: r.secondary,
    cta: r.cta,
    background: r.background,
    text: r.text,
    border: r.border,
    notes: r.notes,
  }));
}

function transformTypography(records: Record<string, string>[]): TypographyPairing[] {
  return records.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category,
    headingFont: r.headingFont,
    bodyFont: r.bodyFont,
    keywords: r.keywords ? r.keywords.split('|') : [],
    bestFor: r.bestFor,
    googleFontsUrl: r.googleFontsUrl,
    cssImport: r.cssImport,
    tailwindConfig: r.tailwindConfig,
    notes: r.notes,
  }));
}

function transformLanding(records: Record<string, string>[]): LandingPagePattern[] {
  return records.map(r => ({
    id: r.id,
    name: r.name,
    keywords: r.keywords ? r.keywords.split('|') : [],
    sections: r.sections,
    cta: r.cta,
    colorStrategy: r.colorStrategy,
    effects: r.effects,
    conversion: r.conversion,
  }));
}

function transformCharts(records: Record<string, string>[]): ChartRecommendation[] {
  return records.map(r => ({
    id: r.id,
    type: r.type,
    keywords: r.keywords ? r.keywords.split('|') : [],
    bestChart: r.bestChart,
    secondaryOptions: r.secondaryOptions,
    colors: r.colors,
    performance: r.performance,
    accessibility: r.accessibility,
    library: r.library,
    interaction: r.interaction,
  }));
}

function transformProducts(records: Record<string, string>[]): ProductTrend[] {
  return records.map(r => ({
    id: r.id,
    type: r.type,
    keywords: r.keywords ? r.keywords.split('|') : [],
    primaryStyle: r.primaryStyle,
    secondaryStyles: r.secondaryStyles,
    landingPattern: r.landingPattern,
    dashboardStyle: r.dashboardStyle,
    palette: r.palette,
    considerations: r.considerations,
  }));
}

function transformGuidelines(records: Record<string, string>[]): GuidelineRule[] {
  return records.map(r => ({
    id: r.id,
    category: r.category,
    issue: r.issue,
    keywords: r.keywords ? r.keywords.split('|') : [],
    platform: r.platform,
    description: r.description,
    do: r.do,
    dont: r.dont,
    codeGood: r.codeGood,
    codeBad: r.codeBad,
    severity: r.severity,
    source: r.source,
  }));
}

function transformStacks(records: Record<string, string>[]): StackRule[] {
  return records.map(r => ({
    id: r.id,
    stack: r.stack,
    category: r.category,
    guideline: r.guideline,
    description: r.description,
    do: r.do,
    dont: r.dont,
    codeGood: r.codeGood,
    codeBad: r.codeBad,
    severity: r.severity,
    docsUrl: r.docsUrl,
  }));
}

// ==========================================
// Type Definitions
// ==========================================

export interface ReasoningRule {
  id: string;
  category: string;
  pattern: string;
  stylePriority: string[];
  colorMood: string;
  typographyMood: string;
  keyEffects: string;
  decisionRules: Record<string, string | undefined>;
  antiPatterns: string;
  severity: string;
}

export interface StyleDefinition {
  id: string;
  category: string;
  type: string;
  keywords: string[];
  primaryColors: string;
  secondaryColors: string;
  effects: string;
  bestFor: string;
  doNotUseFor: string;
  lightMode: boolean;
  darkMode: boolean;
  performance: string;
  accessibility: string;
  complexity: string;
}

export interface ColorPalette {
  id: string;
  productType: string;
  keywords: string[];
  primary: string;
  secondary: string;
  cta: string;
  background: string;
  text: string;
  border: string;
  notes: string;
}

export interface TypographyPairing {
  id: string;
  name: string;
  category: string;
  headingFont: string;
  bodyFont: string;
  keywords: string[];
  bestFor: string;
  googleFontsUrl: string;
  cssImport: string;
  tailwindConfig: string;
  notes: string;
}

export interface LandingPagePattern {
  id: string;
  name: string;
  keywords: string[];
  sections: string;
  cta: string;
  colorStrategy: string;
  effects: string;
  conversion: string;
}

export interface ChartRecommendation {
  id: string;
  type: string;
  keywords: string[];
  bestChart: string;
  secondaryOptions: string;
  colors: string;
  performance: string;
  accessibility: string;
  library: string;
  interaction: string;
}

export interface ProductTrend {
  id: string;
  type: string;
  keywords: string[];
  primaryStyle: string;
  secondaryStyles: string;
  landingPattern: string;
  dashboardStyle: string;
  palette: string;
  considerations: string;
}

export interface GuidelineRule {
  id: string;
  category: string;
  issue: string;
  keywords: string[];
  platform: string;
  description: string;
  do: string;
  dont: string;
  codeGood: string;
  codeBad: string;
  severity: string;
  source: string;
}

export interface StackRule {
  id: string;
  stack: string;
  category: string;
  guideline: string;
  description: string;
  do: string;
  dont: string;
  codeGood: string;
  codeBad: string;
  severity: string;
  docsUrl: string;
}

// FigmaLayoutRule reuses GuidelineRule structure
export type FigmaLayoutRule = GuidelineRule;

export interface SearchResult<T> {
  item: T;
  score: number;
}

// Anatomy Blueprint type for search
export interface AnatomyBlueprint {
  id: string;
  name: string;
  category?: string;
  description?: string;
  keywords: string[];
  structure: any;
  defaultProps?: any;
  variants?: Record<string, any>;
}



// ==========================================
// KnowledgeHub Service
// ==========================================

class KnowledgeHubService {
  private reasoningIndex: MiniSearch<ReasoningRule>;
  private stylesIndex: MiniSearch<StyleDefinition>;
  private colorsIndex: MiniSearch<ColorPalette>;
  private typographyIndex: MiniSearch<TypographyPairing>;
  private landingIndex: MiniSearch<LandingPagePattern>;
  private chartsIndex: MiniSearch<ChartRecommendation>;
  private productsIndex: MiniSearch<ProductTrend>;
  private guidelinesIndex: MiniSearch<GuidelineRule>;
  private stacksIndex: MiniSearch<StackRule>;
  private figmaLayoutIndex: MiniSearch<FigmaLayoutRule>;
  private anatomyIndex: MiniSearch<AnatomyBlueprint>;

  private reasoning: ReasoningRule[];
  private styles: StyleDefinition[];
  private colors: ColorPalette[];
  private typography: TypographyPairing[];
  private landing: LandingPagePattern[];
  private charts: ChartRecommendation[];
  private products: ProductTrend[];
  private guidelines: GuidelineRule[];
  private stacks: StackRule[];
  private anatomy: AnatomyBlueprint[];
  private figmaLayout: FigmaLayoutRule[];

  constructor() {
    // Parse CSV text → typed arrays
    this.reasoning = transformReasoning(parseCSV(reasoningCsv));
    this.styles = transformStyles(parseCSV(stylesCsv));
    this.colors = transformColors(parseCSV(colorsCsv));
    this.typography = transformTypography(parseCSV(typographyCsv));
    this.landing = transformLanding(parseCSV(landingCsv));
    this.charts = transformCharts(parseCSV(chartsCsv));
    this.products = transformProducts(parseCSV(productsCsv));
    this.guidelines = transformGuidelines(parseCSV(guidelinesCsv));
    this.stacks = transformStacks(parseCSV(stacksCsv));
    // figma-layout-rules stays as JSON import
    this.figmaLayout = figmaLayoutData as unknown as FigmaLayoutRule[];

    // Load anatomy from .agent/knowledge/components/ (Cline-style)
    const root = path ? path.resolve(__dirname, '../../../../..') : '';
    const anatomyDir = getAnatomyDir(root);
    const anatomyRegistry = loadAnatomyFromDirectory(anatomyDir);

    // Convert to searchable format
    this.anatomy = Object.entries(anatomyRegistry).map(([key, value]) => ({
      id: key,
      name: value.name || key,
      category: value.category,
      description: value.description,
      keywords: [
        key,
        value.name || '',
        value.category || '',
        value.description || ''
      ].filter(Boolean),
      structure: value.structure,
      defaultProps: value.defaultProps,
      variants: value.variants
    }));

    this.reasoningIndex = this.createIndex(['category', 'pattern', 'colorMood']);
    this.stylesIndex = this.createIndex(['category', 'keywords', 'bestFor']);
    this.colorsIndex = this.createIndex(['productType', 'keywords']);
    this.typographyIndex = this.createIndex(['name', 'keywords', 'bestFor']);
    this.landingIndex = this.createIndex(['name', 'keywords', 'sections']);
    this.chartsIndex = this.createIndex(['type', 'keywords', 'bestChart']);
    this.productsIndex = this.createIndex(['type', 'keywords']);
    this.guidelinesIndex = this.createIndex(['category', 'issue', 'keywords', 'description']);
    this.stacksIndex = this.createIndex(['stack', 'category', 'guideline', 'description']);
    this.figmaLayoutIndex = this.createIndex(['category', 'issue', 'keywords', 'description']);
    this.anatomyIndex = this.createIndex(['id', 'name', 'category', 'description', 'keywords']);

    this.reasoningIndex.addAll(this.reasoning);
    this.stylesIndex.addAll(this.styles);
    this.colorsIndex.addAll(this.colors);
    this.typographyIndex.addAll(this.typography);
    this.landingIndex.addAll(this.landing);
    this.chartsIndex.addAll(this.charts);
    this.productsIndex.addAll(this.products);
    this.guidelinesIndex.addAll(this.guidelines);
    this.stacksIndex.addAll(this.stacks);
    this.figmaLayoutIndex.addAll(this.figmaLayout);
    this.anatomyIndex.addAll(this.anatomy);
  }

  private createIndex<T>(fields: string[]): MiniSearch<T> {
    return new MiniSearch<T>({
      fields,
      storeFields: ['id'],
      searchOptions: { fuzzy: 0.2, prefix: true },
    });
  }

  // ==========================================
  // Domain-Specific Search Methods
  // ==========================================

  searchReasoning(query: string, limit = 3): SearchResult<ReasoningRule>[] {
    return this.search(this.reasoningIndex, this.reasoning, query, limit);
  }

  searchStyles(query: string, limit = 3): SearchResult<StyleDefinition>[] {
    return this.search(this.stylesIndex, this.styles, query, limit);
  }

  searchColors(query: string, limit = 3): SearchResult<ColorPalette>[] {
    return this.search(this.colorsIndex, this.colors, query, limit);
  }

  searchTypography(query: string, limit = 3): SearchResult<TypographyPairing>[] {
    return this.search(this.typographyIndex, this.typography, query, limit);
  }

  searchLanding(query: string, limit = 3): SearchResult<LandingPagePattern>[] {
    return this.search(this.landingIndex, this.landing, query, limit);
  }

  searchCharts(query: string, limit = 3): SearchResult<ChartRecommendation>[] {
    return this.search(this.chartsIndex, this.charts, query, limit);
  }

  searchProducts(query: string, limit = 3): SearchResult<ProductTrend>[] {
    return this.search(this.productsIndex, this.products, query, limit);
  }

  searchGuidelines(query: string, limit = 5): SearchResult<GuidelineRule>[] {
    return this.search(this.guidelinesIndex, this.guidelines, query, limit);
  }

  /**
   * Search Figma-specific layout rules
   * @param query - Component type, semantic, or layout property
   * @param limit - Maximum results (default: 5)
   */
  searchFigmaLayout(query: string, limit = 5): SearchResult<FigmaLayoutRule>[] {
    // If no query, return all rules (useful for general guidance)
    if (!query || query.trim() === '') {
      return this.figmaLayout.slice(0, limit).map(item => ({ item, score: 1.0 }));
    }
    return this.search(this.figmaLayoutIndex, this.figmaLayout, query, limit);
  }

  /**
   * Get all Figma layout rules (for critical rules injection)
   */
  getAllFigmaLayoutRules(): FigmaLayoutRule[] {
    return this.figmaLayout;
  }

  searchStackRules(stack: string, query: string, limit = 5): SearchResult<StackRule>[] {
    if (!query) {
      return this.stacks
        .filter(r => r.stack.toLowerCase() === stack.toLowerCase() || !stack)
        .slice(0, limit)
        .map(item => ({ item, score: 1.0 }));
    }
    const results = this.search(this.stacksIndex, this.stacks, query, limit * 2);
    return results
      .filter(r => r.item.stack.toLowerCase() === stack.toLowerCase() || !stack)
      .slice(0, limit);
  }

  /**
   * Search component anatomy blueprints using semantic search
   * @param query - Component name, semantic type, or description
   * @param limit - Maximum results (default: 3)
   */
  searchAnatomy(query: string, limit = 3): SearchResult<AnatomyBlueprint>[] {
    if (!query || query.trim() === '') {
      return [];
    }
    return this.search(this.anatomyIndex, this.anatomy, query, limit);
  }

  /**
   * Get anatomy blueprint by exact key (for backward compatibility)
   * @param key - Exact registry key (e.g., 'button', 'badge')
   */
  getAnatomyByKey(key: string): AnatomyBlueprint | undefined {
    return this.anatomy.find(a => a.id.toLowerCase() === key.toLowerCase());
  }



  // ==========================================
  // Private Helpers
  // ==========================================

  private search<T extends { id: string }>(
    index: MiniSearch<T>,
    data: T[],
    query: string,
    limit: number
  ): SearchResult<T>[] {
    const results = index.search(query);
    return results.slice(0, limit).map(result => ({
      item: data.find(d => d.id === result.id)!,
      score: result.score,
    }));
  }
}

// Export singleton instance
export const knowledgeHub = new KnowledgeHubService();
