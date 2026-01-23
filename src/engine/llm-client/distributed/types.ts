/**
 * Generation Phases for the Distributed Thinking Model
 */
export enum ThinkingPhase {
  REQUIREMENT = 'REQUIREMENT',
  STRUCTURE = 'STRUCTURE',
  LAYOUT = 'LAYOUT',
  STYLE = 'STYLE',
  GENERATE = 'GENERATE'
}

/**
 * Output for each phase (Partial data)
 */
export interface PhaseOutput {
  phase: ThinkingPhase;
  data: any;
  rawText: string;
}

/**
 * Context that flows through the pipeline
 */
export interface GenerationContext {
  intent: string;
  designSystemId: string;
  history: PhaseOutput[];
}

/**
 * Requirement Phase Output
 */
export interface RequirementData {
  semantic: string;
  intent: string;
  hypothesis?: string;
}

/**
 * Structure Phase Output (Hierarchy only)
 */
export interface StructureData {
  type: 'FRAME';
  children: Array<{
    type: string;
    role: string;
    children?: StructureData['children'];
  }>;
}

/**
 * Layout Phase Output (Physics)
 */
export interface LayoutData {
  width?: number;
  height?: number;
  padding?: number;
  gap?: number;
  layoutMode?: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  // Removed: primaryAxisSizingMode and counterAxisSizingMode
  // These properties are not supported by Figma API.
  // Use layoutSizingHorizontal and layoutSizingVertical instead.
}

/**
 * Style Phase Output (Tokens/Visuals)
 */
export interface StyleData {
  fills?: any[];
  cornerRadius?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  strokeWeight?: number;
  strokes?: any[];
}
