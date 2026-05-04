#!/usr/bin/env bash
# tools/check-prompt-consistency.sh
#
# Grep guard for LLM-facing teaching contradictions.
# Fast (< 2s — pure grep). Exits non-zero on any violation.
#
# Run: npm run check:prompts
# Or directly: bash tools/check-prompt-consistency.sh
#
# See .agent/teaching-manifest.yaml for the full surface map and the
# incident history that motivated these checks.

set -euo pipefail

# ── Locate repo root ──────────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
CHECKS=0

fail() {
  local check="$1" surface="$2" matched="$3" why="$4" fix="$5"
  echo ""
  echo "  FAIL: $check"
  echo "    surface: $surface"
  echo "    matched: $matched"
  echo "    why: $why"
  echo "    fix: $fix"
  FAILURES=$((FAILURES + 1))
}

# ── Check 1 ───────────────────────────────────────────────────────────────────
# No object-form examples in LLM-facing prompts.
# Rationale: object-form ({variable_id:...}) silently stringifies on string-mode
# LLM providers, producing broken bindings. The May 2026 weather-widget incident
# (36 silent black fills) was caused by this exact pattern surviving a partial revert.
# Only the string form ($Coll/Name) should appear as a POSITIVE example in prompts/skills.
# jsx.ts is allowed to mention it as an ANTI-PATTERN with "drop the binding silently".
CHECKS=$((CHECKS + 1))
echo "[ 1/5 ] Checking: no object-form variable examples in LLM-facing prompts ..."

# We grep for: {variable_id: or {collection_id, but not the anti-pattern warning
# in jsx.ts (which says "drop the binding silently" — a negative example, not a prescription).
# Strategy: find matches, then filter out the known-safe anti-pattern line in jsx.ts.
OBJ_PATTERN='{variable_id:'
PROMPT_FILES_TO_CHECK=("src/prompts/SYSTEM.md")
SKILL_FILES_TO_CHECK=()
while IFS= read -r -d '' f; do
  SKILL_FILES_TO_CHECK+=("$f")
done < <(find ".agent/skills" -name "SKILL.md" -not -path "*/_archive/*" -print0 2>/dev/null)

ALL_PROMPT_TARGETS=("${PROMPT_FILES_TO_CHECK[@]}" "${SKILL_FILES_TO_CHECK[@]+"${SKILL_FILES_TO_CHECK[@]}"}")

if [ ${#ALL_PROMPT_TARGETS[@]} -gt 0 ]; then
  while IFS= read -r hit; do
    file_part="${hit%%:*}"
    line_rest="${hit#*:}"
    lineno="${line_rest%%:*}"
    content="${line_rest#*:}"
    # Allow the jsx.ts anti-pattern warning (contains "drop the binding silently")
    # That file is in src/engine/..., not in prompts/skills — but double-check anyway.
    fail "No object-form examples in LLM-facing prompts" \
      "$file_part:$lineno" \
      "$(echo "$content" | head -c 100)" \
      "Object-form variable examples teach a form that silently breaks on string-mode LLM providers." \
      "Remove the {variable_id:...} example or replace with the string form (\$Coll/Name)."
  done < <(grep -rn "$OBJ_PATTERN" "${ALL_PROMPT_TARGETS[@]}" 2>/dev/null || true)
fi

# ── Check 2 ───────────────────────────────────────────────────────────────────
# No "bare-name rejected" claims anywhere in prompts/skills.
# Rationale: after the May 2026 strict-mode removal, bare-name binding is
# the ONLY supported LLM-facing form. Claims that bare names get rejected
# are stale and would steer the LLM toward the (broken) object form.
CHECKS=$((CHECKS + 1))
echo "[ 2/5 ] Checking: no 'bare-name rejected' claims in prompts ..."

BARE_REJECTED_PATTERNS=("bare-name strings are rejected" "Bare-name binding is not allowed" "bare-name.*rejected" "Bare-name.*rejected")
PROMPT_SKILL_DIRS=("src/prompts" ".agent/skills")

for pattern in "${BARE_REJECTED_PATTERNS[@]}"; do
  while IFS= read -r hit; do
    file_part="${hit%%:*}"
    line_rest="${hit#*:}"
    lineno="${line_rest%%:*}"
    content="${line_rest#*:}"
    fail "No bare-name-rejected claims in prompts" \
      "$file_part:$lineno" \
      "$(echo "$content" | head -c 120)" \
      "Bare-name binding is the only supported LLM-facing form post May-2026 cleanup; rejection is impossible at the resolver." \
      "Remove the claim entirely — there is no opt-in mode that makes it true."
  done < <(grep -rn -E "$pattern" "${PROMPT_SKILL_DIRS[@]}" 2>/dev/null || true)
done

# ── Check 3 ───────────────────────────────────────────────────────────────────
# No stale phase / strict-mode nomenclature in src/.
# Rationale: the old 4-value enum (phase1 / phase2-mode-coverage / phase2-strict / auto)
# was collapsed to 2 values in May 2026, and then the 2-value enum itself
# ('mode-coverage' / 'strict') was deleted in the May-2026 strict-mode cleanup.
# Any remaining references to the old names are dead code or misleading comments.
# Exceptions:
#   - agentBehaviorConfig.ts JSDoc (explains the rename history — explicitly allowed)
#   - __tests__/ directories (tests reference old names in headers/comments for clarity)
#   - strictResolver.ts (file name retained; see its header for context)
#   - modeCoverageCheck.ts (variable name; describes the check, not a runtime mode)
#   - teaching-manifest.yaml history entries
#   - Lines with "// historical:" or "// legacy naming:" comment markers
CHECKS=$((CHECKS + 1))
echo "[ 3/5 ] Checking: no stale phase / strict-mode nomenclature (phase1 / phase2-* / VariableResolutionMode) ..."

STALE_NAMES=("phase2-mode-coverage" "phase2-strict" "'phase1'" '"phase1"' "VariableResolutionMode" "setVariableResolutionMode" "getVariableResolutionMode")

for name in "${STALE_NAMES[@]}"; do
  while IFS= read -r hit; do
    file_part="${hit%%:*}"
    line_rest="${hit#*:}"
    lineno="${line_rest%%:*}"
    content="${line_rest#*:}"

    # Allow agentBehaviorConfig.ts (historical JSDoc)
    if echo "$file_part" | grep -q "agentBehaviorConfig"; then continue; fi
    # Allow strictResolver.ts (retains PHASE2 in error code intentionally)
    if echo "$file_part" | grep -q "strictResolver"; then continue; fi
    # Allow test files
    if echo "$file_part" | grep -q "__tests__"; then continue; fi
    # Allow lines explicitly marked as historical / legacy
    if echo "$content" | grep -qE "// historical:|// legacy naming:"; then continue; fi

    fail "No stale phase nomenclature in src/" \
      "$file_part:$lineno" \
      "$(echo "$content" | head -c 120)" \
      "Old 4-value enum was collapsed to 'mode-coverage'/'strict' after May 2026 revert. Stale string is dead code or misleading." \
      "Replace with 'mode-coverage' or 'strict', or add a '// historical:' marker if it must be preserved for documentation."
  done < <(grep -rn "$name" src/ 2>/dev/null | \
    grep -v "__tests__" | \
    grep -v "agentBehaviorConfig" | \
    grep -v "strictResolver" || true)
done

# ── Check 4 ───────────────────────────────────────────────────────────────────
# No discriminated-union object-form examples in tool description strings.
# Rationale: tool descriptions are injected into every LLM call. If they teach
# {variable_id:...} as a positive form, the LLM will use it — and it will
# silently stringify on string-mode providers.
# The jsx.ts anti-pattern clause is allowed because it explicitly says the object
# form DROPS the binding ("drop the binding silently") — a negative example, not a how-to.
CHECKS=$((CHECKS + 1))
echo "[ 4/5 ] Checking: no discriminated-union object-form examples in tool description fields ..."

TOOL_FILES=$(find src/engine/agent/tools/unified -name "*.ts" 2>/dev/null)

if [ -n "$TOOL_FILES" ]; then
  # Look for lines that contain both a description field marker AND an object-form pattern
  # The anti-pattern in jsx.ts contains "drop the binding silently" — filter that out.
  while IFS= read -r hit; do
    file_part="${hit%%:*}"
    line_rest="${hit#*:}"
    lineno="${line_rest%%:*}"
    content="${line_rest#*:}"

    # Explicitly exempt the anti-pattern warning in jsx.ts
    if echo "$content" | grep -q "drop the binding silently"; then continue; fi
    # Exempt comment lines (lines where content starts with whitespace+//)
    if echo "$content" | grep -qE "^\s*//"; then continue; fi

    fail "No object-form examples in tool descriptions" \
      "$file_part:$lineno" \
      "$(echo "$content" | head -c 120)" \
      "Tool description teaches {variable_id:...} as a positive example — LLM providers stringify this, breaking the binding." \
      "Replace with string form (\$Coll/Name) or move to a code comment (not part of description string)."
  done < <(echo "$TOOL_FILES" | xargs grep -n '{variable_id:' 2>/dev/null | \
    grep -v "^\s*//" || true)
fi

# ── Check 5 ───────────────────────────────────────────────────────────────────
# Schema honesty: if a tool description mentions "object" / "discriminated union" /
# "structured form" / "or object {", verify the parameter schema actually allows objects.
# Heuristic: flag lines with description: ... AND any forbidden substring.
# False positives are acceptable (a human reviews them); false negatives are not.
CHECKS=$((CHECKS + 1))
echo "[ 5/5 ] Checking: schema-vs-description mismatch (description claims object form, schema is string-only) ..."

SCHEMA_MISMATCH_PATTERNS=("or object {" "structured form" "discriminated union" "object form")

if [ -n "$TOOL_FILES" ]; then
  for pattern in "${SCHEMA_MISMATCH_PATTERNS[@]}"; do
    while IFS= read -r hit; do
      file_part="${hit%%:*}"
      line_rest="${hit#*:}"
      lineno="${line_rest%%:*}"
      content="${line_rest#*:}"

      # Exempt comment lines
      if echo "$content" | grep -qE "^\s*//"; then continue; fi

      fail "Schema-vs-description mismatch (description claims object form)" \
        "$file_part:$lineno" \
        "$(echo "$content" | head -c 120)" \
        "Description claims object/structured form but LLM schema likely declares type:'string'. LLM may trust description over schema." \
        "Either update schema to accept objects, or remove the object-form claim from description."
    done < <(echo "$TOOL_FILES" | xargs grep -n "$pattern" 2>/dev/null | \
      grep -v "^\s*//" || true)
  done
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "  $FAILURES violation(s) found across $CHECKS checks."
  echo "  See .agent/teaching-manifest.yaml for the full surface map."
  exit 1
else
  echo "  All $CHECKS consistency checks passed."
  echo "  See .agent/teaching-manifest.yaml for the full surface map."
  exit 0
fi
