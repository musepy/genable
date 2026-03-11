export interface StyleGuideEntry {
  tags: string[];
  content: string;
}

export interface StyleGuideMatch {
  name: string;
  guide: StyleGuideEntry;
  matchedTags: string[];
  score: number;
  exactMatches: number;
  coverage: number;
}

const HIGH_SIGNAL_TAGS = new Set([
  'dashboard',
  'landing-page',
  'webapp',
  'wellness',
  'corporate',
  'fintech',
  'developer',
  'editorial',
  'organic',
]);

const MEDIUM_SIGNAL_TAGS = new Set([
  'light-mode',
  'dark-mode',
  'blue-accent',
  'green-accent',
  'earth-tones',
  'warm',
]);

const LOW_SIGNAL_TAGS = new Set([
  'clean',
  'minimal',
  'rounded',
  'shadows',
  'sharp-corners',
  'soft',
  'bold',
  'bold-typography',
  'monochrome',
  'monospace',
  'crisp',
  'high-contrast',
]);

export function normalizeStyleTags(input: string | string[]): string[] {
  const rawTags = Array.isArray(input) ? input : input.split(',');
  return [...new Set(
    rawTags
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export function matchStyleGuide(
  query: string | string[],
  guides: Record<string, StyleGuideEntry>
): StyleGuideMatch | null {
  const queryTags = normalizeStyleTags(query);
  if (queryTags.length === 0) return null;

  const totalQueryWeight = queryTags.reduce((sum, tag) => sum + getTagWeight(tag), 0);
  const matches = Object.entries(guides)
    .map(([name, guide]) => {
      const matchedTags = queryTags.filter(tag => guide.tags.includes(tag));
      const score = matchedTags.reduce((sum, tag) => sum + getTagWeight(tag), 0);
      const coverage = totalQueryWeight > 0 ? score / totalQueryWeight : 0;
      return {
        name,
        guide,
        matchedTags,
        score,
        exactMatches: matchedTags.length,
        coverage,
      };
    })
    .filter(match => match.score > 0);

  if (matches.length === 0) return null;

  matches.sort((a, b) => (
    b.score - a.score
    || countHighSignalMatches(b.matchedTags) - countHighSignalMatches(a.matchedTags)
    || b.exactMatches - a.exactMatches
    || b.coverage - a.coverage
    || a.name.localeCompare(b.name)
  ));

  return matches[0];
}

function getTagWeight(tag: string): number {
  if (HIGH_SIGNAL_TAGS.has(tag)) return 5;
  if (MEDIUM_SIGNAL_TAGS.has(tag)) return 3;
  if (LOW_SIGNAL_TAGS.has(tag)) return 1;
  return 2;
}

function countHighSignalMatches(tags: string[]): number {
  return tags.filter(tag => HIGH_SIGNAL_TAGS.has(tag)).length;
}
