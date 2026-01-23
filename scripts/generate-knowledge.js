/**
 * @file generate-knowledge.js
 * @description Multi-CSV adapter for UI Pro Max knowledge base
 * Processes Tier 1 data sources: styles, colors, typography, landing, ui-reasoning
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const DATA_DIR = path.resolve(__dirname, '../../ui-ux-pro-max-skill/skills/ui-ux-pro-max/data');
const OUTPUT_DIR = path.resolve(__dirname, '../src/generated');

// Tier 1 data sources with their transformers
const DATA_SOURCES = {
  reasoning: {
    file: 'ui-reasoning.csv',
    transform: (record, index) => ({
      id: record.No || String(index + 1),
      category: record.UI_Category,
      pattern: record.Recommended_Pattern,
      stylePriority: record.Style_Priority ? record.Style_Priority.split('+').map(s => s.trim()) : [],
      colorMood: record.Color_Mood,
      typographyMood: record.Typography_Mood,
      keyEffects: record.Key_Effects,
      decisionRules: parseJson(record.Decision_Rules),
      antiPatterns: record.Anti_Patterns,
      severity: record.Severity || 'MEDIUM'
    })
  },
  styles: {
    file: 'styles.csv',
    transform: (record, index) => ({
      id: record.STT || String(index + 1),
      category: record['Style Category'] || record.Style_Category,
      type: record.Type,
      keywords: (record['Keywords'] || record.Keywords || '').split(',').map(s => s.trim()).filter(Boolean),
      primaryColors: record['Primary Colors'] || record.Primary_Colors,
      secondaryColors: record['Secondary Colors'] || record.Secondary_Colors,
      effects: record['Effects & Animation'] || record['Effects_&_Animation'] || record.Effects,
      bestFor: record['Best For'] || record.Best_For,
      doNotUseFor: record['Do Not Use For'] || record.Do_Not_Use_For,
      lightMode: (record['Light Mode ✓'] || '').includes('✓'),
      darkMode: (record['Dark Mode ✓'] || '').includes('✓'),
      performance: record.Performance,
      accessibility: record.Accessibility,
      complexity: record.Complexity
    })
  },
  colors: {
    file: 'colors.csv',
    transform: (record, index) => ({
      id: record.No || String(index + 1),
      productType: record['Product Type'] || record.Product_Type,
      keywords: (record['Keywords'] || record.Keywords || '').split(',').map(s => s.trim()).filter(Boolean),
      primary: record['Primary (Hex)'] || record.Primary,
      secondary: record['Secondary (Hex)'] || record.Secondary,
      cta: record['CTA (Hex)'] || record.CTA,
      background: record['Background (Hex)'] || record.Background,
      text: record['Text (Hex)'] || record.Text,
      border: record['Border (Hex)'] || record.Border,
      notes: record.Notes
    })
  },
  typography: {
    file: 'typography.csv',
    transform: (record, index) => ({
      id: record.STT || String(index + 1),
      name: record['Font Pairing Name'] || record.Font_Pairing_Name,
      category: record.Category,
      headingFont: record['Heading Font'] || record.Heading_Font,
      bodyFont: record['Body Font'] || record.Body_Font,
      keywords: (record['Mood/Style Keywords'] || record['Mood/Style_Keywords'] || '').split(',').map(s => s.trim()).filter(Boolean),
      bestFor: record['Best For'] || record.Best_For,
      googleFontsUrl: record['Google Fonts URL'] || record.Google_Fonts_URL,
      cssImport: record['CSS Import'] || record.CSS_Import,
      tailwindConfig: record['Tailwind Config'] || record.Tailwind_Config,
      notes: record.Notes
    })
  },
  landing: {
    file: 'landing.csv',
    transform: (record, index) => ({
      id: record.No || String(index + 1),
      name: record['Pattern Name'],
      keywords: (record['Keywords'] || '').split(',').map(s => s.trim()).filter(Boolean),
      sections: record['Section Order'],
      cta: record['Primary CTA Placement'],
      colorStrategy: record['Color Strategy'],
      effects: record['Recommended Effects'],
      conversion: record['Conversion Optimization']
    })
  },
  charts: {
    file: 'charts.csv',
    transform: (record, index) => ({
      id: record.No || String(index + 1),
      type: record['Data Type'],
      keywords: (record['Keywords'] || '').split(',').map(s => s.trim()).filter(Boolean),
      bestChart: record['Best Chart Type'],
      secondaryOptions: record['Secondary Options'],
      colors: record['Color Guidance'],
      performance: record['Performance Impact'],
      accessibility: record['Accessibility Notes'],
      library: record['Library Recommendation'],
      interaction: record['Interactive Level']
    })
  },
  products: {
    file: 'products.csv',
    transform: (record, index) => ({
      id: record.No || String(index + 1),
      type: record['Product Type'],
      keywords: (record['Keywords'] || '').split(',').map(s => s.trim()).filter(Boolean),
      primaryStyle: record['Primary Style Recommendation'],
      secondaryStyles: record['Secondary Styles'],
      landingPattern: record['Landing Page Pattern'],
      dashboardStyle: record['Dashboard Style (if applicable)'],
      palette: record['Color Palette Focus'],
      considerations: record['Key Considerations']
    })
  }
};

// Guidelines sources to be merged
const GUIDELINE_SOURCES = [
  'ux-guidelines.csv',
  'web-interface.csv',
  'react-performance.csv'
];

function transformGuideline(record, index, sourceFile) {
  return {
    id: `${sourceFile.replace('.csv', '')}-${record.No || index}`,
    category: record.Category,
    issue: record.Issue,
    keywords: (record.Keywords || '').split(',').map(s => s.trim()).filter(Boolean),
    platform: record.Platform,
    description: record.Description,
    do: record.Do,
    dont: record["Don't"] || record["Dont"] || record.dont,
    codeGood: record['Code Example Good'] || record.Code_Example_Good,
    codeBad: record['Code Example Bad'] || record.Code_Example_Bad,
    severity: record.Severity || 'MEDIUM',
    source: sourceFile
  };
}

function processGuidelines() {
  let allGuidelines = [];
  for (const file of GUIDELINE_SOURCES) {
    const inputPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(inputPath)) continue;

    const rawContent = fs.readFileSync(inputPath, 'utf-8');
    const records = parse(preprocessCsv(rawContent), { 
      columns: true, 
      skip_empty_lines: true, 
      trim: true, 
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true
    });
    allGuidelines = allGuidelines.concat(records.map((r, i) => transformGuideline(r, i, file)));
  }
  
  const outputPath = path.join(OUTPUT_DIR, 'guidelines.json');
  fs.writeFileSync(outputPath, JSON.stringify(allGuidelines, null, 2));
  console.log(`✅ Generated guidelines.json (${allGuidelines.length} records from ${GUIDELINE_SOURCES.length} files)`);
  return allGuidelines.length;
}

function processStacks() {
  const stacksDir = path.join(DATA_DIR, 'stacks');
  if (!fs.existsSync(stacksDir)) return 0;

  let allStackRules = [];
  const files = fs.readdirSync(stacksDir).filter(f => f.endsWith('.csv'));

  for (const file of files) {
    const stackName = file.replace('.csv', '');
    const inputPath = path.join(stacksDir, file);
    const rawContent = fs.readFileSync(inputPath, 'utf-8');
    
    const records = parse(preprocessCsv(rawContent), { 
      columns: true, 
      skip_empty_lines: true, 
      trim: true, 
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true
    });
    const processed = records.map((record, index) => ({
      id: `${stackName}-${record.No || index}`,
      stack: stackName,
      category: record.Category,
      guideline: record.Guideline,
      description: record.Description,
      do: record.Do,
      dont: record["Don't"] || record["Dont"] || record.dont,
      codeGood: record['Code Good'] || record.Code_Good,
      codeBad: record['Code Bad'] || record.Code_Bad,
      severity: record.Severity,
      docsUrl: record['Docs URL'] || record.Docs_URL
    }));
    
    allStackRules = allStackRules.concat(processed);
  }

  const outputPath = path.join(OUTPUT_DIR, 'stacks.json');
  fs.writeFileSync(outputPath, JSON.stringify(allStackRules, null, 2));
  console.log(`✅ Generated stacks.json (${allStackRules.length} records from ${files.length} stacks)`);
  return allStackRules.length;
}

function parseJson(str) {
  if (!str || str === '{}') return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/**
 * [Robustness] Pre-processes CSV content to fix common formatting errors
 * like unclosed quotes that cause parser failures.
 */
function preprocessCsv(content) {
  return content.split('\n').map(line => {
    const quoteCount = (line.match(/"/g) || []).length;
    // If odd number of quotes, the line is likely malformed or truncated
    if (quoteCount % 2 !== 0) {
      return line + '"';
    }
    return line;
  }).join('\n');
}

function processDataSource(name, config) {
  const inputPath = path.join(DATA_DIR, config.file);
  const outputPath = path.join(OUTPUT_DIR, `${name}.json`);

  if (!fs.existsSync(inputPath)) {
    console.warn(`⚠️  Skipping ${name}: file not found at ${inputPath}`);
    return null;
  }

  const rawContent = fs.readFileSync(inputPath, 'utf-8');
  const fileContent = preprocessCsv(rawContent);
  
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true // [Self-Healing] Skip any record that still fails
  });

  const processed = records.map((record, index) => config.transform(record, index));
  
  fs.writeFileSync(outputPath, JSON.stringify(processed, null, 2));
  console.log(`✅ Generated ${name}.json (${processed.length} records)`);
  
  return processed.length;
}

function main() {
  console.log('🔨 Generating UI Pro Max knowledge base...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let totalRecords = 0;
  for (const [name, config] of Object.entries(DATA_SOURCES)) {
    const count = processDataSource(name, config);
    if (count) totalRecords += count;
  }

  // Process special cases
  totalRecords += processGuidelines();
  totalRecords += processStacks();

  console.log(`\n✅ Complete! All UI Pro Max datasets generated (${totalRecords} total records)`);
}

main();
