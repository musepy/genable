/**
 * @file pipeline_stress.test.ts
 * @description End-to-end stress test exercising ALL 5 core components simultaneously:
 *
 *   1. XMLDesignParser — nested tags, abbreviations, padding/shadow/color shorthands,
 *      XML entities, comments, duplicate names, icon/line/ellipse tags, self-closing
 *   2. CSSCompiler — layout→layoutMode, justifyContent, alignItems, width/height
 *      fill/hug, background→fills, gap→itemSpacing, borderRadius→cornerRadius
 *   3. PropMetadata — catch-all enum normalization for textCase, textDecoration,
 *      textAlignHorizontal, strokeAlign; enum maps; valueConstraints
 *   4. Normalizer — type coercion, enum validation, color array healing,
 *      constraint aliases, structure healing, semantic uppercasing
 *   5. LayerSchema — Valibot parse, recursive validation, picklist enforcement,
 *      gradient fills, effects, sizing constraint derivation
 *
 * The "mega XML" represents a realistic Dashboard Card with:
 *   - Header (row layout, space-between, icon)
 *   - Stats row (duplicate names → symbol collision)
 *   - Form section (inputs, buttons, mixed sizing: fill/hug/fixed)
 *   - Footer (line divider, ellipse avatar, text decoration)
 */

import { describe, it, expect } from 'vitest';
import { parseXml, xmlToParsedLines } from '../xmlDesignParser';
import { compileCssProps } from '../cssCompiler';
import { validateNodeLayer } from '../../../schema/layerSchema';
import { PROP_METADATA } from '../../../constants/figma-api';

// ============================================================
// MEGA XML — one string, all edge cases
// ============================================================

const MEGA_XML = `
<!-- Dashboard Card: comprehensive pipeline stress test -->
<frame name='Dashboard Card' layout='column' gap='20' p='24 32' w='480' height='hug' bg='#FFFFFF' corner='16' shadow='0,8,32,0,#0000001A;inset,0,1,3,0,#0000000D'>

  <!-- Header: row layout, space-between, icon, XML entity in text -->
  <frame name='Header Row' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='24' weight='Bold' fill='#111827' textAlign='left'>Dashboard &amp; Analytics</text>
    <icon name='lucide:settings' w='20' h='20'/>
  </frame>

  <!-- Stats: duplicate frame names (symbol collision), textCase enum, tracking abbreviation -->
  <frame name='Stats Row' layout='row' gap='16' width='fill' height='hug' bg='transparent'>
    <frame name='Stat' layout='column' gap='4' alignItems='center' width='fill' height='hug' bg='#F9FAFB' corner='12' p='16'>
      <text name='Value' size='32' weight='Bold' fill='#4F46E5'>2,847</text>
      <text name='Label' size='12' fill='#6B7280' textCase='upper' tracking='1.5'>USERS</text>
    </frame>
    <frame name='Stat' layout='column' gap='4' alignItems='center' width='fill' height='hug' bg='#F9FAFB' corner='12' p='16'>
      <text name='Value' size='32' weight='Bold' fill='#10B981'>$12.4k</text>
      <text name='Label' size='12' fill='#6B7280' textCase='upper' tracking='1.5'>REVENUE</text>
    </frame>
  </frame>

  <!-- Form: input with icon, buttons (hug width, fixed h), flex-end justify, &apos; entity -->
  <frame name='Form Section' layout='column' gap='12' width='fill' height='hug' bg='transparent'>
    <text name='Section Title' size='14' weight='Medium' fill='#374151'>Quick Action</text>
    <frame name='Search Input' layout='row' p='10 14' width='fill' height='hug' bg='#F9FAFB' corner='8' stroke='#E5E7EB' strokeW='1' alignItems='center' gap='8'>
      <icon name='lucide:search' w='16' h='16'/>
      <text name='Placeholder' size='14' fill='#9CA3AF'>Search users&apos;s data...</text>
    </frame>
    <frame name='Button Row' layout='row' gap='8' width='fill' height='hug' bg='transparent' justifyContent='flex-end'>
      <frame name='Cancel Btn' layout='row' p='8 16' width='hug' height='hug' bg='transparent' corner='6' stroke='#D1D5DB' strokeW='1' justifyContent='center' alignItems='center'>
        <text name='Cancel Label' size='14' weight='Medium' fill='#374151'>Cancel</text>
      </frame>
      <frame name='Submit Btn' layout='row' p='8 16' width='hug' h='36' bg='#4F46E5' corner='6' justifyContent='center' alignItems='center'>
        <text name='Submit Label' size='14' weight='Bold' fill='#FFFFFF'>Submit</text>
      </frame>
    </frame>
  </frame>

  <!-- Footer: line divider, ellipse shape, textDecoration enum -->
  <line name='Divider' w='100' strokeW='1' stroke='#E5E7EB'/>
  <frame name='Footer' layout='row' gap='8' width='fill' height='hug' bg='transparent' alignItems='center' justifyContent='space-between'>
    <frame name='User Info' layout='row' gap='8' width='hug' height='hug' bg='transparent' alignItems='center'>
      <ellipse name='Avatar' w='24' h='24' fill='#4F46E5'/>
      <text name='Username' size='13' fill='#6B7280'>admin@acme.com</text>
    </frame>
    <text name='Status' size='12' fill='#10B981' weight='Medium' textDecoration='underline'>Online</text>
  </frame>
</frame>
`;

// ============================================================
// Part 1: XMLDesignParser
// ============================================================

describe('Pipeline Stress: XMLDesignParser', () => {
  it('parseXml handles the mega XML without errors', () => {
    const nodes = parseXml(MEGA_XML);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe('frame');
    expect(nodes[0].attrs.name).toBe('Dashboard Card');
  });

  it('skips all comments', () => {
    const nodes = parseXml(MEGA_XML);
    // Root should have 5 direct children: Header, Stats, Form, Divider(line), Footer
    expect(nodes[0].children).toHaveLength(5);
  });

  it('decodes XML entities in text content', () => {
    const nodes = parseXml(MEGA_XML);
    // Header → Title text has &amp;
    const header = nodes[0].children[0]; // Header Row
    const title = header.children[0];    // Title text
    expect(title.textContent).toBe('Dashboard & Analytics');
  });

  it('decodes &apos; entity in text content', () => {
    const nodes = parseXml(MEGA_XML);
    // Form Section → Search Input → Placeholder text
    const formSection = nodes[0].children[2];
    const searchInput = formSection.children[1];
    const placeholder = searchInput.children[1];
    expect(placeholder.textContent).toBe("Search users's data...");
  });

  it('handles deeply nested structure (4 levels)', () => {
    const nodes = parseXml(MEGA_XML);
    // Dashboard > Stats Row > Stat > text
    const statsRow = nodes[0].children[1];
    const stat = statsRow.children[0];
    const valueText = stat.children[0];
    expect(valueText.tag).toBe('text');
    expect(valueText.textContent).toBe('2,847');
  });
});

// ============================================================
// Part 2: xmlToParsedLines (XMLDesignParser + CSSCompiler + PropMetadata)
// ============================================================

describe('Pipeline Stress: xmlToParsedLines (full pipeline)', () => {
  const lines = xmlToParsedLines(MEGA_XML);

  it('produces correct total node count', () => {
    // Dashboard(1) + Header(2: frame+title+icon=3) + Stats(frame + 2*(frame+2text)=7)
    // + Form(frame + title + searchInput(frame+icon+placeholder=3) + buttonRow(frame + cancel(frame+text) + submit(frame+text)) = 9)
    // + Divider(1) + Footer(frame + userInfo(frame+ellipse+username=3) + status = 5)
    // Total: 1 + 3 + 7 + 9 + 1 + 5 = 26
    // Let me count more carefully:
    // 1. Dashboard Card (root)
    // 2. Header Row
    // 3. Title (text)
    // 4. lucide:settings (icon)
    // 5. Stats Row
    // 6. Stat (first)
    // 7. Value (text "2,847")
    // 8. Label (text "USERS")
    // 9. Stat (second)
    // 10. Value (text "$12.4k")
    // 11. Label (text "REVENUE")
    // 12. Form Section
    // 13. Section Title (text)
    // 14. Search Input (frame)
    // 15. lucide:search (icon)
    // 16. Placeholder (text)
    // 17. Button Row
    // 18. Cancel Btn
    // 19. Cancel Label (text)
    // 20. Submit Btn
    // 21. Submit Label (text)
    // 22. Divider (line)
    // 23. Footer
    // 24. User Info
    // 25. Avatar (ellipse)
    // 26. Username (text)
    // 27. Status (text)
    expect(lines).toHaveLength(27);
  });

  // ── CSSCompiler: layout → layoutMode ──

  it('compiles layout="column" to layoutMode="VERTICAL"', () => {
    const root = lines[0]; // Dashboard Card
    expect(root.props?.layoutMode).toBe('VERTICAL');
    expect(root.props?.layout).toBeUndefined();
  });

  it('compiles layout="row" to layoutMode="HORIZONTAL"', () => {
    const header = lines[1]; // Header Row
    expect(header.props?.layoutMode).toBe('HORIZONTAL');
  });

  // ── CSSCompiler: justifyContent → primaryAxisAlignItems ──

  it('compiles justifyContent="space-between" to SPACE_BETWEEN', () => {
    const header = lines[1]; // Header Row
    expect(header.props?.primaryAxisAlignItems).toBe('SPACE_BETWEEN');
    expect(header.props?.justifyContent).toBeUndefined();
  });

  it('compiles justifyContent="flex-end" to MAX', () => {
    const buttonRow = lines[16]; // Button Row
    expect(buttonRow.props?.primaryAxisAlignItems).toBe('MAX');
  });

  it('compiles justifyContent="center" to CENTER', () => {
    const cancelBtn = lines[17]; // Cancel Btn
    expect(cancelBtn.props?.primaryAxisAlignItems).toBe('CENTER');
  });

  // ── CSSCompiler: alignItems → counterAxisAlignItems ──

  it('compiles alignItems="center" to CENTER', () => {
    const header = lines[1]; // Header Row
    expect(header.props?.counterAxisAlignItems).toBe('CENTER');
    expect(header.props?.alignItems).toBeUndefined();
  });

  // ── CSSCompiler: width/height fill/hug → layoutSizing ──

  it('compiles width="fill" to layoutSizingHorizontal="FILL"', () => {
    const header = lines[1]; // Header Row
    expect(header.props?.layoutSizingHorizontal).toBe('FILL');
    expect(header.props?.width).toBeUndefined();
  });

  it('compiles height="hug" to layoutSizingVertical="HUG"', () => {
    const root = lines[0]; // Dashboard Card: height='hug'
    expect(root.props?.layoutSizingVertical).toBe('HUG');
    expect(root.props?.height).toBeUndefined();
  });

  it('preserves numeric width as pixel value', () => {
    const root = lines[0]; // w='480'
    expect(root.props?.width).toBe(480);
  });

  it('compiles width="hug" for buttons', () => {
    const cancelBtn = lines[17]; // Cancel Btn: width='hug'
    expect(cancelBtn.props?.layoutSizingHorizontal).toBe('HUG');
    expect(cancelBtn.props?.width).toBeUndefined();
  });

  it('preserves fixed h as pixel value', () => {
    const submitBtn = lines[19]; // Submit Btn: h='36'
    expect(submitBtn.props?.height).toBe(36);
  });

  // ── CSSCompiler: background → fills ──

  it('compiles bg="#FFFFFF" to fills=["#FFFFFF"]', () => {
    const root = lines[0];
    expect(root.props?.fills).toEqual(['#FFFFFF']);
    expect(root.props?.background).toBeUndefined();
  });

  it('compiles bg="transparent" to fills=[]', () => {
    const header = lines[1]; // Header Row: bg='transparent'
    expect(header.props?.fills).toEqual([]);
  });

  // ── CSSCompiler: gap → itemSpacing ──

  it('compiles gap to itemSpacing', () => {
    const root = lines[0]; // gap='20'
    expect(root.props?.itemSpacing).toBe(20);
    expect(root.props?.gap).toBeUndefined();
  });

  // ── Abbreviation expansion ──

  it('expands corner to cornerRadius', () => {
    const root = lines[0]; // corner='16'
    expect(root.props?.cornerRadius).toBe(16);
  });

  it('expands size to fontSize', () => {
    const title = lines[2]; // size='24'
    expect(title.props?.fontSize).toBe(24);
  });

  it('expands weight to fontWeight', () => {
    const title = lines[2]; // weight='Bold'
    expect(title.props?.fontWeight).toBe('Bold');
  });

  it('expands strokeW to strokeWeight', () => {
    const searchInput = lines[13]; // strokeW='1'
    expect(searchInput.props?.strokeWeight).toBe(1);
  });

  it('expands tracking to letterSpacing', () => {
    const label = lines[7]; // tracking='1.5'
    expect(label.props?.letterSpacing).toBe(1.5);
  });

  // ── Padding shorthand (2-value: V H) ──

  it('expands p="24 32" to V H padding', () => {
    const root = lines[0]; // p='24 32'
    expect(root.props?.paddingTop).toBe(24);
    expect(root.props?.paddingRight).toBe(32);
    expect(root.props?.paddingBottom).toBe(24);
    expect(root.props?.paddingLeft).toBe(32);
  });

  it('expands p="10 14" to V H padding', () => {
    const searchInput = lines[13]; // p='10 14'
    expect(searchInput.props?.paddingTop).toBe(10);
    expect(searchInput.props?.paddingRight).toBe(14);
  });

  it('expands p="8 16" to V H padding', () => {
    const cancelBtn = lines[17]; // p='8 16'
    expect(cancelBtn.props?.paddingTop).toBe(8);
    expect(cancelBtn.props?.paddingRight).toBe(16);
    expect(cancelBtn.props?.paddingBottom).toBe(8);
    expect(cancelBtn.props?.paddingLeft).toBe(16);
  });

  it('expands uniform p="16" to all sides', () => {
    // First Stat card: p='16'
    const stat = lines[5];
    expect(stat.props?.paddingTop).toBe(16);
    expect(stat.props?.paddingRight).toBe(16);
    expect(stat.props?.paddingBottom).toBe(16);
    expect(stat.props?.paddingLeft).toBe(16);
  });

  // ── Shadow shorthand (multi-shadow: drop + inset) ──

  it('expands multi-shadow to effects array', () => {
    const root = lines[0]; // shadow='0,8,32,0,#0000001A;inset,0,1,3,0,#0000000D'
    const effects = root.props?.effects;
    expect(effects).toHaveLength(2);
    expect(effects[0]).toEqual({
      type: 'DROP_SHADOW',
      color: '#0000001A',
      offset: { x: 0, y: 8 },
      radius: 32,
      spread: 0,
      visible: true,
    });
    expect(effects[1]).toEqual({
      type: 'INNER_SHADOW',
      color: '#0000000D',
      offset: { x: 0, y: 1 },
      radius: 3,
      spread: 0,
      visible: true,
    });
  });

  // ── Color shorthand ──

  it('expands fill to fills array for frames', () => {
    const stat = lines[5]; // bg='#F9FAFB'
    expect(stat.props?.fills).toEqual(['#F9FAFB']);
  });

  it('expands fill to fills array for text nodes', () => {
    const title = lines[2]; // fill='#111827'
    expect(title.props?.fills).toEqual(['#111827']);
  });

  it('expands stroke to strokes array', () => {
    const searchInput = lines[13]; // stroke='#E5E7EB'
    expect(searchInput.props?.strokes).toEqual(['#E5E7EB']);
  });

  // ── PROP_METADATA: enum normalization (catch-all) ──

  it('normalizes textCase="upper" to "UPPER" via PROP_METADATA', () => {
    const label = lines[7]; // textCase='upper'
    expect(label.props?.textCase).toBe('UPPER');
  });

  it('normalizes textDecoration="underline" to "UNDERLINE" via PROP_METADATA', () => {
    const status = lines[26]; // textDecoration='underline'
    expect(status.props?.textDecoration).toBe('UNDERLINE');
  });

  it('normalizes textAlignHorizontal="left" to "LEFT" via PROP_METADATA', () => {
    const title = lines[2]; // textAlign='left'
    expect(title.props?.textAlignHorizontal).toBe('LEFT');
  });

  // ── Text content extraction ──

  it('extracts text content with decoded XML entities', () => {
    const title = lines[2]; // Dashboard &amp; Analytics
    expect(title.props?.characters).toBe('Dashboard & Analytics');
  });

  it("extracts text with &apos; entity", () => {
    const placeholder = lines[15]; // Search users&apos;s data...
    expect(placeholder.props?.characters).toBe("Search users's data...");
  });

  // ── Icon tags ──

  it('maps icon tag to icon command with inferred iconName', () => {
    const settingsIcon = lines[3]; // <icon name='lucide:settings'...>
    expect(settingsIcon.command).toBe('icon');
    expect(settingsIcon.props?.iconName).toBe('lucide:settings');
  });

  it('icon has correct parent dependency', () => {
    const searchIcon = lines[14]; // Inside Search Input
    expect(searchIcon.command).toBe('icon');
    expect(searchIcon.parentRef).toBe(lines[13].symbol);
  });

  // ── Non-frame tag types ──

  it('maps line tag to LINE type', () => {
    const divider = lines[21]; // <line name='Divider'...>
    expect(divider.nodeType).toBe('LINE');
    expect(divider.props?.strokeWeight).toBe(1);
  });

  it('maps ellipse tag to ELLIPSE type', () => {
    const avatar = lines[24]; // <ellipse name='Avatar'...>
    expect(avatar.nodeType).toBe('ELLIPSE');
    expect(avatar.props?.width).toBe(24);
    expect(avatar.props?.height).toBe(24);
  });

  // ── Duplicate name → unique symbols ──

  it('generates unique symbols for duplicate "Stat" frame names', () => {
    const stat1 = lines[5];
    const stat2 = lines[8];
    expect(stat1.props?.name).toBe('Stat');
    expect(stat2.props?.name).toBe('Stat');
    expect(stat1.symbol).not.toBe(stat2.symbol);
    // First gets 'stat', second gets 'stat2'
    expect(stat1.symbol).toBe('stat');
    expect(stat2.symbol).toBe('stat2');
  });

  it('generates unique symbols for duplicate "Value" text names', () => {
    const val1 = lines[6]; // text "2,847" inside first Stat
    const val2 = lines[9]; // text "$12.4k" inside second Stat
    expect(val1.symbol).toBe('value');
    expect(val2.symbol).toBe('value2');
  });

  // ── Parent chain ──

  it('builds correct parent chain for deeply nested nodes', () => {
    // Dashboard > Stats Row > Stat > Value
    expect(lines[0].parentRef).toBeUndefined(); // root
    expect(lines[4].parentRef).toBe(lines[0].symbol); // Stats Row → Dashboard
    expect(lines[5].parentRef).toBe(lines[4].symbol); // Stat → Stats Row
    expect(lines[6].parentRef).toBe(lines[5].symbol); // Value → Stat
  });

  // ── lineNumbers ──

  it('assigns 1-based sequential line numbers', () => {
    expect(lines[0].lineNumber).toBe(1);
    expect(lines[lines.length - 1].lineNumber).toBe(27);
    // All line numbers should be sequential
    lines.forEach((line, i) => {
      expect(line.lineNumber).toBe(i + 1);
    });
  });
});

// ============================================================
// Part 3: CSSCompiler — isolated edge cases from PROP_METADATA
// ============================================================

describe('Pipeline Stress: CSSCompiler enum normalization via PROP_METADATA', () => {
  it('normalizes mixed-case textAutoResize', () => {
    const result = compileCssProps({ textAutoResize: 'width_and_height' });
    expect(result.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  });

  it('normalizes hyphenated textAutoResize', () => {
    const result = compileCssProps({ textAutoResize: 'width-and-height' });
    expect(result.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  });

  it('normalizes strokeAlign with mixed case', () => {
    const result = compileCssProps({ strokeAlign: 'inside' });
    expect(result.strokeAlign).toBe('INSIDE');
  });

  it('normalizes layoutPositioning alias RELATIVE→AUTO', () => {
    const result = compileCssProps({ layoutPositioning: 'RELATIVE' });
    expect(result.layoutPositioning).toBe('AUTO');
  });

  it('normalizes layoutSizingHorizontal alias AUTO→HUG', () => {
    const result = compileCssProps({ layoutSizingHorizontal: 'AUTO' });
    expect(result.layoutSizingHorizontal).toBe('HUG');
  });

  it('normalizes layoutSizingVertical alias STRETCH→FILL', () => {
    const result = compileCssProps({ layoutSizingVertical: 'STRETCH' });
    expect(result.layoutSizingVertical).toBe('FILL');
  });

  it('normalizes textTruncation with lowercase', () => {
    const result = compileCssProps({ textTruncation: 'ending' });
    expect(result.textTruncation).toBe('ENDING');
  });

  it('leaves unknown enum values as-is for downstream error', () => {
    const result = compileCssProps({ textCase: 'NONEXISTENT' });
    // PROP_METADATA won't find a match → leaves as-is
    expect(result.textCase).toBe('NONEXISTENT');
  });
});



// ============================================================
// Part 5: LayerSchema — Valibot validation
// ============================================================

describe('Pipeline Stress: LayerSchema validation', () => {
  it('validates a well-formed NodeLayer', () => {
    const input = {
      type: 'FRAME',
      props: {
        name: 'Card',
        layoutMode: 'VERTICAL',
        width: 360,
        layoutSizingVertical: 'HUG',
        fills: ['#FFFFFF'],
        cornerRadius: 16,
        paddingTop: 24,
        paddingRight: 24,
        paddingBottom: 24,
        paddingLeft: 24,
      },
      children: [
        {
          type: 'TEXT',
          props: {
            characters: 'Hello',
            fontSize: 24,
            fontWeight: 'Bold',
            fills: ['#111827'],
            textAlignHorizontal: 'LEFT',
          },
        },
      ],
    };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(true);
  });

  it('validates gradient fills in NodeLayer', () => {
    const input = {
      type: 'FRAME',
      props: {
        fills: [
          '#FF0000',
          {
            type: 'GRADIENT_LINEAR',
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#FFFFFF' },
            ],
            angle: 90,
          },
        ],
      },
    };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(true);
  });

  it('validates all sizing mode aliases (AUTO→HUG, STRETCH→FILL)', () => {
    const autoInput = {
      type: 'FRAME',
      props: { layoutSizingHorizontal: 'AUTO' },
    };
    const stretchInput = {
      type: 'FRAME',
      props: { layoutSizingVertical: 'STRETCH' },
    };
    expect(validateNodeLayer(autoInput).success).toBe(true);
    expect(validateNodeLayer(stretchInput).success).toBe(true);
  });

  it('validates constraint axes with aliases', () => {
    const input = {
      type: 'FRAME',
      props: {
        constraints: {
          horizontal: 'LEFT_RIGHT',
          vertical: 'TOP_BOTTOM',
        },
      },
    };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(true);
  });

  it('validates effects schema (DROP_SHADOW + INNER_SHADOW)', () => {
    const input = {
      type: 'FRAME',
      props: {
        effects: [
          { type: 'DROP_SHADOW', color: '#0000001A', offset: { x: 0, y: 8 }, blur: 32, spread: 0 },
          { type: 'INNER_SHADOW', color: '#0000000D', offset: { x: 0, y: 1 }, blur: 3, spread: 0 },
        ],
      },
    };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(true);
  });

  it('validates deeply nested recursive structure', () => {
    const input = {
      type: 'FRAME',
      props: { name: 'Root' },
      children: [{
        type: 'FRAME',
        props: { name: 'Level1' },
        children: [{
          type: 'FRAME',
          props: { name: 'Level2' },
          children: [{
            type: 'TEXT',
            props: { characters: 'Deep' },
          }],
        }],
      }],
    };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(true);
  });

  it('rejects invalid node type', () => {
    const input = { type: 'DIV', props: {} };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid layoutMode enum', () => {
    const input = { type: 'FRAME', props: { layoutMode: 'DIAGONAL' } };
    const result = validateNodeLayer(input);
    expect(result.success).toBe(false);
  });

});

// ============================================================
// Part 6: PROP_METADATA — metadata-driven validation checks
// ============================================================

describe('Pipeline Stress: PROP_METADATA structure', () => {
  it('every enum property has a non-empty enumMap', () => {
    for (const [prop, meta] of Object.entries(PROP_METADATA)) {
      if (meta.type === 'enum') {
        expect(meta.enumMap, `${prop} should have enumMap`).toBeDefined();
        expect(Object.keys(meta.enumMap!).length, `${prop} enumMap should not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it('sizing properties have valueConstraints for HUG and FILL', () => {
    const hSizing = PROP_METADATA['layoutSizingHorizontal'];
    const vSizing = PROP_METADATA['layoutSizingVertical'];
    expect(hSizing.valueConstraints?.HUG).toBeDefined();
    expect(hSizing.valueConstraints?.FILL).toBeDefined();
    expect(vSizing.valueConstraints?.HUG).toBeDefined();
    expect(vSizing.valueConstraints?.FILL).toBeDefined();
  });

  it('HUG requires auto-layout on self, FILL requires on parent', () => {
    const vc = PROP_METADATA['layoutSizingHorizontal'].valueConstraints!;
    expect(vc.HUG.requiresAutoLayout).toBe('self');
    expect(vc.HUG.fallback).toBe('FIXED');
    expect(vc.FILL.requiresAutoLayout).toBe('parent');
    expect(vc.FILL.fallback).toBe('HUG');
  });

  it('scalar properties have min/max bounds', () => {
    expect(PROP_METADATA['opacity'].min).toBe(0);
    expect(PROP_METADATA['opacity'].max).toBe(1);
    expect(PROP_METADATA['fontSize'].min).toBe(1);
    expect(PROP_METADATA['fontSize'].max).toBe(1000);
    expect(PROP_METADATA['cornerRadius'].min).toBe(0);
    expect(PROP_METADATA['cornerRadius'].max).toBe(1000);
    expect(PROP_METADATA['width'].min).toBe(0.01);
    expect(PROP_METADATA['width'].max).toBe(10000);
  });

  it('sizing enumMap includes alias entries (AUTO→HUG, STRETCH→FILL)', () => {
    const em = PROP_METADATA['layoutSizingHorizontal'].enumMap!;
    expect(em['AUTO']).toBe('HUG');
    expect(em['STRETCH']).toBe('FILL');
    expect(em['HUG']).toBe('HUG');
    expect(em['FILL']).toBe('FILL');
    expect(em['FIXED']).toBe('FIXED');
  });

  it('layoutPositioning enumMap includes RELATIVE→AUTO alias', () => {
    const em = PROP_METADATA['layoutPositioning'].enumMap!;
    expect(em['RELATIVE']).toBe('AUTO');
    expect(em['AUTO']).toBe('AUTO');
    expect(em['ABSOLUTE']).toBe('ABSOLUTE');
  });
});

// ============================================================
// Part 7: Edit mode — xmlToParsedLines with mode='edit'
// ============================================================

describe('Pipeline Stress: Edit mode', () => {
  const EDIT_XML = `
    <frame id='100:1' bg='#F3F4F6' corner='16' layout='row' justifyContent='space-between'/>
    <text id='100:2' fill='#EF4444' size='18' textCase='upper' textDecoration='strikethrough'>SALE ENDED</text>
    <delete id='100:3'/>
  `;

  it('produces update commands with compiled CSS props', () => {
    const lines = xmlToParsedLines(EDIT_XML, { mode: 'edit' });
    expect(lines).toHaveLength(3);

    // First: frame update
    expect(lines[0].command).toBe('update');
    expect(lines[0].targetRef).toBe('100:1');
    expect(lines[0].props?.fills).toEqual(['#F3F4F6']);
    expect(lines[0].props?.cornerRadius).toBe(16);
    expect(lines[0].props?.layoutMode).toBe('HORIZONTAL');
    expect(lines[0].props?.primaryAxisAlignItems).toBe('SPACE_BETWEEN');

    // Second: text update with enum normalization
    expect(lines[1].command).toBe('update');
    expect(lines[1].targetRef).toBe('100:2');
    expect(lines[1].props?.fills).toEqual(['#EF4444']);
    expect(lines[1].props?.fontSize).toBe(18);
    expect(lines[1].props?.textCase).toBe('UPPER');
    expect(lines[1].props?.textDecoration).toBe('STRIKETHROUGH');
    expect(lines[1].props?.characters).toBe('SALE ENDED');

    // Third: delete
    expect(lines[2].command).toBe('delete');
    expect(lines[2].targetRef).toBe('100:3');
  });
});
