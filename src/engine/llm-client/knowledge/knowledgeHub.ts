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
import { ANATOMY_REGISTRY } from '../../../knowledge/anatomyRegistry';
import { ComponentSchema } from '../../../knowledge/types';

// Import generated knowledge bases
import reasoningData from '../../../generated/reasoning.json';
import stylesData from '../../../generated/styles.json';
import colorsData from '../../../generated/colors.json';
import typographyData from '../../../generated/typography.json';
import landingData from '../../../generated/landing.json';
import chartsData from '../../../generated/charts.json';
import productsData from '../../../generated/products.json';
import guidelinesData from '../../../generated/guidelines.json';
import stacksData from '../../../generated/stacks.json';
import figmaLayoutData from '../../../generated/figma-layout-rules.json';

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
    this.reasoning = reasoningData as unknown as ReasoningRule[];
    this.styles = stylesData as unknown as StyleDefinition[];
    this.colors = colorsData as unknown as ColorPalette[];
    this.typography = typographyData as unknown as TypographyPairing[];
    this.landing = landingData as unknown as LandingPagePattern[];
    this.charts = chartsData as unknown as ChartRecommendation[];
    this.products = productsData as unknown as ProductTrend[];
    this.guidelines = guidelinesData as unknown as GuidelineRule[];
    this.stacks = stacksData as unknown as StackRule[];
    this.figmaLayout = figmaLayoutData as unknown as FigmaLayoutRule[];

    // Convert ANATOMY_REGISTRY to searchable format
    this.anatomy = Object.entries(ANATOMY_REGISTRY).map(([key, value]) => ({
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
  getAnatomyByKey(key: string): Partial<ComponentSchema> | undefined {
    return ANATOMY_REGISTRY[key.toLowerCase()];
  }

  // ==========================================
  // Unified Search
  // ==========================================

  /**
   * Search all knowledge domains and return aggregated results
   */
  searchAll(query: string) {
    return {
      reasoning: this.searchReasoning(query, 1)[0]?.item,
      style: this.searchStyles(query, 1)[0]?.item,
      colors: this.searchColors(query, 1)[0]?.item,
      typography: this.searchTypography(query, 1)[0]?.item,
      landing: this.searchLanding(query, 1)[0]?.item,
      products: this.searchProducts(query, 1)[0]?.item,
    };
  }

  // ==========================================
  // Direct Access Methods
  // ==========================================

  getReasoningByCategory(category: string): ReasoningRule | undefined {
    return this.reasoning.find(r => r.category.toLowerCase() === category.toLowerCase());
  }

  getColorsByProductType(productType: string): ColorPalette | undefined {
    return this.colors.find(c => c.productType.toLowerCase() === productType.toLowerCase());
  }

  getStyleByCategory(category: string): StyleDefinition | undefined {
    return this.styles.find(s => s.category.toLowerCase() === category.toLowerCase());
  }

  getAllReasoning(): ReasoningRule[] { return this.reasoning; }
  getAllStyles(): StyleDefinition[] { return this.styles; }
  getAllColors(): ColorPalette[] { return this.colors; }
  getAllTypography(): TypographyPairing[] { return this.typography; }
  getAllLanding(): LandingPagePattern[] { return this.landing; }

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

// Re-export for backward compatibility
export { knowledgeHub as reasoningEngine };
export { ANATOMY_REGISTRY };
// AnatomyBlueprint is already exported as interface above
