const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const uiEntryFile = path.join(repoRoot, 'src/ui.tsx');
const globalStylesFile = path.join(repoRoot, 'src/ui/design-system/tokens/globalStyles.ts');
const outputFile = path.join(repoRoot, 'tools/ui-preview/runtime-usage-audit.html');

const excludedFunctionNames = new Set(['renderCaptureSandbox']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
      walk(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function toRel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function splitClassTokens(value) {
  return String(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(token));
}

function extractClassTokensFromExpression(node, out) {
  if (!node) return;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    splitClassTokens(node.text).forEach((token) => out.add(token));
    return;
  }
  if (ts.isTemplateExpression(node)) {
    splitClassTokens(node.head.text).forEach((token) => out.add(token));
    for (const span of node.templateSpans) {
      extractClassTokensFromExpression(span.expression, out);
      splitClassTokens(span.literal.text).forEach((token) => out.add(token));
    }
    return;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    extractClassTokensFromExpression(node.left, out);
    extractClassTokensFromExpression(node.right, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    extractClassTokensFromExpression(node.whenTrue, out);
    extractClassTokensFromExpression(node.whenFalse, out);
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    extractClassTokensFromExpression(node.expression, out);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    node.elements.forEach((element) => extractClassTokensFromExpression(element, out));
    return;
  }
  if (ts.isCallExpression(node)) {
    const calleeText = node.expression.getText();
    if (calleeText === 'clsx' || calleeText === 'classnames') {
      node.arguments.forEach((arg) => extractClassTokensFromExpression(arg, out));
    }
  }
}

function getFunctionName(node) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) {
    return node.name ? node.name.getText() : null;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    const parent = node.parent;
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }
  return null;
}

const sourceFiles = walk(srcRoot).filter((filePath) => /\.(ts|tsx)$/.test(filePath));
const componentCandidateFiles = [
  ...walk(path.join(repoRoot, 'src/ui/components')).filter((filePath) => filePath.endsWith('.tsx')),
  path.join(repoRoot, 'src/ui/SettingsPanel.tsx'),
  path.join(repoRoot, 'src/features/chat/index.tsx'),
  path.join(repoRoot, 'src/ui.tsx'),
];

const program = ts.createProgram(sourceFiles, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.Preserve,
  allowJs: false,
  checkJs: false,
  resolveJsonModule: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  skipLibCheck: true,
  strict: false,
});
const checker = program.getTypeChecker();

const analysisByFile = new Map();

for (const filePath of sourceFiles) {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) continue;

  const analysis = {
    filePath,
    liveChildren: new Set(),
    excludedChildren: new Set(),
    classTokens: new Set(),
    excludedClassTokens: new Set(),
    styleCount: 0,
    classAttrCount: 0,
    functionContexts: new Map(),
  };

  function visit(node, functionStack = []) {
    let nextStack = functionStack;
    const functionName = getFunctionName(node);
    if (functionName) {
      nextStack = functionStack.concat(functionName);
    }
    const excluded = nextStack.some((name) => excludedFunctionNames.has(name));

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName)) {
        let symbol = checker.getSymbolAtLocation(tagName);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
          symbol = checker.getAliasedSymbol(symbol);
        }
        const declaration = symbol && symbol.declarations && symbol.declarations[0];
        const childFile = declaration && declaration.getSourceFile().fileName;
        if (childFile && childFile.startsWith(srcRoot) && childFile !== filePath) {
          if (excluded) {
            analysis.excludedChildren.add(childFile);
          } else {
            analysis.liveChildren.add(childFile);
          }
        }
      }

      const attrs = node.attributes.properties;
      for (const attr of attrs) {
        if (!ts.isJsxAttribute(attr) || !attr.name) continue;
        const attrName = attr.name.text;
        if (attrName === 'style' && !excluded) {
          analysis.styleCount += 1;
        }
        if (attrName !== 'className') continue;
        if (!excluded) {
          analysis.classAttrCount += 1;
        }
        const targetSet = excluded ? analysis.excludedClassTokens : analysis.classTokens;
        if (!attr.initializer) continue;
        if (ts.isStringLiteral(attr.initializer)) {
          splitClassTokens(attr.initializer.text).forEach((token) => targetSet.add(token));
          continue;
        }
        if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          extractClassTokensFromExpression(attr.initializer.expression, targetSet);
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextStack));
  }

  visit(sourceFile, []);
  analysisByFile.set(filePath, analysis);
}

const liveFiles = new Set([uiEntryFile]);
const queue = [uiEntryFile];
const consumersByFile = new Map();

while (queue.length > 0) {
  const current = queue.shift();
  const analysis = analysisByFile.get(current);
  if (!analysis) continue;
  for (const childFile of analysis.liveChildren) {
    if (!consumersByFile.has(childFile)) consumersByFile.set(childFile, new Set());
    consumersByFile.get(childFile).add(current);
    if (!liveFiles.has(childFile)) {
      liveFiles.add(childFile);
      queue.push(childFile);
    }
  }
}

const captureOnlyFiles = new Set();
for (const filePath of analysisByFile.keys()) {
  if (liveFiles.has(filePath)) continue;
  const parents = [];
  for (const [parentFile, analysis] of analysisByFile.entries()) {
    if (analysis.excludedChildren.has(filePath) && !analysis.liveChildren.has(filePath)) {
      parents.push(parentFile);
    }
  }
  if (parents.length > 0) {
    captureOnlyFiles.add(filePath);
    consumersByFile.set(filePath, new Set(parents));
  }
}

const liveComponentFiles = componentCandidateFiles
  .filter((filePath) => fs.existsSync(filePath))
  .filter((filePath) => liveFiles.has(filePath));
const dormantComponentFiles = componentCandidateFiles
  .filter((filePath) => fs.existsSync(filePath))
  .filter((filePath) => !liveFiles.has(filePath));

const liveClassTokens = new Set();
const excludedClassTokens = new Set();
const inlineSummary = [];

for (const filePath of liveFiles) {
  const analysis = analysisByFile.get(filePath);
  if (!analysis) continue;
  analysis.classTokens.forEach((token) => liveClassTokens.add(token));
  analysis.excludedClassTokens.forEach((token) => excludedClassTokens.add(token));
  if (/\.(ts|tsx)$/.test(filePath) && (analysis.styleCount > 0 || analysis.classAttrCount > 0)) {
    inlineSummary.push({
      file: filePath,
      styleCount: analysis.styleCount,
      classAttrCount: analysis.classAttrCount,
    });
  }
}

inlineSummary.sort((a, b) => {
  if (b.styleCount !== a.styleCount) return b.styleCount - a.styleCount;
  return b.classAttrCount - a.classAttrCount;
});

const globalStylesSource = fs.readFileSync(globalStylesFile, 'utf8');
const templateMatch = globalStylesSource.match(/export const globalStyles = `([\s\S]*)`;\s*$/);
const globalCss = templateMatch ? templateMatch[1] : globalStylesSource;
const cssWithoutComments = globalCss.replace(/\/\*[\s\S]*?\*\//g, '');
const definedClassTokens = new Set();
for (const match of cssWithoutComments.matchAll(/\.([A-Za-z_-][A-Za-z0-9_-]*)/g)) {
  definedClassTokens.add(match[1]);
}

const usedAndDefined = [...liveClassTokens].filter((token) => definedClassTokens.has(token)).sort();
const usedButMissing = [...liveClassTokens].filter((token) => !definedClassTokens.has(token)).sort();
const definedButUnused = [...definedClassTokens]
  .filter((token) => !liveClassTokens.has(token))
  .sort();

const summary = {
  generatedAt: new Date().toISOString(),
  liveComponentFiles: liveComponentFiles.length,
  dormantComponentFiles: dormantComponentFiles.length,
  captureOnlyFiles: captureOnlyFiles.size,
  liveClassCount: liveClassTokens.size,
  definedClassCount: definedClassTokens.size,
  usedAndDefinedCount: usedAndDefined.length,
  usedButMissingCount: usedButMissing.length,
  definedButUnusedCount: definedButUnused.length,
  liveStyleAttrCount: inlineSummary.reduce((sum, item) => sum + item.styleCount, 0),
  liveClassAttrCount: inlineSummary.reduce((sum, item) => sum + item.classAttrCount, 0),
};

function renderFileList(files) {
  if (files.length === 0) return '<div class="empty">None</div>';
  return `
    <table>
      <thead>
        <tr><th>File</th><th>Consumed By</th></tr>
      </thead>
      <tbody>
        ${files.map((filePath) => {
          const consumers = [...(consumersByFile.get(filePath) || [])]
            .map((consumer) => toRel(consumer))
            .sort()
            .join(', ');
          return `<tr><td><code>${escapeHtml(toRel(filePath))}</code></td><td>${escapeHtml(consumers || 'entry')}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderTokenList(tokens, emptyLabel = 'None') {
  if (tokens.length === 0) return `<div class="empty">${escapeHtml(emptyLabel)}</div>`;
  return `<div class="chips">${tokens.map((token) => `<code>${escapeHtml(token)}</code>`).join('')}</div>`;
}

function renderInlineTable(items) {
  if (items.length === 0) return '<div class="empty">None</div>';
  return `
    <table>
      <thead>
        <tr><th>File</th><th>style attrs</th><th>class attrs</th><th>Signal</th></tr>
      </thead>
      <tbody>
        ${items.map((item) => {
          const signal = item.styleCount > item.classAttrCount
            ? 'inline-heavy'
            : item.classAttrCount > 0
              ? 'mixed'
              : 'class-light';
          return `
            <tr>
              <td><code>${escapeHtml(toRel(item.file))}</code></td>
              <td>${item.styleCount}</td>
              <td>${item.classAttrCount}</td>
              <td>${signal}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

const recommendations = [
  'Keep the CSS class layer small and intentional: hover, selected, exit animation, shimmer, skeleton, overlay states.',
  'The real simplification target is inline-heavy live files. Start with PromptInput, ModelPopover, ActionPopover, SettingsPanel, ChatFeature, and OnboardingView.',
  usedButMissing.length > 0
    ? `Promote these live-but-undefined classes into either real reusable classes or remove the class hook entirely: ${usedButMissing.join(', ')}.`
    : 'No live class tokens are missing from globalStyles.',
  definedButUnused.length > 0
    ? `Candidates to delete from globalStyles after visual verification: ${definedButUnused.slice(0, 10).join(', ')}${definedButUnused.length > 10 ? '…' : ''}.`
    : 'No unused global class tokens were found.',
];

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Runtime UI Usage Audit</title>
  <style>
    :root {
      --bg: #f6f6f6;
      --panel: #ffffff;
      --text: #171717;
      --muted: #666666;
      --border: rgba(0,0,0,0.08);
      --accent: #2f5fe8;
      --warn: #9e6100;
      --error: #c43c3c;
      --ok: #1d7a45;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
    }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 24px; }
    h2 { font-size: 15px; }
    p { margin: 0; color: var(--muted); }
    code {
      font-family: var(--mono);
      font-size: 12px;
      background: rgba(0,0,0,0.05);
      padding: 2px 6px;
      border-radius: 6px;
    }
    .meta {
      margin-bottom: 18px;
      color: var(--muted);
      font-size: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card, .section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.04);
    }
    .card {
      padding: 14px 16px;
    }
    .number {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .section {
      padding: 16px;
      margin-bottom: 14px;
    }
    .section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-head span {
      color: var(--muted);
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      border-top: none;
      padding-top: 0;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chips code.ok { color: var(--ok); }
    .chips code.warn { color: var(--warn); }
    .chips code.error { color: var(--error); }
    .empty {
      color: var(--muted);
      font-size: 13px;
      padding: 8px 0 2px;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      color: var(--text);
    }
    li + li {
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <h1>Runtime UI Usage Audit</h1>
  <div class="meta">
    Generated from <code>src/ui.tsx</code> render chain. Excludes <code>renderCaptureSandbox</code> from live usage.
    Snapshot: ${escapeHtml(summary.generatedAt)}.
  </div>

  <div class="grid">
    <div class="card"><div class="number">${summary.liveComponentFiles}</div><div class="label">Live Component Files</div></div>
    <div class="card"><div class="number">${summary.dormantComponentFiles}</div><div class="label">Dormant Component Files</div></div>
    <div class="card"><div class="number">${summary.usedAndDefinedCount}</div><div class="label">Live Classes With CSS</div></div>
    <div class="card"><div class="number">${summary.usedButMissingCount}</div><div class="label">Live Classes Missing CSS</div></div>
    <div class="card"><div class="number">${summary.definedButUnusedCount}</div><div class="label">Defined Classes Unused At Runtime</div></div>
    <div class="card"><div class="number">${summary.liveStyleAttrCount}:${summary.liveClassAttrCount}</div><div class="label">style attrs : class attrs</div></div>
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Live Render Chain</h2>
      <span>${summary.liveComponentFiles} reachable files</span>
    </div>
    ${renderFileList(liveComponentFiles)}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Dormant Component Files</h2>
      <span>${summary.dormantComponentFiles} not reached from <code>src/ui.tsx</code></span>
    </div>
    ${renderFileList(dormantComponentFiles)}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Capture-Only References</h2>
      <span>${captureOnlyFiles.size} files only referenced by excluded capture sandbox</span>
    </div>
    ${renderFileList([...captureOnlyFiles].sort())}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Live Classes With Definitions</h2>
      <span>${usedAndDefined.length} class tokens</span>
    </div>
    ${renderTokenList(usedAndDefined)}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Live Classes Missing In globalStyles</h2>
      <span>${usedButMissing.length} class tokens</span>
    </div>
    ${renderTokenList(usedButMissing, 'No missing live classes')}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Defined But Unused Class Tokens</h2>
      <span>${definedButUnused.length} class tokens</span>
    </div>
    ${renderTokenList(definedButUnused, 'No unused class tokens')}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Inline / Class Mix By Live File</h2>
      <span>Higher <code>style</code> counts are the best refactor targets</span>
    </div>
    ${renderInlineTable(inlineSummary)}
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Recommendations</h2>
      <span>Based on current runtime usage snapshot</span>
    </div>
    <ul>
      ${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  </div>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, html, 'utf8');

console.log(`Wrote ${toRel(outputFile)}`);
console.log(`Live component files: ${summary.liveComponentFiles}`);
console.log(`Dormant component files: ${summary.dormantComponentFiles}`);
console.log(`Live class tokens with CSS: ${summary.usedAndDefinedCount}`);
console.log(`Live class tokens missing CSS: ${summary.usedButMissingCount}`);
console.log(`Defined but unused class tokens: ${summary.definedButUnusedCount}`);
