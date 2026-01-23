
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const INPUT_CSV_PATH = path.resolve(__dirname, '../../ui-ux-pro-max-skill/skills/ui-ux-pro-max/data/ui-reasoning.csv');
const OUTPUT_JSON_PATH = path.resolve(__dirname, '../src/generated/reasoning.json');
const OUTPUT_DIR = path.dirname(OUTPUT_JSON_PATH);

function generateReasoning() {
  console.log(`Reading CSV from: ${INPUT_CSV_PATH}`);

  if (!fs.existsSync(INPUT_CSV_PATH)) {
    console.error(`Error: Input file not found at ${INPUT_CSV_PATH}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(INPUT_CSV_PATH, 'utf-8');
  
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Parsed ${records.length} records.`);

  const processedRules = records.map((record, index) => {
    // Parse Decision_Rules JSON string
    let decisionRules = {};
    try {
        if (record.Decision_Rules && record.Decision_Rules !== '{}') {
             decisionRules = JSON.parse(record.Decision_Rules);
        }
    } catch (e) {
        console.warn(`Warning: Failed to parse Decision_Rules for category "${record.UI_Category}". content: ${record.Decision_Rules}`);
    }

    return {
      id: record.No || String(index + 1),
      category: record.UI_Category,
      pattern: record.Recommended_Pattern,
      stylePriority: record.Style_Priority ? record.Style_Priority.split('+').map(s => s.trim()) : [],
      colorMood: record.Color_Mood,
      typographyMood: record.Typography_Mood,
      keyEffects: record.Key_Effects,
      decisionRules: decisionRules,
      antiPatterns: record.Anti_Patterns,
      severity: record.Severity || 'MEDIUM'
    };
  });

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(processedRules, null, 2));
  console.log(`Successfully generated reasoning.json at ${OUTPUT_JSON_PATH}`);
}

generateReasoning();
