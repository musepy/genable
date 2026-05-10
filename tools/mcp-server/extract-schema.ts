/**
 * @file extract-schema.ts
 * @description Build-time script: extract MCP-facing schema from `unifiedTools`
 * and write it to `tools-schema.json` in this directory.
 *
 * Why: The npm-published `genable-mcp` package must NOT depend on the rest
 * of the dogfood codebase (figma-typings, plugin runtime utilities, etc.).
 * By extracting only `{ name, description, parameters, mutates }` to a JSON
 * file at build time, the MCP server has zero source-level coupling to the
 * plugin — only a build-time data dependency.
 *
 * Run:
 *   npx tsx tools/mcp-server/extract-schema.ts
 *
 * Hooked into root build.js so every `node build.js` regenerates the schema.
 */
import { unifiedTools } from '../../src/engine/agent/tools/unified';
import * as fs from 'fs';
import * as path from 'path';

interface McpToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Sandbox advisory — true if tool mutates Figma state. Not used by MCP runtime today; reserved for future client-side warnings. */
  mutates?: boolean;
}

function extract(): McpToolSchema[] {
  return unifiedTools.map((t) => {
    const out: McpToolSchema = {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    };
    if (t.mutates !== undefined) out.mutates = t.mutates;
    return out;
  });
}

function main() {
  const schema = extract();

  // Sanity checks — fail loudly so build doesn't ship a broken schema.
  if (schema.length === 0) {
    console.error('[extract-schema] FATAL: unifiedTools is empty.');
    process.exit(1);
  }
  for (const t of schema) {
    if (!t.name || !t.description || !t.parameters) {
      console.error(`[extract-schema] FATAL: tool "${t.name}" is missing name/description/parameters.`);
      process.exit(1);
    }
  }

  const outputPath = path.join(__dirname, 'tools-schema.json');
  fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n');
  console.log(`[extract-schema] ✅ ${schema.length} tools → ${path.relative(process.cwd(), outputPath)}`);
}

main();
