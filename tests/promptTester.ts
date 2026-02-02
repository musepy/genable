/**
 * @file promptTester.ts
 * @description Automated A/B Testing for Prompt Strategies
 * 
 * [INPUT]:  Prompt variant type, iteration count, API key
 * [OUTPUT]: TestResult[] with accuracy metrics and timing
 * [POS]:    Services - called from UI thread for experiments
 * 
 * ⚠️ 自指更新规则：一旦我被修改，必须：
 *    1. 更新本注释的 I/O/POS
 *    2. 更新 /src/skills/llm-client/context/.folder.md 中的文件描述
 */

import { GoogleGenAI } from '@google/genai';
import * as v from 'valibot';
import { NodeSchema, NodeLayer } from '../src/schema/layerSchema';

// ==========================================
// Types
// ==========================================

export type PromptVariant = 'current' | 'example-first' | 'constraint-first';

export interface TestResult {
  variant: PromptVariant;
  iteration: number;
  buttonHeightCorrect: boolean;
  statsLayoutCorrect: boolean;
  avatarCornerCorrect: boolean;
  generationTime: number;
  rawJSON: string;
}

export interface TestSummary {
  variant: PromptVariant;
  totalTests: number;
  buttonHeightAccuracy: number;
  statsLayoutAccuracy: number;
  avatarCornerAccuracy: number;
  avgGenerationTime: number;
}

// ==========================================
// Prompt Variants
// ==========================================

function generatePromptVariant(variant: PromptVariant): string {
  const exampleJSON = `{
  "type": "FRAME",
  "props": {
    "name": "ProfileCard",
    "layout": "VERTICAL",
    "width": 360,
    "fills": ["#FFFFFF"],
    "cornerRadius": 16,
    "gap": 24,
    "padding": {"top": 32, "right": 24, "bottom": 32, "left": 24}
  },
  "children": [
    {
      "type": "FRAME",
      "props": {
        "name": "Avatar",
        "width": 96,
        "height": 96,
        "fills": ["#E5E7EB"],
        "cornerRadius": 48
      }
    },
    {
      "type": "FRAME",
      "props": {"name": "Stats", "layout": "HORIZONTAL", "layoutSizingHorizontal": "FILL", "gap": 0},
      "children": [
        {
          "type": "FRAME",
          "props": {"name": "StatItem", "layout": "VERTICAL", "layoutSizingHorizontal": "FILL", "gap": 2},
          "children": [
            {"type": "TEXT", "props": {"content": "248", "fontSize": 20, "fontWeight": "Bold", "color": "#111827"}},
            {"type": "TEXT", "props": {"content": "Posts", "fontSize": 13, "color": "#6B7280"}}
          ]
        }
      ]
    },
    {
      "type": "FRAME",
      "props": {"name": "ActionButtons", "layout": "HORIZONTAL", "layoutSizingHorizontal": "FILL", "gap": 12},
      "children": [
        {
          "type": "FRAME",
          "props": {
            "name": "FollowButton",
            "layout": "HORIZONTAL",
            "layoutSizingHorizontal": "FILL",
            "height": 44,
            "fills": ["#3B82F6"],
            "cornerRadius": 8
          },
          "children": [
            {"type": "TEXT", "props": {"content": "Follow", "fontSize": 15, "color": "#FFFFFF"}}
          ]
        }
      ]
    }
  ]
}`;

  switch (variant) {
    case 'example-first':
      return `You are a Figma UI designer. Generate ONLY valid JSON matching this EXACT structure:

${exampleJSON}

CRITICAL: Copy the structure EXACTLY. Pay special attention to:
- Avatar cornerRadius MUST be 48 (half of width 96)
- Button height MUST be 44
- Stats and ActionButtons MUST have layoutSizingHorizontal: "FILL"

Now generate a user profile card with different content but IDENTICAL structure.

Return ONLY JSON, no markdown, no explanation.`;

    case 'constraint-first':
      return `You are a Figma UI designer. Generate a user profile card JSON.

HARD CONSTRAINTS (YOU MUST FOLLOW):
1. Avatar: width=96, height=96, cornerRadius=48 (circular)
2. Buttons: height=44 (NEVER more than 52px)
3. Stats container: layoutSizingHorizontal="FILL"
4. Button container: layoutSizingHorizontal="FILL"

EXAMPLE STRUCTURE:
${exampleJSON}

Return ONLY valid JSON, no markdown.`;

    default: // 'current'
      return `You are an expert Figma UI designer. Your task is to generate production-ready Figma designs as JSON.

DESIGN INTENT FOR USER PROFILES:
- Avatar: 96px, CIRCULAR (cornerRadius = width/2)
- Buttons: Height 44px, never larger
- Stats: Use layoutSizingHorizontal FILL for responsive width

EXAMPLE:
${exampleJSON}

SCHEMA:
{
  "type": "FRAME",
  "props": {
    "name": string,
    "layout": "VERTICAL" | "HORIZONTAL",
    "layoutSizingHorizontal": "FIXED" | "HUG" | "FILL",
    "height": number,
    "cornerRadius": number
  },
  "children": []
}

Return ONLY valid JSON.`;
  }
}

// ==========================================
// Test Execution
// ==========================================

export async function runPromptTest(
  variant: PromptVariant,
  iterations: number,
  apiKey: string,
  modelName: string = 'gemini-2.5-flash',
  onProgress?: (current: number, total: number) => void,
  onRender?: (layer: NodeLayer, iteration: number) => void
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const ai = new GoogleGenAI({ apiKey });

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    try {
      const prompt = generatePromptVariant(variant);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt
      });
      let text = (response.text || '').replace(/```json/g, '').replace(/```/g, '').trim();

      const generationTime = Date.now() - startTime;

      // Parse and validate
      const json = JSON.parse(text);
      const parsed = v.parse(NodeSchema, json);

      // Emit render event if callback provided
      if (onRender) {
        onRender(parsed, i + 1);
      }

      // Check accuracy
      const buttonHeightCorrect = checkButtonHeight(parsed);
      const statsLayoutCorrect = checkStatsLayout(parsed);
      const avatarCornerCorrect = checkAvatarCorner(parsed);

      results.push({
        variant,
        iteration: i + 1,
        buttonHeightCorrect,
        statsLayoutCorrect,
        avatarCornerCorrect,
        generationTime,
        rawJSON: text
      });

    } catch (error) {
      results.push({
        variant,
        iteration: i + 1,
        buttonHeightCorrect: false,
        statsLayoutCorrect: false,
        avatarCornerCorrect: false,
        generationTime: Date.now() - startTime,
        rawJSON: `Error: ${error}`
      });
    }

    if (onProgress) {
      onProgress(i + 1, iterations);
    }
  }

  return results;
}

// ==========================================
// Accuracy Checkers
// ==========================================

function checkButtonHeight(layer: NodeLayer): boolean {
  const buttons = findNodesByName(layer, ['button', 'btn', 'action']);
  if (buttons.length === 0) return false;

  return buttons.every(btn => {
    const height = btn.props.height;
    return height && height >= 40 && height <= 52;
  });
}

function checkStatsLayout(layer: NodeLayer): boolean {
  const stats = findNodesByName(layer, ['stats', 'stat']);
  if (stats.length === 0) return false;

  return stats.some(stat => {
    if (stat.props.layout === 'HORIZONTAL') {
      return stat.props.layoutSizingHorizontal === 'FILL';
    }
    return true;
  });
}

function checkAvatarCorner(layer: NodeLayer): boolean {
  const avatars = findNodesByName(layer, ['avatar']);
  if (avatars.length === 0) return false;

  return avatars.every(avatar => {
    const width = avatar.props.width;
    const corner = avatar.props.cornerRadius;
    if (!width || !corner) return false;
    return corner === width / 2;
  });
}

function findNodesByName(layer: NodeLayer, keywords: string[]): NodeLayer[] {
  const results: NodeLayer[] = [];
  const name = (layer.props.name || '').toLowerCase();

  if (keywords.some(kw => name.includes(kw))) {
    results.push(layer);
  }

  if (layer.children) {
    for (const child of layer.children) {
      results.push(...findNodesByName(child, keywords));
    }
  }

  return results;
}

// ==========================================
// Summary Generation
// ==========================================

export function generateSummary(results: TestResult[]): TestSummary {
  const total = results.length;
  const buttonCorrect = results.filter(r => r.buttonHeightCorrect).length;
  const statsCorrect = results.filter(r => r.statsLayoutCorrect).length;
  const avatarCorrect = results.filter(r => r.avatarCornerCorrect).length;
  const avgTime = results.reduce((sum, r) => sum + r.generationTime, 0) / total;

  return {
    variant: results[0]?.variant || 'unknown' as PromptVariant,
    totalTests: total,
    buttonHeightAccuracy: buttonCorrect / total,
    statsLayoutAccuracy: statsCorrect / total,
    avatarCornerAccuracy: avatarCorrect / total,
    avgGenerationTime: avgTime
  };
}
